#!/usr/bin/env bash
# Installs the Telegram plugin for vscode-antigravity-rtl (Linux / macOS):
#   curl -fsSL https://raw.githubusercontent.com/njfamirm/vscode-antigravity-telegram/main/install.sh | bash
# Uninstall: bash ~/.local/share/vscode-antigravity-telegram/install.sh --uninstall
set -euo pipefail

REPO="https://github.com/njfamirm/vscode-antigravity-telegram.git"
DIR="$HOME/.local/share/vscode-antigravity-telegram"
PLUGINS="$HOME/.config/vscode-antigravity-rtl/plugins"

if [ "${1:-}" = "--uninstall" ]; then
  rm -f "$PLUGINS/telegram.js"; rm -rf "$DIR"
  echo "Uninstalled. Restart VS Code."; exit 0
fi

[ -d "$HOME/.local/share/vscode-antigravity-rtl" ] || { echo "Install vscode-antigravity-rtl first." >&2; exit 1; }
if [ -d "$DIR/.git" ]; then git -C "$DIR" pull -q --ff-only; else git clone -q "$REPO" "$DIR"; fi
mkdir -p "$PLUGINS"
echo "module.exports = require('$DIR/telegram.js');" > "$PLUGINS/telegram.js"
echo "Installed. Restart VS Code, then run \"Antigravity: Plugins\" > \"Connect Telegram Bot\"."
