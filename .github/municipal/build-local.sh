#!/usr/bin/env bash
# Builds and verifies the municipal image from the committed HEAD without
# touching the working tree (prepare.sh runs on a temporary export).
# Usage: build-local.sh [ocr_languages] [image_tag]
set -euo pipefail
OCR_LANGS=${1:-slk,ces,eng}
TAG=${2:-konvertor-pdf:local}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

git -C "$ROOT" archive HEAD | tar -x -C "$WORK"
cd "$WORK"
bash "$HERE/prepare.sh" "$OCR_LANGS"
mapfile -t ARGS < municipal.build-args
docker build "${ARGS[@]/#/--build-arg=}" -t "$TAG" .
bash "$HERE/verify.sh" "$TAG" "$OCR_LANGS"
echo "run: docker run -p 8080:8080 -e SITE_URL=http://localhost:8080 -e BRAND_NAME='Konvertor PDF' $TAG"
