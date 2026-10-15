#!/bin/sh
# Runs at container start (/docker-entrypoint.d/90-municipal-config.sh) and
# fills in the values prepare.sh left as placeholders, so one image serves any
# deployment:
#   BRAND_NAME   product name                       (default: Konvertor PDF)
#   FOOTER_TEXT  footer line; AGPL-3.0 requires it to keep pointing users to
#                the source code                    (default: link to this fork)
#   SITE_URL     origin users open, e.g. https://pdf.mesto.sk; the browser
#                loads WASM and OCR files from it  (default: http://localhost:8080)
# Env cannot change for an existing container, so a restart finds no
# placeholders left and skips the work.
set -eu
ROOT=/usr/share/nginx/html
BRAND=${BRAND_NAME:-Konvertor PDF}
FOOTER=${FOOTER_TEXT:-Založené na open-source BentoPDF (AGPL-3.0), zdrojový kód: @SOURCE_URL@}
SITE=${SITE_URL:-http://localhost:8080}
SITE=${SITE%/}
TOKENS='KONVERTOR_BRAND_TOKEN|KONVERTOR_FOOTER_TOKEN|https://konvertor-site\.invalid'

fail() { echo "municipal-config: $*" >&2; exit 1; }
NL='
'
# The values go unescaped into HTML, JSON, JS strings and sed replacements.
for v in "$BRAND" "$FOOTER"; do
  case $v in
    *[\<\>\"\'\`\\\$\&\|]* | *"$NL"*) fail "BRAND_NAME/FOOTER_TEXT must not contain < > \" ' \` \\ \$ & | or a newline" ;;
  esac
done
case $SITE in
  http://?* | https://?*) ;;
  *) fail "SITE_URL must start with http:// or https://" ;;
esac
case ${SITE#*://} in
  */* | *[!A-Za-z0-9.:-]*) fail "SITE_URL must be an origin without a path, e.g. https://pdf.mesto.sk" ;;
esac
[ -n "${SITE_URL:-}" ] || echo "municipal-config: SITE_URL not set; WASM and OCR load from $SITE only"

LIST=$(mktemp)
TMP=$(mktemp)
trap 'rm -f "$LIST" "$TMP"' EXIT
find "$ROOT" \( -path "$ROOT/wasm" -o -path "$ROOT/libreoffice-wasm" \) -prune -o -type f \
  \( -name '*.html' -o -name '*.js' -o -name '*.mjs' -o -name '*.json' -o -name '*.xml' \
     -o -name '*.txt' -o -name '*.webmanifest' \) -exec grep -lE "$TOKENS" {} + >"$LIST" || true
grep -lE "$TOKENS" /etc/nginx/security-headers*.conf >>"$LIST" || true
if [ ! -s "$LIST" ]; then
  echo "municipal-config: no placeholders left (restart), nothing to do"
  exit 0
fi

# The web root itself belongs to root, so files are rewritten in place
# (cat >) rather than with sed -i, which needs to create a file next to them.
while IFS= read -r f; do
  sed -e "s|KONVERTOR_BRAND_TOKEN|$BRAND|g" -e "s|KONVERTOR_FOOTER_TOKEN|$FOOTER|g" \
    -e "s|https://konvertor-site\.invalid|$SITE|g" "$f" >"$TMP"
  cat "$TMP" >"$f"
  # nginx serves .gz copies (gzip_static); .br copies are never served.
  if [ -f "$f.gz" ]; then gzip -9c "$f" >"$f.gz"; fi
done <"$LIST"
echo "municipal-config: brand '$BRAND', site $SITE, $(wc -l <"$LIST") files"
