#!/bin/bash
#
# Builds Gramatrix from this repository and installs it on macOS, Debian or Ubuntu:
#
#   ./install.sh
#
# Gramatrix ends up with your other apps and opens by itself. This needs no release, so it also
# tests the install before one exists. website/public/install.sh does the same from the latest
# release, and this script hands its build to that one so both install the same way.

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
    fail "Building Gramatrix needs Node.js $MINIMUM_NODE_MAJOR or newer, and this computer has $major. Get it from $NODE_URL"
}

# Checks the hardware instead of `uname -m`, which reports x86_64 inside a Rosetta terminal.
detect_mac_architecture() {
  if [ "$(sysctl -in hw.optional.arm64)" = '1' ]; then echo 'arm64'; else echo 'x64'; fi
}

main() {
  local system package architecture
  local -a targets
  system=$(uname -s)
  case "$system" in
    Darwin)
      architecture=$(detect_mac_architecture)
      targets=(--mac "--$architecture")
      package="dist/Gramatrix-mac-$architecture.zip"
      ;;
    Linux)
      command -v apt-get >/dev/null ||
        fail 'On Linux, Gramatrix installs on Debian, Ubuntu and systems based on them.'
      targets=(--linux deb --x64)
      package='dist/gramatrix-linux-amd64.deb'
      ;;
    *) fail 'Gramatrix runs on macOS, Debian and Ubuntu.' ;;
  esac

  cd "$(dirname "$0")"
  check_node
  build_log=$(mktemp -t gramatrix-build.XXXXXX)

  say 'Building Gramatrix. The first build takes a few minutes...'
  run_quietly npm ci
  run_quietly npm run build
  run_quietly npx electron-builder "${targets[@]}" --publish never

  GRAMATRIX_PACKAGE="$PWD/$package" bash website/public/install.sh
}

main "$@"
