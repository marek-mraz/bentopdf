#!/usr/bin/env bash
# Rebuilds the PDF engine from source with the container and build script
# upstream's CI uses, without any build cache, and checks that the result is
# bit-identical to the tarball the image ships: the municipal one in engine/
# (upstream's engine plus engine/*.patch) when present, else
# vendor/bentopdf-pdfium. WRITE=1 writes the build into engine/ instead.
# Needs Docker, ~1 hour and ~20 GB of disk. Usage (repo root): verify-engine.sh
set -euo pipefail
HERE=$(cd "$(dirname "$0")" && pwd)
REV=$(tr -d '\r\n' < vendor/bentopdf-pdfium/.upstream-version)
OUT_TGZ="$HERE/engine/bentopdf-pdfium-$REV.tgz"
VENDOR_TGZ=$(ls "$PWD"/vendor/bentopdf-pdfium/bentopdf-pdfium-*.tgz)
TGZ=$OUT_TGZ
[ -f "$TGZ" ] || TGZ=$VENDOR_TGZ
WORK=$(mktemp -d)
VOL=pdfium-verify-$$
cleanup() {
  docker volume rm -f "$VOL" >/dev/null 2>&1 || true
  # The build container writes as root.
  docker run --rm -v "$WORK:/w" alpine rm -rf /w/src >/dev/null 2>&1 || true
  rm -rf "$WORK"
}
trap cleanup EXIT

git clone -q https://github.com/alam00000/bentopdf-pdfium-viewer.git "$WORK/src"
cd "$WORK/src"
git checkout -q "$REV"
echo "== engine source $(git rev-parse HEAD)"
git submodule update --init --depth 1 packages/pdfium/pdfium-src \
  || git submodule update --init packages/pdfium/pdfium-src

# Same steps as .github/workflows/build-pdfium.yml upstream.
cd packages/pdfium
for p in security-fixes editcore-pdfium; do
  if ! git -C pdfium-src apply --reverse --check "$PWD/build/patch/$p.patch" 2>/dev/null; then
    git -C pdfium-src apply "$PWD/build/patch/$p.patch"
  fi
done
# Municipal fixes on top (only for the engine/ tarball). A Windows checkout
# turns the patches into CRLF; the PDFium sources are LF.
if [ "$TGZ" = "$OUT_TGZ" ] || [ "${WRITE:-}" = 1 ]; then
  for p in "$HERE"/engine/*.patch; do
    echo "== municipal patch $(basename "$p")"
    tr -d '\r' < "$p" | git -C pdfium-src apply
  done
fi
docker build --platform linux/amd64 --target pdfium-deps -t pdfium-verify-deps .
# docker run instead of their compose file: its mem_limit fails on some hosts.
docker run --rm --platform linux/amd64 -w /workspace -e TZ=Etc/UTC \
  -v "$WORK/src:/workspace" -v "$VOL:/workspace/packages/pdfium/pdfium-src/out/wasm" \
  --entrypoint /usr/bin/tini pdfium-verify-deps -- /workspace/packages/pdfium/scripts/build.sh

if [ "${WRITE:-}" = 1 ]; then
  # Same package layout as upstream's update-bentopdf-viewer.yml.
  mkdir -p "$WORK/out/package"
  cp src/vendor/pdfium.js "$WORK/out/package/editcore.js"
  cp src/vendor/pdfium.wasm "$WORK/out/package/editcore.wasm"
  tar xzf "$VENDOR_TGZ" -C "$WORK/out" package/package.json
  # Fixed order, owner, modes and times: the same build gives the same tarball.
  chmod 755 "$WORK/out/package" && chmod 644 "$WORK/out/package"/*
  tar -czf "$OUT_TGZ" --sort=name --owner=0 --group=0 --numeric-owner \
    --mtime=@0 -C "$WORK/out" package
  echo "wrote $OUT_TGZ"
  sha256sum "$WORK/out/package/editcore.wasm" "$WORK/out/package/editcore.js"
  exit 0
fi

mkdir "$WORK/vendored"
tar xzf "$TGZ" -C "$WORK/vendored"
fail=0
echo "== comparing with $TGZ"
for pair in "editcore.wasm pdfium.wasm" "editcore.js pdfium.js"; do
  set -- $pair
  want=$(sha256sum "$WORK/vendored/package/$1" | cut -c1-64)
  got=$(sha256sum "src/vendor/$2" | cut -c1-64)
  if [ "$want" = "$got" ]; then echo "MATCH     $1 $got"; else echo "DIFFERENT $1 vendored $want built $got"; fail=1; fi
done
exit $fail
