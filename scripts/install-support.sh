#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
SUPPORT_DIR="$HOME/Library/Application Support/Typora Annotations"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
PLIST="$LAUNCH_AGENTS_DIR/io.local.typora-annotations.helper.plist"
SKILL_SOURCE="$PROJECT_DIR/skill/typora-annotations"
AGENT_SKILL="$HOME/.agents/skills/typora-annotations"
CODEX_SKILL="$HOME/.codex/skills/typora-annotations"

mkdir -p "$SUPPORT_DIR" "$LAUNCH_AGENTS_DIR" "$HOME/Documents/typora" "$HOME/.agents/skills" "$HOME/.codex/skills"
cp "$PROJECT_DIR/tools/typora_annotations.py" "$SUPPORT_DIR/typora_annotations.py"
chmod +x "$SUPPORT_DIR/typora_annotations.py"

cp "$PROJECT_DIR/launchd/io.local.typora-annotations.helper.plist" "$PLIST"
sed -i '' "s|__HELPER_PATH__|$SUPPORT_DIR/typora_annotations.py|g; s|__LOG_PATH__|$SUPPORT_DIR/helper.log|g; s|__ERROR_LOG_PATH__|$SUPPORT_DIR/helper-error.log|g" "$PLIST"
plutil -lint "$PLIST"

rm -rf "$AGENT_SKILL"
cp -R "$SKILL_SOURCE" "$AGENT_SKILL"
if [[ -e "$CODEX_SKILL" || -L "$CODEX_SKILL" ]]; then
  rm -rf "$CODEX_SKILL"
fi
ln -s "$AGENT_SKILL" "$CODEX_SKILL"

launchctl bootout "gui/$(id -u)/io.local.typora-annotations.helper" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"
launchctl kickstart -k "gui/$(id -u)/io.local.typora-annotations.helper"

echo "Installed helper: $SUPPORT_DIR/typora_annotations.py"
echo "Installed global skill: $AGENT_SKILL"
echo "Annotation storage: $HOME/Documents/typora"
