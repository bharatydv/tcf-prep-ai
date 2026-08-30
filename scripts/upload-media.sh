#!/usr/bin/env bash
#
# Push backend/media to the object store the app streams listening audio from.
#
# The audio is 1,560 files and 1.8 GB, and every learner streams a clip end to
# end — so the cost that matters is egress, not storage. Cloudflare R2 charges
# nothing for egress and gives 10 GB of storage free, which puts this whole
# bank inside the free tier; S3 or GCS would store it for a few cents a month
# and then bill roughly $0.09-$0.12 per GB served. That is the whole reason the
# database stores relative paths and the host is one environment variable.
#
# ---------------------------------------------------------------------------
# One-time setup
# ---------------------------------------------------------------------------
#  1. Cloudflare dashboard -> R2 -> Create bucket (e.g. "prepfrancais-media").
#  2. R2 -> Manage API tokens -> Create token, "Object Read & Write" on it.
#     Note the Access Key ID, the Secret Access Key and your Account ID.
#  3. Bucket -> Settings -> Public access: either connect a custom domain
#     (media.prepfrancais.com) or enable the r2.dev development URL. The
#     browser fetches these files directly, so the bucket must be readable
#     without credentials.
#  4. Put the public origin in the backend environment and restart it:
#
#         MEDIA_BASE_URL=https://media.prepfrancais.com
#
#     Unset, the API serves the same paths itself from backend/media — correct
#     for development, but it makes the application VM pay for every play.
#
# ---------------------------------------------------------------------------
# Usage
# ---------------------------------------------------------------------------
#     export R2_ACCOUNT_ID=...
#     export R2_ACCESS_KEY_ID=...
#     export R2_SECRET_ACCESS_KEY=...
#     export R2_BUCKET=prepfrancais-media
#     scripts/upload-media.sh
#
# Re-running is cheap and safe: `aws s3 sync` uploads only what changed, so a
# rebuild that touches one clip re-uploads one clip.
#
# Needs the AWS CLI (R2 speaks the S3 API):  pip install awscli
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MEDIA="$ROOT/backend/media"

for var in R2_ACCOUNT_ID R2_ACCESS_KEY_ID R2_SECRET_ACCESS_KEY R2_BUCKET; do
  if [ -z "${!var:-}" ]; then
    echo "error: $var is not set — see the setup notes at the top of this script" >&2
    exit 1
  fi
done

if [ ! -d "$MEDIA" ]; then
  echo "error: $MEDIA does not exist. Run: python scripts/build_content.py" >&2
  exit 1
fi

if ! command -v aws >/dev/null 2>&1; then
  echo "error: the aws CLI is not installed (pip install awscli)" >&2
  exit 1
fi

export AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID"
export AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY"
# R2 ignores the region but the CLI insists on one being set.
export AWS_DEFAULT_REGION=auto
ENDPOINT="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

count=$(find "$MEDIA" -type f | wc -l | tr -d ' ')
size=$(du -sh "$MEDIA" | cut -f1)
echo "Syncing $count files ($size) to s3://${R2_BUCKET}/ …"

# Content types are set explicitly per extension. Guessing from the system
# mimetype table is what served the .webp question images as text/plain on
# Windows, and a wrong type on a bucket is far harder to notice than locally.
#
# The audio never changes once imported and is fetched on nearly every question,
# so it is marked immutable for a year; a re-import writes a new path rather
# than a new body at the same path.
CACHE="public, max-age=31536000, immutable"

aws s3 sync "$MEDIA" "s3://${R2_BUCKET}/" \
  --endpoint-url "$ENDPOINT" \
  --exclude "*" --include "*.mp3" \
  --content-type "audio/mpeg" --cache-control "$CACHE" \
  --no-progress

aws s3 sync "$MEDIA" "s3://${R2_BUCKET}/" \
  --endpoint-url "$ENDPOINT" \
  --exclude "*" --include "*.webp" \
  --content-type "image/webp" --cache-control "$CACHE" \
  --no-progress

echo
echo "Done. Now set on the API and restart it:"
echo "    MEDIA_BASE_URL=https://<your-public-r2-origin>"
echo
echo "Check one file resolves before you rely on it:"
echo "    curl -sI https://<your-public-r2-origin>/listening/test01/q01.mp3"
