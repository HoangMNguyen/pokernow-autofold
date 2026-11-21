#!/usr/bin/env bash
# Runs tests/dom.test.html in headless Chromium and exits non-zero on any failure.
# Usage: tests/run-dom-tests.sh   (CHROMIUM=/path/to/chrome to override the browser)
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
browser="${CHROMIUM:-$(command -v chromium || command -v google-chrome || command -v google-chrome-stable || true)}"
if [[ -z "$browser" ]]; then
  echo "run-dom-tests: no chromium/google-chrome found (set CHROMIUM)" >&2
  exit 2
fi

profile="$(mktemp -d /tmp/pnaf-dom-tests.XXXXXX)"
trap 'rm -rf "$profile"' EXIT

dom="$("$browser" --headless=new --disable-gpu --mute-audio --no-first-run \
  --user-data-dir="$profile" --virtual-time-budget=5000 \
  --dump-dom "file://$here/dom.test.html" 2>/dev/null)"

results="$(printf '%s' "$dom" | tr '\n' '\r' \
  | sed -n 's/.*<pre id="results">\(.*\)<\/pre>.*/\1/p' | tr '\r' '\n' \
  | sed -e 's/&gt;/>/g' -e 's/&lt;/</g' -e 's/&quot;/"/g' -e 's/&amp;/\&/g')"

if [[ -z "$results" ]]; then
  echo "run-dom-tests: no results (page failed to run)" >&2
  exit 1
fi
printf '%s\n' "$results" | grep -v '^ran  '
if printf '%s' "$results" | head -n 1 | grep -q '^PNAF-DOM-TESTS PASS '; then
  exit 0
fi
exit 1
