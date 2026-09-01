#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="$(python3 - <<'PY'
import json
with open('manifest.json', encoding='utf-8') as f:
    print(json.load(f)['version'])
PY
)"

EXPECTED_TAG="${1:-}"
if [[ -n "$EXPECTED_TAG" ]]; then
  EXPECTED_VERSION="${EXPECTED_TAG#v}"
  if [[ "$EXPECTED_VERSION" != "$VERSION" ]]; then
    echo "Tag/version mismatch: tag is $EXPECTED_TAG, manifest version is $VERSION" >&2
    exit 1
  fi
fi

DIST="$ROOT/dist"
CHROMIUM="$DIST/chromium"
FIREFOX="$DIST/firefox"

rm -rf "$DIST"
mkdir -p "$CHROMIUM" "$FIREFOX"

copy_tracked_files() {
  local target="$1"
  while IFS= read -r path; do
    case "$path" in
      .github/*|scripts/*|tests/*|package.json|package-lock.json|README.md|LICENSE|.gitignore)
        continue
        ;;
    esac
    mkdir -p "$target/$(dirname "$path")"
    cp "$path" "$target/$path"
  done < <(git ls-files)
}

copy_tracked_files "$CHROMIUM"
copy_tracked_files "$FIREFOX"

python3 - "$CHROMIUM/manifest.json" "$FIREFOX/manifest.json" <<'PY'
import copy
import json
import sys

chromium_path, firefox_path = sys.argv[1:]

with open(chromium_path, encoding='utf-8') as f:
    base = json.load(f)

chromium = copy.deepcopy(base)
chromium['permissions'] = [p for p in chromium.get('permissions', []) if p != 'offscreen'] + ['offscreen']
chromium['background'] = {
    'service_worker': 'background.js',
    'type': 'module',
}

firefox = copy.deepcopy(base)
firefox['permissions'] = [p for p in firefox.get('permissions', []) if p != 'offscreen']
firefox['background'] = {
    'scripts': ['background.js'],
    'type': 'module',
}
firefox['browser_specific_settings'] = {
    'gecko': {
        'id': 'chatgpt-export-md-html@alexey-sirotin',
        'strict_min_version': '128.0',
    }
}

for path, manifest in ((chromium_path, chromium), (firefox_path, firefox)):
    with open(path, 'w', encoding='utf-8', newline='\n') as f:
        json.dump(manifest, f, ensure_ascii=False, indent=2)
        f.write('\n')
PY

# Firefox creates Blob/Object URLs directly in its background document and does
# not use Chromium's offscreen page.
rm -f "$FIREFOX/offscreen.html" "$FIREFOX/offscreen.js"

CHROMIUM_ZIP="$DIST/chatgpt-export-md-html-${VERSION}-chromium.zip"
FIREFOX_ZIP="$DIST/chatgpt-export-md-html-${VERSION}-firefox.zip"

(
  cd "$CHROMIUM"
  zip -qr "$CHROMIUM_ZIP" .
)
(
  cd "$FIREFOX"
  zip -qr "$FIREFOX_ZIP" .
)

unzip -tq "$CHROMIUM_ZIP" >/dev/null
unzip -tq "$FIREFOX_ZIP" >/dev/null

echo "Created:"
echo "  $CHROMIUM_ZIP"
echo "  $FIREFOX_ZIP"
