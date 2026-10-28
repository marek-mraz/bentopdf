#!/usr/bin/env bash
# Prepares a throwaway checkout for the municipal image. Nothing here is ever
# committed, so upstream merges stay conflict-free and new upstream code gets
# the same treatment on the next build.
#   1. Replaces the visible product name with a placeholder.
#   2. Bundles every runtime WASM, OCR and font asset under public/wasm using
#      upstream's air-gap tooling, so the browser loads no code from a CDN.
#   3. Adds a second, self-only Content-Security-Policy. Browsers enforce every
#      CSP they receive, so no third-party origin can load even if upstream's
#      generated policy lists one.
#   4. Writes the matching Docker build args to municipal.build-args.
#   5. Installs runtime-config.sh and makes nginx swap the brand, footer and
#      site URL placeholders for the container's env while serving (nothing is
#      baked in, and the web root stays read-only).
#   6. Pins the Dockerfile's build stage to the builder's own platform: it only
#      produces static files, so an arm64 image needs no emulated npm build.
#      Both base images are pinned by digest.
# Every third-party binary (downloaded or committed upstream) must match
# binaries.sha256, so a changed or new binary stops the build until a person
# has checked where it comes from (UPDATE_BINARIES=1 rewrites the list).
# Usage (repo root of a throwaway checkout):
#   prepare.sh <ocr_languages> [source_url]
set -euo pipefail
# Multi-arch digests on version tags (quay.io deletes a digest once no tag
# points at it, so a rolling tag like alpine-slim breaks the pin within weeks).
# Refresh with: docker buildx imagetools inspect <image>
NODE_IMAGE=mirror.gcr.io/library/node:26.12.1-alpine3.24@sha256:40cd011b55415bc894e45b02fdd5a5dfde056921b7d23a64c74f80497af48797
NGINX_IMAGE=quay.io/nginx/nginx-unprivileged:1.31.8-alpine3.24-slim@sha256:629d3227f39ec10201345e420e2d9d430e463a9893d374b515a8eb6541e71938
OCR_LANGS=$1
SOURCE_URL=${2:-https://github.com/${GITHUB_REPOSITORY:-marek-mraz/bentopdf}}
HERE=$(cd "$(dirname "$0")" && pwd)
# Placeholders; runtime-config.sh lists the same three strings.
BRAND=KONVERTOR_BRAND_TOKEN
SITE_URL=https://konvertor-site.invalid
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
# Upstream fetches the newest CoherentPDF; take the reviewed release.
perl -pi -e 's/npm pack coherentpdf --quiet/npm pack coherentpdf\@2.5.5 --quiet/' scripts/prepare-airgap.sh
grep -qF 'npm pack coherentpdf@2.5.5' scripts/prepare-airgap.sh || { echo "prepare-airgap.sh: coherentpdf fetch not found" >&2; exit 1; }
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

# 2b. Third-party binaries: everything bundled above plus the WASM, viewers and
# engine tarballs upstream commits. OCR data for languages not chosen in this
# build may be missing from the image; nothing may differ or be new.
LOCK="$HERE/binaries.sha256"
{ find public/wasm public/libreoffice-wasm public/pdfjs-viewer public/pdfjs-annotation-viewer vendor -type f -print0
  printf '%s\0' public/qpdf.wasm public/coherentpdf.browser.min.js
} | LC_ALL=C sort -z | xargs -0 sha256sum > "$TMP/binaries.sha256"
if [ "${UPDATE_BINARIES:-}" = 1 ]; then
  cp "$TMP/binaries.sha256" "$LOCK"
  echo "prepare.sh: rewrote binaries.sha256; review the diff before committing it"
else
  langdata=' public/wasm/ocr/lang-data/'
  changed=$(diff <(grep -vF "$langdata" "$LOCK") <(grep -vF "$langdata" "$TMP/binaries.sha256") || true)
  unknown=$(grep -F "$langdata" "$TMP/binaries.sha256" | LC_ALL=C comm -23 - <(LC_ALL=C sort "$LOCK") || true)
  if [ -n "$changed$unknown" ]; then
    printf 'Third-party binaries differ from binaries.sha256 (< expected, > found):\n%s\n%s\n' "$changed" "$unknown" >&2
    echo "Check where the files come from, then rerun with UPDATE_BINARIES=1 and commit the reviewed list." >&2
    exit 1
  fi
fi

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

# 3b. With absolute_redirect off, upstream's slash-cleanup rewrites send
# //evil.com/ or /\evil.com/ back as "Location: //evil.com", an open redirect.
# Refuse such paths before any redirect rule runs (\x5c = backslash).
perl -pi -e 's{^(\s*)absolute_redirect off;\s*$}{$&${1}if (\$request_uri ~ ^/[/\\x5c]) { return 404; }\n}' nginx.conf
grep -qF 'if ($request_uri ~ ^/[/\x5c])' nginx.conf || { echo "nginx.conf: absolute_redirect line not found" >&2; exit 1; }

# 3c. Simple mode hides How It Works, Related Tools and the FAQ on tool pages.
# Keep the FAQ: it answers citizens' questions about each tool.
perl -0pi -e "s/\n\s*'faq\.sectionTitle',//; s/\n\s*'Frequently Asked Questions',//" src/js/utils/simple-mode-footer.ts
! grep -qE "faq\.sectionTitle|Frequently Asked Questions" src/js/utils/simple-mode-footer.ts || { echo "simple-mode-footer.ts: FAQ entries not removed" >&2; exit 1; }

# 3d. nginx swaps the placeholders while serving: runtime-config.sh writes the
# values as variables to /etc/nginx/tmp/municipal.conf at start. sub_filter
# cannot edit pre-compressed files, so gzip_static stays on only for WASM and
# data files, which carry no placeholders; the rest is gzipped on the fly.
# The swapped files drop Last-Modified (sub_filter default) and ETag, so a
# browser never gets 304 with the old brand after the env changes; binary files
# keep Last-Modified. nginx's temp files go to /etc/nginx/tmp too: a read-only
# pod needs only that directory.
perl -0pi -e 's{^([ \t]*)gzip_static on;\n}{${1}gzip_static off;\n${1}include /etc/nginx/tmp/municipal.conf;\n${1}client_body_temp_path /etc/nginx/tmp/client_body;\n${1}proxy_temp_path /etc/nginx/tmp/proxy;\n${1}fastcgi_temp_path /etc/nginx/tmp/fastcgi;\n${1}uwsgi_temp_path /etc/nginx/tmp/uwsgi;\n${1}scgi_temp_path /etc/nginx/tmp/scgi;\n${1}sub_filter_once off;\n${1}etag off;\n${1}sub_filter_types text/xml text/plain text/css text/javascript application/javascript application/json application/xml application/manifest+json;\n${1}sub_filter KONVERTOR_BRAND_TOKEN \$konvertor_brand;\n${1}sub_filter KONVERTOR_FOOTER_TOKEN \$konvertor_footer;\n${1}sub_filter https://konvertor-site.invalid \$konvertor_site;\n}m
  or die "nginx.conf: gzip_static line not found\n";
  s{^(\s*location ~\* \\\.\(wasm\|wasm\\\.gz\|data\|data\\\.gz\)\$ \{\n)}{$1            gzip_static on;\n}m
  or die "nginx.conf: wasm location not found\n"' nginx.conf

# 3e. The annotation viewer (Add Stamps) defines HASH_PARAMS in an inline
# script, which the self-only CSP blocks; serve it as a file instead.
perl -0pi -e 's{<script>(\s*// Provide a minimal HASH_PARAMS.*?)</script>}{
    open(my $f, ">", "public/pdfjs-annotation-viewer/web/hash-params.js") or die "hash-params.js: $!\n";
    print $f "$1\n"; close $f; q{<script src="hash-params.js"></script>} }se
  or die "annotation viewer.html: HASH_PARAMS script not found\n"' public/pdfjs-annotation-viewer/web/viewer.html

# 4. One build arg per line; values may contain spaces.
cat > municipal.build-args <<EOF
SIMPLE_MODE=true
VITE_DEFAULT_LANGUAGE=sk
SITE_URL=$SITE_URL
VITE_BRAND_NAME=$BRAND
VITE_FOOTER_TEXT=KONVERTOR_FOOTER_TOKEN
VITE_WASM_PYMUPDF_URL=$WASM_URL/pymupdf/
VITE_WASM_GS_URL=$WASM_URL/gs/
VITE_WASM_CPDF_URL=$WASM_URL/cpdf/
VITE_TESSERACT_WORKER_URL=$WASM_URL/ocr/worker.min.js
VITE_TESSERACT_CORE_URL=$WASM_URL/ocr/core
VITE_TESSERACT_LANG_URL=$WASM_URL/ocr/lang-data
VITE_TESSERACT_AVAILABLE_LANGUAGES=$OCR_LANGS
VITE_OCR_FONT_BASE_URL=$WASM_URL/ocr/fonts
EOF

# 5. Upstream's Dockerfile already copies nginx-noindex.sh into the nginx
# entrypoint directory; add ours next to it.
sed "s|@SOURCE_URL@|${SOURCE_URL#https://}|" "$HERE/runtime-config.sh" > municipal-runtime.sh
perl -0pi -e 's{^(COPY [^\n]*nginx-noindex\.sh [^\n]*\n)}{$1COPY --chown=nginx:nginx --chmod=755 municipal-runtime.sh /docker-entrypoint.d/90-municipal-config.sh\n}m
  or die "Dockerfile: nginx-noindex.sh COPY line not found\n"' Dockerfile
# The generated security headers list the WASM origin, which is the site
# itself; 'self' says the same without a placeholder in the nginx config.
perl -0pi -e 's{^(COPY [^\n]*security-headers-docs\.conf [^\n]*\n)}{$1RUN sed -i "s|https://konvertor-site\\.invalid|'"'"'self'"'"'|g" /etc/nginx/security-headers.conf /etc/nginx/security-headers-docs.conf\n}m
  or die "Dockerfile: security-headers-docs.conf COPY line not found\n"' Dockerfile

# 6. Only the nginx stage is built per platform; both stages from pinned digests.
NODE_IMAGE=$NODE_IMAGE NGINX_IMAGE=$NGINX_IMAGE perl -0pi -e 's{^FROM mirror\.gcr\.io/library/node:26-alpine AS builder$}{FROM --platform=\$BUILDPLATFORM $ENV{NODE_IMAGE} AS builder}m
    or die "Dockerfile: builder FROM line changed, review and update NODE_IMAGE\n";
  s{^FROM quay\.io/nginx/nginx-unprivileged:alpine-slim$}{FROM $ENV{NGINX_IMAGE}}m
    or die "Dockerfile: nginx FROM line changed, review and update NGINX_IMAGE\n"' Dockerfile

echo "prepare.sh: placeholders for brand/footer/site, assets under public/wasm ($(du -sh public/wasm | cut -f1)), strict CSP at $n include(s)"
