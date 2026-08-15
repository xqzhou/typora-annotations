#!/bin/bash
set -euo pipefail

APP="${1:-/Applications/Typora.app}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo unknown)"
BACKUP="$(dirname "$APP")/Typora-${VERSION}-original.backup"
STAGE_DIR="$(mktemp -d /private/tmp/typora-annotations-install.XXXXXX)"
STAGED_APP="$STAGE_DIR/Typora.app"
OLD_APP="$STAGE_DIR/Typora.previous.app"

cleanup() {
  rm -rf "$STAGE_DIR"
}
trap cleanup EXIT

if [[ ! -f "$APP/Contents/Resources/TypeMark/index.html" ]]; then
  echo "Typora index.html not found in: $APP" >&2
  exit 1
fi

cp -R "$APP" "$STAGED_APP"
TYPEMARK="$STAGED_APP/Contents/Resources/TypeMark"
INDEX="$TYPEMARK/index.html"

cp "$PROJECT_DIR/typora-annotations.js" "$TYPEMARK/typora-annotations.js"
cp "$PROJECT_DIR/typora-annotations.css" "$TYPEMARK/typora-annotations.css"

/usr/bin/python3 - "$INDEX" <<'PY'
from pathlib import Path
import sys

path = Path(sys.argv[1])
text = path.read_text()
marker = "typora-annotations.js"
if marker not in text:
    injection = "\n\t<!-- Typora local annotations extension -->\n\t<link rel=\"stylesheet\" href=\"./typora-annotations.css\">\n\t<script src=\"./typora-annotations.js\"></script>\n"
    if "</body>" not in text:
        raise SystemExit("Could not find </body> injection point")
    text = text.replace("</body>", injection + "</body>", 1)
    path.write_text(text)
PY

codesign --force --deep --sign - --options runtime --entitlements "$PROJECT_DIR/typora-annotations.entitlements.plist" "$STAGED_APP"
codesign --verify --deep --strict "$STAGED_APP"

if [[ ! -e "$BACKUP" ]]; then
  mv "$APP" "$BACKUP"
else
  mv "$APP" "$OLD_APP"
fi
if ! mv "$STAGED_APP" "$APP"; then
  if [[ -e "$OLD_APP" ]]; then
    mv "$OLD_APP" "$APP"
  elif [[ -e "$BACKUP" ]]; then
    mv "$BACKUP" "$APP"
  fi
  exit 1
fi

echo "Installed Typora Annotations into $APP"
echo "Original app backup: $BACKUP"
"$SCRIPT_DIR/install-support.sh"
