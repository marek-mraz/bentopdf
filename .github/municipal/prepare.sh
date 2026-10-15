#!/usr/bin/env bash
# Prepares a throwaway checkout for the municipal image. Nothing here is ever
# committed, so upstream merges stay conflict-free and new upstream code gets
# the same treatment on the next build.
#   1. Renames the visible product name.
#   2. Bundles every runtime WASM, OCR and font asset under public/wasm using
#      upstream's air-gap tooling, so the browser loads no code from a CDN.
#   3. Adds a second, self-only Content-Security-Policy. Browsers enforce every
#      CSP they receive, so no third-party origin can load even if upstream's
#      generated policy lists one.
#   4. Writes the matching Docker build args to municipal.build-args.
# Usage (repo root of a throwaway checkout):
#   prepare.sh <brand> <site_url> <ocr_languages> [source_url]
set -euo pipefail
BRAND=$1
SITE_URL=${2%/}
OCR_LANGS=$3
SOURCE_URL=${4:-https://github.com/${GITHUB_REPOSITORY:-marek-mraz/bentopdf}}
WASM_URL="$SITE_URL/wasm"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

# 1. Header/footer come from VITE_BRAND_NAME; titles, SEO meta, locale strings
# and the i18n page generator hard-code "BentoPDF". Handles and URLs
# (@BentoPDF, x.com/BentoPDF, BentoPDF.com) stay; blog/ is upstream's author blog.
grep -rlZ BentoPDF -- *.html src/pages src/partials public/locales \
    src/js/sw-register.ts scripts/generate-i18n-pages.mjs scripts/enhance-seo-pages.mjs \
  | BRAND="$BRAND" xargs -0 -r perl -pi -e 's/(?<![@\/])BentoPDF(?!\.com)/$ENV{BRAND}/g'

# 2. PyMuPDF, Ghostscript, CoherentPDF, Tesseract (+ language data, OCR fonts).
# CDNs answer 503 now and then; curl retries those via this .curlrc.
printf 'retry = 5\nretry-delay = 3\n' > "$TMP/.curlrc"
CURL_HOME="$TMP" bash scripts/prepare-airgap.sh --skip-docker --wasm-base-url "$WASM_URL" \
  --ocr-languages "$OCR_LANGS" --output-dir "$TMP/bundle"
WASM_EXTRACT_DIR="$PWD/public/wasm" bash "$TMP/bundle/setup.sh" <<<n  # answers its "start now?" prompt

# Text-editor fallback fonts (src/js/config/editor-fonts.ts), read by Vite from
# .env.production because the Dockerfile has no build arg for it. Only the
# referenced files (+ OFL license) are copied; the packages ship ~150 MB of
# unused weights.
for f in $(grep -oE "fonts-[a-z]+@[0-9.]+/fonts/[^']+" src/js/config/editor-fonts.ts | sort -u); do
  pkg=${f%%/*}
  tgz="$TMP/embedpdf-${pkg/@/-}.tgz"
  [ -f "$tgz" ] || (cd "$TMP" && npm pack --silent "@embedpdf/$pkg" >/dev/null)
  mkdir -p "public/wasm/embedpdf/$pkg"
  tar xzf "$tgz" -C "public/wasm/embedpdf/$pkg" --strip-components=1 "package/${f#*/}" package/LICENSE
done
echo "VITE_EMBEDPDF_FONTS_URL=$WASM_URL/embedpdf" > .env.production

# Keep each bundled package's license and manifest next to its files.
for tgz in "$TMP"/bundle/*.tgz; do
  dest="public/wasm/licenses/$(basename "$tgz" .tgz)"
  mkdir -p "$dest"
  tar xzf "$tgz" -C "$dest" --strip-components=1 --wildcards \
    'package/LICENSE*' 'package/COPYING*' 'package/package.json' 2>/dev/null || true
done

# 3. Self-only CSP next to every upstream security-header include. Docs pages
# (VitePress) need inline scripts; the app needs eval for LibreOffice WASM.
export APP_CSP="default-src 'self'; script-src 'self' 'wasm-unsafe-eval' 'unsafe-eval' blob:; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self' blob: data:; frame-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
export DOCS_CSP="default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'self'"
n=$(grep -c 'include /etc/nginx/security-headers\(-docs\)\?\.conf;' nginx.conf || true)
[ "$n" -gt 0 ] || { echo "nginx.conf: no security-headers include found" >&2; exit 1; }
perl -pi -e '
  s{^(\s*)include /etc/nginx/security-headers\.conf;\s*$}{$&${1}add_header Content-Security-Policy "$ENV{APP_CSP}" always;\n};
  s{^(\s*)include /etc/nginx/security-headers-docs\.conf;\s*$}{$&${1}add_header Content-Security-Policy "$ENV{DOCS_CSP}" always;\n};
' nginx.conf

# 4. One build arg per line; values may contain spaces.
cat > municipal.build-args <<EOF
SIMPLE_MODE=true
VITE_DEFAULT_LANGUAGE=sk
SITE_URL=$SITE_URL
VITE_BRAND_NAME=$BRAND
VITE_FOOTER_TEXT=Založené na open-source BentoPDF (AGPL-3.0), zdrojový kód: ${SOURCE_URL#https://}
VITE_WASM_PYMUPDF_URL=$WASM_URL/pymupdf/
VITE_WASM_GS_URL=$WASM_URL/gs/
VITE_WASM_CPDF_URL=$WASM_URL/cpdf/
VITE_TESSERACT_WORKER_URL=$WASM_URL/ocr/worker.min.js
VITE_TESSERACT_CORE_URL=$WASM_URL/ocr/core
VITE_TESSERACT_LANG_URL=$WASM_URL/ocr/lang-data
VITE_TESSERACT_AVAILABLE_LANGUAGES=$OCR_LANGS
VITE_OCR_FONT_BASE_URL=$WASM_URL/ocr/fonts
EOF

echo "prepare.sh: brand '$BRAND', assets under public/wasm ($(du -sh public/wasm | cut -f1)), strict CSP at $n include(s)"
