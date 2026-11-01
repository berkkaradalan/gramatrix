#!/bin/bash
#
# Installs Gramatrix on macOS:
#
#   curl -fsSL https://gramatrix.com/install.sh | bash
#
# It runs once. Gramatrix then lives in the Applications folder like any other app, so it opens
# from Launchpad, Spotlight or the Dock and never needs the terminal again. Running this script
# again installs the latest version over the old one.
#
# To install from a clone of the repository instead of the latest release, run ./install.sh in its
# root. That script builds the app and passes the result here through GRAMATRIX_ZIP.

set -euo pipefail

readonly DOWNLOADS='https://github.com/berkkaradalan/gramatrix/releases/latest/download'
readonly APP='Gramatrix.app'
readonly QUIT_TIMEOUT_SECONDS=10

work_dir=''

# Messages go to stderr because download_release returns its result on stdout.
say() {
  printf '%s\n' "$1" >&2
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

clean_up() {
  if [ -n "$work_dir" ]; then rm -rf "$work_dir"; fi
}

# Checks the hardware instead of `uname -m`, which reports x86_64 inside a Rosetta terminal.
detect_architecture() {
  if [ "$(sysctl -in hw.optional.arm64)" = '1' ]; then echo 'arm64'; else echo 'x64'; fi
}

# People who are not administrators cannot write to /Applications, and macOS treats the
# Applications folder in their home the same way.
choose_install_dir() {
  local system_dir="${GRAMATRIX_INSTALL_DIR:-/Applications}"
  if [ -w "$system_dir" ]; then
    echo "$system_dir"
  else
    mkdir -p "$HOME/Applications"
    echo "$HOME/Applications"
  fi
}

download_release() {
  local file="Gramatrix-mac-$(detect_architecture).zip"
  say 'Downloading Gramatrix...'
  curl --fail --location --progress-bar --output "$work_dir/$file" "$DOWNLOADS/$file" ||
    fail 'The download failed. Check your connection and try again.'
  curl --fail --location --silent --output "$work_dir/SHA256SUMS" "$DOWNLOADS/SHA256SUMS" ||
    fail 'Could not get the checksums for this release.'

  say 'Verifying the download...'
  (cd "$work_dir" && grep " $file\$" SHA256SUMS | shasum -a 256 -c - >/dev/null 2>&1) ||
    fail 'The download is damaged or incomplete, so nothing was installed. Try again.'
  echo "$work_dir/$file"
}

# Apple Silicon refuses to start an app without a valid signature, even an ad-hoc one. Release
# builds carry one, and this repairs a copy that lost it.
check_signature() {
  codesign --verify --deep --strict "$1" >/dev/null 2>&1 ||
    codesign --force --deep --sign - "$1" >/dev/null 2>&1 ||
    fail 'The app could not be signed, so nothing was installed.'
}

quit_running_app() {
  pgrep -x 'Gramatrix' >/dev/null || return 0
  say 'Closing Gramatrix...'
  osascript -e 'quit app "Gramatrix"' >/dev/null 2>&1 || true
  local waited=0
  while pgrep -x 'Gramatrix' >/dev/null; do
    if [ "$waited" -ge "$QUIT_TIMEOUT_SECONDS" ]; then
      fail 'Gramatrix is still running. Close it and run this command again.'
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

# All the work stays inside functions, so a connection that drops while this file is being read
# cannot run half of it.
main() {
  [ "$(uname -s)" = 'Darwin' ] ||
    fail 'This installer is for macOS. On Linux, get the .deb from https://gramatrix.com/#download'

  local install_dir zip target
  install_dir=$(choose_install_dir)
  target="$install_dir/$APP"
  work_dir=$(mktemp -d "$install_dir/.gramatrix-install.XXXXXX")
  trap clean_up EXIT

  if [ -n "${GRAMATRIX_ZIP:-}" ]; then
    zip=$GRAMATRIX_ZIP
    [ -f "$zip" ] || fail "There is no file at $zip."
  else
    zip=$(download_release)
  fi

  say 'Installing...'
  ditto -x -k "$zip" "$work_dir/unpacked" || fail 'The download could not be unpacked.'
  [ -d "$work_dir/unpacked/$APP" ] || fail "The download does not contain $APP."
  check_signature "$work_dir/unpacked/$APP"

  quit_running_app
  rm -rf "$target"
  mv "$work_dir/unpacked/$APP" "$target"
  open "$target" || true

  say ''
  say "Gramatrix is installed in $install_dir."
  say 'From now on, open it from Launchpad, Spotlight or your Dock like any other app.'
  say 'You can close this terminal window.'
}

main "$@"
