#!/usr/bin/env bash
# Builds the macOS "CrystalSystemAudio" helper and ad-hoc signs it so macOS
# can grant it Screen Recording permission (unsigned binaries never get a TCC
# prompt). Output: native/SystemAudioCapture/.build/release/CrystalSystemAudio
#
# macOS-only, and a no-op everywhere else: the helper exists to work around
# macOS's lack of a system-audio capture API, and `swift`/`codesign` don't
# exist on a Windows or Linux machine. Skipping (rather than failing) is what
# lets `dev:electron` stay one command on every platform.
set -euo pipefail

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "Skipping the macOS system-audio helper on $(uname -s)."
  exit 0
fi

cd "$(dirname "$0")/SystemAudioCapture"

swift build -c release

BIN=".build/release/CrystalSystemAudio"
if [[ ! -x "$BIN" ]]; then
  echo "error: expected binary at $BIN" >&2
  exit 1
fi

# Ad-hoc code signature; required for the TCC screen-recording prompt.
codesign --force --sign - "$BIN"

echo "Built: $BIN"
