# vscode-antigravity-telegram

Telegram bot plugin for [vscode-antigravity-rtl](https://github.com/njfamirm/vscode-antigravity-rtl). Messages, voice notes and files sent to your bot go into the Antigravity chat, and the agent's reply comes back to Telegram.

> [!WARNING]
> Vibe-coded. Use at your own risk, no warranty.

## Install

Install `vscode-antigravity-rtl` first, then (Linux / macOS):

```bash
curl -fsSL https://raw.githubusercontent.com/njfamirm/vscode-antigravity-telegram/main/install.sh | bash
```

Restart VS Code, run **Antigravity: Plugins → Connect Telegram Bot**, paste the token from @BotFather, then send the pairing code to your bot.

## Commands (in Telegram)

- plain message: continues the last conversation
- reply to a bot message: continues that conversation
- `/new [text]`: starts a new conversation
- `/stop`: stops the agent

## Uninstall

```bash
bash ~/.local/share/vscode-antigravity-telegram/install.sh --uninstall
```

## License

MIT
