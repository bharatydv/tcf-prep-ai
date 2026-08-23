#!/bin/sh
# One pass over everything that can take the site down, printed as one line
# per check. Run it from cron; alert on the exit code.
#
#   */5 * * * * cd /home/monfr/tcf-prep-ai && ./scripts/healthcheck.sh >> /var/log/prepfrancais-health.log 2>&1
#
# Exit 0 = all good, 1 = something is wrong. Nothing is installed, nothing is
# subscribed to, and nothing leaves the machine: this is deliberately the
# cheapest thing that answers "is it up, and is it about to fall over".
#
# For an outside view — which is the one that matters, because this script
# cannot report that the VM is unreachable — point a free uptime checker at
# https://prepfrancais.com/api/health. That plus this covers most of it.
set -u

SITE="${SITE:-https://prepfrancais.com}"
API="${API:-http://127.0.0.1:5000}"
DISK_MAX="${DISK_MAX:-85}"          # percent
MEM_MAX="${MEM_MAX:-90}"
FAIL=0
STAMP="$(date -Iseconds)"

say() { printf '%s %-22s %s\n' "$STAMP" "$1" "$2"; }
bad() { say "$1" "FAIL $2"; FAIL=1; }

# ---------------------------------------------------------------- website ---
CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$SITE/" 2>/dev/null || echo 000)
[ "$CODE" = "200" ] && say website "ok ($CODE)" || bad website "homepage returned $CODE"

# -------------------------------------------------------------------- api ---
CODE=$(curl -sS -o /dev/null -w '%{http_code}' --max-time 15 "$API/api/health" 2>/dev/null || echo 000)
[ "$CODE" = "200" ] && say api "ok ($CODE)" || bad api "health returned $CODE"

# TLS expiry. Certbot renews automatically, but a renewal that silently stops
# working is invisible until the browser warning appears.
DAYS=$(echo | openssl s_client -servername "${SITE#https://}" -connect "${SITE#https://}:443" 2>/dev/null \
     | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$DAYS" ]; then
    LEFT=$(( ( $(date -d "$DAYS" +%s) - $(date +%s) ) / 86400 ))
    [ "$LEFT" -gt 14 ] && say tls "ok (${LEFT}d left)" || bad tls "certificate expires in ${LEFT}d"
else
    say tls "skipped (openssl unavailable)"
fi

# --------------------------------------------------------------- containers -
for NAME in tcf_db tcf_backend tcf_frontend; do
    STATE=$(docker inspect -f '{{.State.Status}}' "$NAME" 2>/dev/null || echo missing)
    RESTARTS=$(docker inspect -f '{{.RestartCount}}' "$NAME" 2>/dev/null || echo 0)
    if [ "$STATE" != "running" ]; then
        bad "container:$NAME" "state=$STATE"
    elif [ "$RESTARTS" -gt 5 ]; then
        # A container that keeps coming back is failing repeatedly, and
        # `restart: always` hides that behind a healthy-looking status.
        bad "container:$NAME" "running but has restarted $RESTARTS times"
    else
        say "container:$NAME" "ok (restarts=$RESTARTS)"
    fi
done

# ---------------------------------------------------------------- database ---
if docker exec tcf_db pg_isready -q 2>/dev/null; then
    say database "ok (accepting connections)"
else
    bad database "pg_isready says it is not accepting connections"
fi

# ------------------------------------------------------------------ errors ---
# Backend tracebacks and grading failures in the last hour. Not every WARNING
# matters; these two do.
ERRS=$(docker logs --since 1h tcf_backend 2>&1 | grep -cE "Traceback|CRITICAL|Unhandled error" || true)
[ "${ERRS:-0}" -eq 0 ] && say backend-errors "ok (none in 1h)" || bad backend-errors "$ERRS traceback(s) in 1h"

AMOUNT=$(docker logs --since 24h tcf_backend 2>&1 | grep -c "AMOUNT MISMATCH" || true)
[ "${AMOUNT:-0}" -eq 0 ] && say payment-mismatch "ok (none in 24h)" \
    || bad payment-mismatch "$AMOUNT payment(s) charged an unexpected amount"

NGINX=$(docker logs --since 1h tcf_frontend 2>&1 | grep -cE "\[error\]|\[crit\]" || true)
[ "${NGINX:-0}" -eq 0 ] && say nginx-errors "ok (none in 1h)" || bad nginx-errors "$NGINX error(s) in 1h"

# ------------------------------------------------------------------- host ----
DISK=$(df -P / | awk 'NR==2 {gsub("%","",$5); print $5}')
[ "$DISK" -lt "$DISK_MAX" ] && say disk "ok (${DISK}% used)" \
    || bad disk "${DISK}% used - the database volume shares this disk"

MEM=$(free 2>/dev/null | awk '/Mem:/ {printf "%d", $3/$2*100}')
if [ -n "${MEM:-}" ]; then
    [ "$MEM" -lt "$MEM_MAX" ] && say memory "ok (${MEM}% used)" || bad memory "${MEM}% used"
fi

LOAD=$(awk '{print $1}' /proc/loadavg 2>/dev/null)
CORES=$(nproc 2>/dev/null || echo 1)
[ -n "${LOAD:-}" ] && say cpu "load ${LOAD} across ${CORES} core(s)"

# ----------------------------------------------------------------- backups ---
# A backup job that quietly stopped looks exactly like one that never ran.
NEWEST=$(find backups -name '*.sql.gz' -type f -mtime -2 2>/dev/null | wc -l)
[ "${NEWEST:-0}" -gt 0 ] && say backups "ok ($NEWEST dump(s) in the last 2 days)" \
    || bad backups "no dump newer than 2 days"

[ "$FAIL" -eq 0 ] && say OVERALL "all checks passed" || say OVERALL "SOMETHING IS WRONG"
exit "$FAIL"
