#!/bin/bash
#
# Installs Gramatrix on macOS, Debian and Ubuntu:
#
#   curl -fsSL https://gramatrix.com/install.sh | bash
#
# It runs once. Gramatrix then lives with your other apps, in the Applications folder on a Mac and
# in the applications menu on Linux, and never needs the terminal again. Running this script again
# installs the latest version over the old one.
#
# To install from a clone of the repository instead of the latest release, run ./install.sh in its
# root. That script builds the app and passes the result here through GRAMATRIX_PACKAGE.

set -euo pipefail

readonly DOWNLOADS='https://github.com/berkkaradalan/gramatrix/releases/latest/download'
readonly APP='Gramatrix.app'
readonly LINUX_PACKAGE='gramatrix-linux-amd64.deb'
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

download_release() {
  local file=$1
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

# Takes the process name, then the command that asks it to quit.
quit_running_app() {
  local process=$1
  shift
  pgrep -x "$process" >/dev/null || return 0
  say 'Closing Gramatrix...'
  "$@" >/dev/null 2>&1 || true
  local waited=0
  while pgrep -x "$process" >/dev/null; do
    if [ "$waited" -ge "$QUIT_TIMEOUT_SECONDS" ]; then
      fail 'Gramatrix is still running. Close it and run this command again.'
    fi
    sleep 1
    waited=$((waited + 1))
  done
}

# Checks the hardware instead of `uname -m`, which reports x86_64 inside a Rosetta terminal.
detect_mac_architecture() {
  if [ "$(sysctl -in hw.optional.arm64)" = '1' ]; then echo 'arm64'; else echo 'x64'; fi
}

# People who are not administrators cannot write to /Applications, and macOS treats the
# Applications folder in their home the same way.
choose_mac_install_dir() {
  local system_dir="${GRAMATRIX_INSTALL_DIR:-/Applications}"
  if [ -w "$system_dir" ]; then
    echo "$system_dir"
  else
    mkdir -p "$HOME/Applications"
    echo "$HOME/Applications"
  fi
}

# Apple Silicon refuses to start an app without a valid signature, even an ad-hoc one. Release
# builds carry one, and this repairs a copy that lost it.
check_mac_signature() {
  codesign --verify --deep --strict "$1" >/dev/null 2>&1 ||
    codesign --force --deep --sign - "$1" >/dev/null 2>&1 ||
    fail 'The app could not be signed, so nothing was installed.'
}

install_on_mac() {
  local install_dir zip target
  install_dir=$(choose_mac_install_dir)
  target="$install_dir/$APP"
  work_dir=$(mktemp -d "$install_dir/.gramatrix-install.XXXXXX")
  trap clean_up EXIT

  if [ -n "${GRAMATRIX_PACKAGE:-}" ]; then
    zip=$GRAMATRIX_PACKAGE
    [ -f "$zip" ] || fail "There is no file at $zip."
  else
    zip=$(download_release "Gramatrix-mac-$(detect_mac_architecture).zip")
  fi

  say 'Installing...'
  ditto -x -k "$zip" "$work_dir/unpacked" || fail 'The download could not be unpacked.'
  [ -d "$work_dir/unpacked/$APP" ] || fail "The download does not contain $APP."
  check_mac_signature "$work_dir/unpacked/$APP"

  quit_running_app 'Gramatrix' osascript -e 'quit app "Gramatrix"'
  rm -rf "$target"
  mv "$work_dir/unpacked/$APP" "$target"
  open "$target" || true

  say ''
  say "Gramatrix is installed in $install_dir."
  say 'From now on, open it from Launchpad, Spotlight or your Dock like any other app.'
  say 'You can close this terminal window.'
}

run_as_root() {
  if [ "$(id -u)" = '0' ]; then "$@"; else sudo "$@"; fi
}

check_linux_system() {
  command -v apt-get >/dev/null ||
    fail 'On Linux, Gramatrix installs on Debian, Ubuntu and systems based on them.'
  [ "$(dpkg --print-architecture)" = 'amd64' ] ||
    fail 'On Linux, Gramatrix is only built for 64-bit Intel and AMD processors.'
}

# A root session has no desktop to open the app on, and Chromium refuses to run as root.
open_on_linux() {
  [ "$(id -u)" != '0' ] && [ -n "${DISPLAY:-}${WAYLAND_DISPLAY:-}" ] || return 0
  setsid --fork gramatrix </dev/null >/dev/null 2>&1 || true
}

install_on_linux() {
  check_linux_system
  work_dir=$(mktemp -d)
  # apt reads packages as its own unprivileged user.
  chmod 755 "$work_dir"
  trap clean_up EXIT

  local package
  if [ -n "${GRAMATRIX_PACKAGE:-}" ]; then
    [ -f "$GRAMATRIX_PACKAGE" ] || fail "There is no file at $GRAMATRIX_PACKAGE."
    package="$work_dir/$LINUX_PACKAGE"
    cp "$GRAMATRIX_PACKAGE" "$package"
    chmod 644 "$package"
  else
    package=$(download_release "$LINUX_PACKAGE")
  fi

  quit_running_app 'gramatrix' pkill -x 'gramatrix'
  say 'Installing. Your password may be needed for this step...'
  # With `curl | bash`, stdin is this script, so apt must not read from it.
  run_as_root apt-get install -y "$package" </dev/null ||
    fail 'apt could not install Gramatrix. See the messages above.'
  open_on_linux

  say ''
  say 'Gramatrix is installed.'
  say 'From now on, open it from your applications menu like any other app.'
  say 'You can close this terminal window.'
}

# All the work stays inside functions, so a connection that drops while this file is being read
# cannot run half of it.
main() {
  case "$(uname -s)" in
    Darwin) install_on_mac ;;
    Linux) install_on_linux ;;
    *) fail 'Gramatrix runs on macOS, Debian and Ubuntu.' ;;
  esac
}

main "$@"
