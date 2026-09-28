#!/usr/bin/env bash
# Installs the same Node major version used on the Windows build, so the Linux
# package comes from a comparable toolchain rather than whatever Ubuntu ships.
# Installs into the user's home because /usr/local is not writable without root.
set -euo pipefail

WANT_MAJOR="${1:-24}"
PREFIX="$HOME/.local/nodejs"
BIN="$HOME/.local/bin"

echo "--- network check ---"
curl -sI --max-time 20 https://nodejs.org/dist/ | head -1

VERSION="$(curl -s --max-time 60 https://nodejs.org/dist/index.json \
  | python3 -c "
import json,sys
data=json.load(sys.stdin)
for v in data:
    if v['version'].startswith('v${WANT_MAJOR}.'):
        print(v['version']); break
")"

if [ -z "${VERSION}" ]; then
  echo "could not resolve a v${WANT_MAJOR}.x release"
  exit 1
fi

echo "resolved: ${VERSION}"
cd /tmp
curl -fsSL --max-time 600 "https://nodejs.org/dist/${VERSION}/node-${VERSION}-linux-x64.tar.xz" -o node.tar.xz
mkdir -p "${PREFIX}" "${BIN}"
tar -xJf node.tar.xz -C "${PREFIX}"
rm -f node.tar.xz

LINK="${PREFIX}/node-${VERSION}-linux-x64"
ln -sfn "${LINK}" "${PREFIX}/current"
for tool in node npm npx; do
  ln -sfn "${PREFIX}/current/bin/${tool}" "${BIN}/${tool}"
done

echo "--- installed ---"
"${BIN}/node" -v
"${BIN}/npm" -v
