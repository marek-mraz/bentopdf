#!/bin/sh
# Runs at container start (/docker-entrypoint.d/90-municipal-config.sh) and
# writes the container's env into /etc/nginx/tmp/municipal.conf. nginx.conf
# includes that file and swaps the brand, footer and site URL placeholders
# while serving (sub_filter), so the web root stays untouched and the root
# filesystem can be read-only; only /etc/nginx/tmp must be writable.
#   BRAND_NAME   product name                       (default: Konvertor PDF)
#   FOOTER_TEXT  footer line; AGPL-3.0 requires it to keep pointing users to
#                the source code                    (default: link to this fork)
#   SITE_URL     origin users open, e.g. https://pdf.mesto.sk; the browser
#                loads WASM and OCR files from it  (default: http://localhost:8080)
set -eu
BRAND=${BRAND_NAME:-Konvertor PDF}
FOOTER=${FOOTER_TEXT:-Založené na open-source BentoPDF (AGPL-3.0), zdrojový kód: @SOURCE_URL@}
SITE=${SITE_URL:-http://localhost:8080}
SITE=${SITE%/}
CONF=/etc/nginx/tmp/municipal.conf

fail() { echo "municipal-config: $*" >&2; exit 1; }
NL='
'
# The values end up in HTML, JSON and JS strings and in a quoted nginx string.
for v in "$BRAND" "$FOOTER"; do
  case $v in
    *[\<\>\"\'\`\\\$\&\|\;\{\}]* | *"$NL"*) fail "BRAND_NAME/FOOTER_TEXT must not contain < > \" ' \` \\ \$ & | ; { } or a newline" ;;
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

cat >"$CONF.new" <<EOF
map "" \$konvertor_brand { default "$BRAND"; }
map "" \$konvertor_footer { default "$FOOTER"; }
map "" \$konvertor_site { default "$SITE"; }
EOF
mv "$CONF.new" "$CONF"
echo "municipal-config: brand '$BRAND', site $SITE"
