#!/bin/bash
#
# Builds Gramatrix from this repository and installs it on macOS:
#
#   ./install.sh
#
# Gramatrix ends up in the Applications folder and opens by itself. This needs no release, so it
# also tests the Mac install before one exists. website/public/install.sh does the same from the
# latest release, and this script hands its build to that one so both install the same way.

set -euo pipefail

readonly MINIMUM_NODE_MAJOR=22
readonly NODE_URL='https://nodejs.org'

build_log=''

say() {
  printf '%s\n' "$1"
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

# Keeps the terminal readable, and shows the end of the output only when a step fails.
run_quietly() {
  if ! "$@" >>"$build_log" 2>&1; then
    tail -n 20 "$build_log" >&2
    fail "The build failed. The full log is at $build_log"
  fi
}

check_node() {
  command -v node >/dev/null ||
    fail "Building Gramatrix needs Node.js $MINIMUM_NODE_MAJOR or newer. Get it from $NODE_URL"
  local major
  major=$(node -p 'process.versions.node.split(".")[0]')
  [ "$major" -ge "$MINIMUM_NODE_MAJOR" ] ||
    fail "Building Gramatrix needs Node.js $MINIMUM_NODE_MAJOR or newer, and this Mac has $major. Get it from $NODE_URL"
}

# Checks the hardware instead of `uname -m`, which reports x86_64 inside a Rosetta terminal.
detect_architecture() {
  if [ "$(sysctl -in hw.optional.arm64)" = '1' ]; then echo 'arm64'; else echo 'x64'; fi
}

main() {
  [ "$(uname -s)" = 'Darwin' ] || fail 'This installer is for macOS.'
  cd "$(dirname "$0")"
  check_node

  local architecture
  architecture=$(detect_architecture)
  build_log=$(mktemp -t gramatrix-build.XXXXXX)

  say 'Building Gramatrix. The first build takes a few minutes...'
  run_quietly npm ci
  run_quietly npm run build
  run_quietly npx electron-builder --mac "--$architecture" --publish never

  GRAMATRIX_ZIP="$PWD/dist/Gramatrix-mac-$architecture.zip" bash website/public/install.sh
}

main "$@"
