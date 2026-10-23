#!/usr/bin/env bash
# Smoke-tests a built municipal image: every response carries the self-only
# CSP, the bundled WASM/OCR assets are served, and the brand from the
# container env replaces every placeholder.
# Usage: verify.sh <image> <ocr_languages>
set -euo pipefail
IMAGE=$1
OCR_LANGS=$2
BRAND='Overenie Názvu PDF'
NAME=municipal-verify-$$
docker run -d --rm --name "$NAME" -p 127.0.0.1::8080 \
  -e BRAND_NAME="$BRAND" -e SITE_URL=https://overenie.example "$IMAGE" >/dev/null
trap 'docker stop "$NAME" >/dev/null' EXIT
URL="http://$(docker port "$NAME" 8080 | head -1)"
for _ in $(seq 1 120); do curl -fs -o /dev/null "$URL/" && break; sleep 0.5; done
docker logs "$NAME" 2>&1 | grep municipal-config || true

fail=0
check() { if [ "$2" = ok ]; then echo "  ok    $1"; else echo "  FAIL  $1: $3"; fail=1; fi; }

# At least one CSP header must allow nothing beyond our own origin: no URLs,
# no https: scheme, no wildcard. Browsers enforce it on top of upstream's CSP.
for path in / /sk/ /sk/merge-pdf /sw.js /wasm/ocr/worker.min.js /docs/; do
  headers=$(curl -fsI "$URL$path" || true)
  selfonly=$(grep -i '^content-security-policy:' <<<"$headers" | grep -i "default-src 'self'" \
    | grep -vcE 'https?:|\*' || true)
  if [ "$selfonly" -ge 1 ]; then r=ok; else r=bad; fi
  check "self-only CSP on $path" $r "$(head -1 <<<"$headers"), self-only headers: $selfonly"
done

# No redirect may leave the site (//host or /\host in Location changes host).
for path in '//evil.example/' '/\evil.example/' '/%5Cevil.example/' '/en//evil.example' '/sk//evil.example/'; do
  # Browsers read a backslash as a slash; curl does not, so check the raw header.
  to=$(curl -sI --path-as-is "$URL$path" | tr -d '\r' | sed -n 's/^[Ll]ocation: //p' || true)
  case "$to" in //*|/\\*|*://*) r=bad ;; *) r=ok ;; esac
  check "no off-site redirect for $path" $r "Location: $to"
done

assets="gs/gs.wasm cpdf/coherentpdf.browser.min.js ocr/worker.min.js ocr/fonts/NotoSans-Regular.ttf"
for lang in ${OCR_LANGS//,/ }; do assets="$assets ocr/lang-data/$lang.traineddata.gz"; done
for f in $assets; do
  if curl -fs -o /dev/null "$URL/wasm/$f"; then r=ok; else r=bad; fi
  check "serves /wasm/$f" $r "missing"
done

title=$(curl -fs "$URL/sk/merge-pdf" | tr '\n' ' ' | grep -oE '<title>[^<]*</title>' || true)
if grep -qF -- "$BRAND" <<<"$title"; then r=ok; else r=bad; fi
check "brand in /sk/merge-pdf $title" $r "'$BRAND' missing"

left=$(docker exec "$NAME" grep -rlE 'KONVERTOR_(BRAND|FOOTER)_TOKEN|konvertor-site\.invalid' \
  /usr/share/nginx/html /etc/nginx || true)
if [ -z "$left" ]; then r=ok; else r=bad; fi
check "no placeholders left" $r "$(head -3 <<<"$left")"

out=$(docker run --rm -e 'BRAND_NAME=a<b' --entrypoint /docker-entrypoint.d/90-municipal-config.sh \
  "$IMAGE" 2>&1) && r=bad || r=ok
grep -q 'must not contain' <<<"$out" || r=bad
check "refuses BRAND_NAME with markup" $r "$out"

[ "$fail" = 0 ] && echo "verify.sh: all checks passed" || { echo "verify.sh: FAILED" >&2; exit 1; }
