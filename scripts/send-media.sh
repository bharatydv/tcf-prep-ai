#!/usr/bin/env bash
#
# Copy the listening audio from this machine to the deploy host.
#
# The audio is gitignored — 1,560 files and 1.8 GB — so a `git pull` on the
# server gets the question banks but no recordings, and every clip fails with
# "that recording could not be played". This closes that gap.
#
#     bash scripts/send-media.sh monfr@34.12.34.56
#     bash scripts/send-media.sh monfr@34.12.34.56 /srv/tcf-prep-ai
#
# It streams a tar over ssh rather than copying 1,629 files one at a time:
# scp -r pays a round trip per file, which over a home uplink is most of the
# transfer time. One stream also means no half-copied directory to reason
# about — it either arrives or it does not, and rerunning simply overwrites.
#
# Nothing is written locally, so this needs no free disk on either side beyond
# the 1.8 GB that lands at the far end.
set -euo pipefail

DEST="${1:-}"
REMOTE_REPO="${2:-~/tcf-prep-ai}"

if [ -z "$DEST" ]; then
    cat >&2 <<'USAGE'
usage: bash scripts/send-media.sh USER@HOST [REMOTE_REPO_PATH]

  USER@HOST         the deploy host, e.g. monfr@34.12.34.56
                    (get the IP by running `curl -s ifconfig.me` on it)
  REMOTE_REPO_PATH  where the repo lives there; defaults to ~/tcf-prep-ai

Run this on the machine that HAS the audio — the one where you built the
content — not over ssh on the server.
USAGE
    exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEDIA="$ROOT/backend/media"

# Fail here rather than halfway through, and say which machine you are on:
# running this in an ssh session on the server is the easy mistake, and there
# the directory is missing precisely because that is the problem being fixed.
if [ ! -d "$MEDIA/listening" ]; then
    echo "error: $MEDIA/listening does not exist." >&2
    echo "       You are probably on the server. Run this on the machine that" >&2
    echo "       has the audio, or rebuild it: python scripts/build_content.py" >&2
    exit 1
fi

count=$(find "$MEDIA" -type f | wc -l | tr -d ' ')
size=$(du -sh "$MEDIA" | cut -f1)

echo "Sending $count files ($size) to ${DEST}:${REMOTE_REPO}/backend/media"
echo "This is silent and can take a long while on a home connection. Leave it."
echo

# -C backend so the archive holds "media/..." and lands as backend/media on the
# far side. The remote mkdir keeps this working on a host that has never had
# the directory, which is every host before the first run.
tar -cf - -C "$ROOT/backend" media \
  | ssh "$DEST" "mkdir -p ${REMOTE_REPO}/backend && tar -xf - -C ${REMOTE_REPO}/backend"

echo
echo "Verifying on the far side …"
remote=$(ssh "$DEST" "find ${REMOTE_REPO}/backend/media -type f 2>/dev/null | wc -l" | tr -d ' \r')
echo "  local:  $count files"
echo "  remote: $remote files"

if [ "$remote" = "$count" ]; then
    echo
    echo "Done. Now on the server:"
    echo "    cd ${REMOTE_REPO} && docker compose up -d --build frontend backend"
    echo "    curl -sI localhost/media/listening/test01/q01.mp3 | grep -i content-type"
    echo "  That must say audio/mpeg. If it says text/html the frontend image is stale."
else
    echo
    echo "MISMATCH — rerun this script; it overwrites and is safe to repeat." >&2
    exit 1
fi
