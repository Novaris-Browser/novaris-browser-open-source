#!/usr/bin/env bash
# Builds the Linux .deb inside WSL.
#
# The project is copied into the WSL filesystem rather than built on /mnt/c,
# because a DrvFs mount cannot represent the file modes and symlinks a package
# build needs, and because npm install and the bundler are much slower there.
# The finished artifacts are copied back to the Windows release directory.
set -euo pipefail

SRC="/mnt/c/Users/norep/Downloads/Novaris Browser"
WORK="$HOME/novaris-build"

# The WSL interop path puts the Windows Node on PATH, and its stub is not
# executable from Linux, so the Linux install has to come first or every
# shebang that asks for "node" fails with a permission error.
export PATH="$HOME/.local/bin:$PATH"

echo "=== toolchain ==="
node -v
npm -v
echo "dpkg-deb: $(command -v dpkg-deb)"
echo "fakeroot: $(command -v fakeroot || echo MISSING)"

echo "=== syncing source ==="
rm -rf "$WORK"
mkdir -p "$WORK"
# node_modules, release and .git are excluded: node_modules is full of Windows
# binaries that cannot run here, and the other two are not build inputs.
tar -C "$SRC" -cf - \
  --exclude=node_modules \
  --exclude=release \
  --exclude=.git \
  --exclude=dist \
  . | tar -C "$WORK" -xf -
echo "copied $(find "$WORK" -type f | wc -l) files"

cd "$WORK"

echo "=== install ==="
npm install --no-audit --no-fund

echo "=== bundling renderer ==="
npm run build

echo "=== packaging deb ==="
npx electron-builder --linux deb --publish never

echo "=== artifacts ==="
ls -la "$WORK/release" || true
