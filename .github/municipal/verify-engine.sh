#!/usr/bin/env bash
# Rebuilds the vendored PDF engine (vendor/bentopdf-pdfium) from source with
# the container and build script upstream's CI uses, without any build cache,
# and checks that the result is bit-identical to the vendored tarball.
# Needs Docker, ~1 hour and ~20 GB of disk. Usage (repo root): verify-engine.sh
set -euo pipefail
REV=$(cat vendor/bentopdf-pdfium/.upstream-version)
TGZ=$(ls "$PWD"/vendor/bentopdf-pdfium/bentopdf-pdfium-*.tgz)
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
docker build --platform linux/amd64 --target pdfium-deps -t pdfium-verify-deps .
# docker run instead of their compose file: its mem_limit fails on some hosts.
docker run --rm --platform linux/amd64 -w /workspace -e TZ=Etc/UTC \
  -v "$WORK/src:/workspace" -v "$VOL:/workspace/packages/pdfium/pdfium-src/out/wasm" \
  --entrypoint /usr/bin/tini pdfium-verify-deps -- /workspace/packages/pdfium/scripts/build.sh

mkdir "$WORK/vendored"
tar xzf "$TGZ" -C "$WORK/vendored"
fail=0
for pair in "editcore.wasm pdfium.wasm" "editcore.js pdfium.js"; do
  set -- $pair
  want=$(sha256sum "$WORK/vendored/package/$1" | cut -c1-64)
  got=$(sha256sum "src/vendor/$2" | cut -c1-64)
  if [ "$want" = "$got" ]; then echo "MATCH     $1 $got"; else echo "DIFFERENT $1 vendored $want built $got"; fail=1; fi
done
exit $fail
