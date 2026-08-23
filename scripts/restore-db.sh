#!/bin/sh
# Restore a dump into a SCRATCH database and count what came back.
#
#   ./scripts/restore-db.sh backups/monfrancais_Database-20260823-030000.sql.gz
#
# This is the half of a backup strategy that people skip. An untested dump is
# a belief, not a backup, and the belief is tested for the first time on the
# worst day. This restores into a throwaway database beside the real one, so
# running it is safe at any time and proves the file actually works.
#
# It never touches the live database. Restoring over production is deliberately
# not automated here — do that by hand, awake, with the site in maintenance.
set -eu

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -f "$DUMP" ]; then
    echo "usage: $0 <path-to-dump.sql.gz>"
    echo
    echo "available dumps:"
    ls -1t backups/*.sql.gz 2>/dev/null | head -10 || echo "  (none in ./backups)"
    exit 1
fi

SCRATCH="${SCRATCH_DB:-restore_check}"
COMPOSE="${COMPOSE:-docker compose}"

echo "restore: target scratch database '${SCRATCH}' (the live one is untouched)"
$COMPOSE exec -T db sh -c "dropdb -U \$POSTGRES_USER --if-exists ${SCRATCH}"
$COMPOSE exec -T db sh -c "createdb -U \$POSTGRES_USER ${SCRATCH}"

echo "restore: loading $(basename "$DUMP")"
gunzip -c "$DUMP" | $COMPOSE exec -T db sh -c "psql -U \$POSTGRES_USER -d ${SCRATCH} -v ON_ERROR_STOP=1 -q"

echo
echo "restore: row counts in the restored copy"
$COMPOSE exec -T db sh -c "psql -U \$POSTGRES_USER -d ${SCRATCH} -At -c \"
  SELECT relname || ': ' || n_live_tup
  FROM pg_stat_user_tables
  WHERE n_live_tup > 0
  ORDER BY n_live_tup DESC
  LIMIT 20;\""

echo
echo "restore: OK. Compare the counts above with production before trusting it."
echo "restore: drop the scratch copy with:"
echo "  $COMPOSE exec -T db sh -c 'dropdb -U \$POSTGRES_USER ${SCRATCH}'"
