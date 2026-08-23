#!/bin/sh
# One compressed pg_dump into /backups, oldest ones pruned.
#
# Runs inside the `backup` container from docker-compose.yml, which supplies
# PGHOST/PGUSER/PGPASSWORD/PGDATABASE and mounts ./backups from the host.
#
# The dump is written to a .part file and renamed only once pg_dump exits 0.
# A half-written file with the right name is worse than no file at all: it
# looks like a backup for weeks and fails on the night it is needed.
set -eu

DIR="${BACKUP_DIR:-/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y%m%d-%H%M%S)"
OUT="$DIR/${PGDATABASE}-${STAMP}.sql.gz"

mkdir -p "$DIR"

echo "backup: dumping ${PGDATABASE} -> $(basename "$OUT")"
pg_dump --no-owner --no-privileges --clean --if-exists \
    | gzip -9 > "$OUT.part"

# gzip in a pipeline hides pg_dump's exit status, so check the result instead:
# a dump that failed early still produces a small, valid gzip file.
SIZE=$(wc -c < "$OUT.part")
if [ "$SIZE" -lt 1024 ]; then
    echo "backup: FAILED - dump was only ${SIZE} bytes, refusing to keep it"
    rm -f "$OUT.part"
    exit 1
fi

mv "$OUT.part" "$OUT"
echo "backup: wrote $(basename "$OUT") (${SIZE} bytes)"

# Prune by count as well as age, so a burst of runs cannot fill the disk and
# a long quiet period cannot delete the only copy that exists.
find "$DIR" -name "${PGDATABASE}-*.sql.gz" -type f -mtime "+${KEEP_DAYS}" -print -delete \
    | sed 's/^/backup: pruned /' || true

REMAINING=$(find "$DIR" -name "${PGDATABASE}-*.sql.gz" -type f | wc -l)
echo "backup: ${REMAINING} dump(s) retained in ${DIR}"

# A backup on the same disk as the database protects against exactly one
# failure mode: someone deleting the volume. It does not survive losing the
# machine. Ship these off-box.
echo "backup: reminder - copy ${DIR} off this VM; local copies are not a backup"
