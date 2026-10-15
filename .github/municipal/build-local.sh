#!/usr/bin/env bash
# Builds and verifies the municipal image from the committed HEAD without
# touching the working tree (prepare.sh runs on a temporary export).
# Usage: build-local.sh [site_url] [brand] [ocr_languages] [image_tag]
set -euo pipefail
SITE_URL=${1:-http://localhost:8080}
BRAND=${2:-Konvertor PDF}
OCR_LANGS=${3:-slk,ces,eng}
TAG=${4:-konvertor-pdf:local}
HERE=$(cd "$(dirname "$0")" && pwd)
ROOT=$(cd "$HERE/../.." && pwd)
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

git -C "$ROOT" archive HEAD | tar -x -C "$WORK"
cd "$WORK"
bash "$HERE/prepare.sh" "$BRAND" "$SITE_URL" "$OCR_LANGS"
mapfile -t ARGS < municipal.build-args
docker build "${ARGS[@]/#/--build-arg=}" -t "$TAG" .
bash "$HERE/verify.sh" "$TAG" "$BRAND" "$OCR_LANGS"
