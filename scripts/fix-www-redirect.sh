#!/bin/bash
# Make https://prepfrancais.com the one canonical host.
#
#   sudo ./scripts/fix-www-redirect.sh          # show what it would do
#   sudo ./scripts/fix-www-redirect.sh --apply  # do it
#
# Today www.prepfrancais.com serves the whole site on its own hostname, so
# every page exists at two addresses and search engines have to guess which is
# real. http://www redirects to https://www rather than to the apex.
#
# The fix is two edits, and the order matters:
#
#   1. Remove www from the server_name of the blocks that serve the site. Two
#      blocks listing the same name exactly is the trap here - nginx picks the
#      first one in config order, so simply appending a redirect block leaves
#      it shadowed and nothing changes.
#   2. Add a block whose only job is to redirect www to the apex.
#
# The script reads the config rather than assuming its shape, backs it up,
# tests before reloading, and rolls back automatically if the test fails.
set -uo pipefail

APPLY=0
[ "${1:-}" = "--apply" ] && APPLY=1

CONF="${NGINX_CONF:-/etc/nginx/sites-available/default}"
APEX="prepfrancais.com"
WWW="www.${APEX}"
MARK="# canonical-host redirect (scripts/fix-www-redirect.sh)"

die() { echo "ERROR: $*" >&2; exit 1; }

[ -r "$CONF" ] || die "cannot read $CONF (run with sudo, or set NGINX_CONF)"

if grep -qF "$MARK" "$CONF"; then
    echo "Already applied - the redirect block is present in $CONF."
    echo "Verifying anyway:"
    verify=1
else
    verify=0
fi

if [ "$verify" -eq 0 ]; then
    # --- what is there now -------------------------------------------------
    echo "== server_name lines mentioning $WWW =="
    grep -n "server_name.*${WWW}" "$CONF" || echo "  (none - www may be served by a default block)"
    echo

    CERT=$(grep -m1 -oE 'ssl_certificate\s+\S+' "$CONF" | awk '{print $2}' | tr -d ';')
    KEY=$(grep -m1 -oE 'ssl_certificate_key\s+\S+' "$CONF" | awk '{print $2}' | tr -d ';')
    [ -n "$CERT" ] && [ -n "$KEY" ] || die "no ssl_certificate found in $CONF - is TLS configured elsewhere?"

    echo "== certificate this will reuse =="
    echo "  cert: $CERT"
    echo "  key : $KEY"
    # https://www already answers 200, so the certificate covers it. Confirm
    # rather than assume, because a redirect served over a bad certificate is
    # a browser warning, not a redirect.
    if command -v openssl >/dev/null && [ -r "$CERT" ]; then
        if openssl x509 -in "$CERT" -noout -text 2>/dev/null | grep -q "DNS:${WWW}"; then
            echo "  covers $WWW: yes"
        else
            die "the certificate does NOT list $WWW - fix the certificate first, or the redirect will be served over an invalid one"
        fi
    fi
    echo

    if [ "$APPLY" -eq 0 ]; then
        echo "== what --apply would change =="
        echo "  1. strip '$WWW' from every server_name above"
        echo "  2. append a :80 and a :443 block for $WWW that 301 to https://${APEX}"
        echo
        echo "Nothing has been changed. Re-run with --apply."
        exit 0
    fi

    # A block whose server_name is www and nothing else would be left with a
    # bare `server_name;` by the edit below, which is invalid. nginx -t would
    # catch it and this script would roll back, but failing cleanly beforehand
    # is better than failing loudly afterwards.
    if grep -E "server_name[^;]*${WWW//./\.}" "$CONF" | grep -vE "(^|[[:space:]])${APEX//./\.}([[:space:]]|;)" | grep -q .; then
        echo "A server_name lists $WWW without $APEX beside it:"
        grep -nE "server_name[^;]*${WWW//./\.}" "$CONF" | grep -vE "(^|[[:space:]])${APEX//./\.}([[:space:]]|;)"
        die "that block exists only to serve www; decide what it should do before running this"
    fi

    BACKUP="${CONF}.bak.$(date +%Y%m%d-%H%M%S)"
    cp -p "$CONF" "$BACKUP" || die "could not back up to $BACKUP"
    echo "Backed up to $BACKUP"

    # 1. www leaves the server_name of whatever serves the site. Handles the
    #    name appearing before or after the apex, and collapses the whitespace
    #    it leaves behind.
    sed -i -E "s/(server_name[^;]*)\s+${WWW//./\\.}/\1/g; s/(server_name)\s+${WWW//./\\.}\s+/\1 /g" "$CONF"

    # 2. The redirect block. No IPv6 listen lines: if another block already
    #    owns [::]:443 with ipv6only, adding a second one fails the config test.
    cat >> "$CONF" <<EOF

${MARK}
# www served the entire site on a second hostname, so every page existed at two
# addresses. These two blocks exist only to send it to the canonical one.
server {
    listen 80;
    server_name ${WWW};
    return 301 https://${APEX}\$request_uri;
}
server {
    listen 443 ssl;
    server_name ${WWW};
    ssl_certificate ${CERT};
    ssl_certificate_key ${KEY};
    return 301 https://${APEX}\$request_uri;
}
EOF

    echo "Testing the configuration..."
    if ! nginx -t; then
        cp -p "$BACKUP" "$CONF"
        die "nginx -t failed - the original config has been restored from $BACKUP, nothing was reloaded"
    fi

    echo "Reloading nginx..."
    nginx -s reload || systemctl reload nginx || die "reload failed - config is valid but nginx did not reload"
fi

# --- prove it ---------------------------------------------------------------
echo
echo "== verification =="
check() {
    local url="$1" want="$2"
    local code loc
    code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$url" 2>/dev/null)
    loc=$(curl -s -o /dev/null -w '%{redirect_url}' --max-time 15 "$url" 2>/dev/null)
    if [ "$want" = "200" ]; then
        [ "$code" = "200" ] && echo "  ok    $url -> $code" || echo "  FAIL  $url -> $code (wanted 200)"
    else
        if [ "$code" = "301" ] && [ "$loc" = "https://${APEX}/" ]; then
            echo "  ok    $url -> 301 -> $loc"
        else
            echo "  FAIL  $url -> $code -> ${loc:-none} (wanted 301 to https://${APEX}/)"
        fi
    fi
}
check "http://${APEX}/"  301
check "http://${WWW}/"   301
check "https://${WWW}/"  301
check "https://${APEX}/" 200
echo
echo "A 301 that lands on https://${WWW}/ rather than the apex means a block"
echo "still claims the www name ahead of the redirect block - check config order."
