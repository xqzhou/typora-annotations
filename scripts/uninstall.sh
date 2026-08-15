#!/bin/bash
set -euo pipefail

APP="${1:-/Applications/Typora.app}"
VERSION="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$APP/Contents/Info.plist" 2>/dev/null || echo unknown)"
BACKUP="$(dirname "$APP")/Typora-${VERSION}-original.backup"
REMOVED="$(dirname "$APP")/Typora-${VERSION}-annotations-removed.backup"

if [[ ! -d "$BACKUP" ]]; then
  echo "Backup not found: $BACKUP" >&2
  exit 1
fi

if [[ -e "$REMOVED" ]]; then
  echo "Refusing to overwrite existing removed-app backup: $REMOVED" >&2
  exit 1
fi

mv "$APP" "$REMOVED"
if ! mv "$BACKUP" "$APP"; then
  mv "$REMOVED" "$APP"
  exit 1
fi
codesign --verify --deep --strict "$APP"
echo "Removed Typora Annotations from $APP"
echo "Patched app retained at: $REMOVED"
