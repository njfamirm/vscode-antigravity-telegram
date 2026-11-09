// Plugin for vscode-antigravity-rtl. Telegram bot bridge: messages, voice notes and files sent to the bot go into the
// Antigravity chat, and the agent's reply is sent back. Runs in the VS Code extension host.
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const CONFIG_DIR = path.join(os.homedir(), '.config', 'vscode-antigravity-rtl');
const CONFIG_FILE = path.join(CONFIG_DIR, 'telegram.json');
const FILES_DIR = path.join(os.tmpdir(), 'antigravity-telegram');
const MAX_TG = 4000; // Telegram limit is 4096 chars per message

let config = null;
let pairingCode = null;
let generation = 0; // bumping it stops the current poll loop
let running = false;
let poll = null; // AbortController of the in-flight getUpdates
let host = null; // { run(prompt, onSent) => Promise<{ text, conv, title } | null>, stop() }, set by rtl-proxy

// Multi-chat: replying to a bot message continues that message's conversation; a plain
// message continues the last one; /new starts a new one. Everything is sent right away.
const convByMessage = new Map(); // Telegram message id -> Antigravity conversation id
let lastConv = null;
let startNew = false;

function loadConfig() {
  try { config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')); } catch (e) { config = null; }
  return config;
}

function saveConfig(c) {
  fs.mkdirSync(CONFIG_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(c, null, 2), { mode: 0o600 });
  config = c;
}

async function api(method, body, signal) {
  const res = await fetch(`https://api.telegram.org/bot${config.token}/${method}`, {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json();
  if (!json.ok) { const e = new Error(json.description || method + ' failed'); e.code = json.error_code; throw e; }
  return json.result;
}

async function send(text, replyTo, conv) {
  if (!config || !config.chatId) return;
  text = String(text || '').trim() || '(empty reply)';
  for (let i = 0; i < text.length; i += MAX_TG) {
    try {
      const m = await api('sendMessage', {
        chat_id: config.chatId,
        text: text.slice(i, i + MAX_TG),
        reply_parameters: replyTo ? { message_id: replyTo, allow_sending_without_reply: true } : undefined,
      });
      if (conv) remember(m.message_id, conv);
    } catch (e) {}
  }
}

function remember(messageId, conv) {
  convByMessage.set(messageId, conv);
  if (convByMessage.size > 1000) convByMessage.delete(convByMessage.keys().next().value);
}

async function run(p) {
  const onSent = (conv) => {
    if (conv) { lastConv = conv; remember(p.messageId, conv); }
    send('⏳ Sent to the agent…', p.messageId, conv);
  };
  let r = null;
  try { r = host && (await host.run(p, onSent)); } catch (e) {}
  if (!r) return send('⚠️ Antigravity chat is not open in VS Code.', p.messageId);
  const header = r.title ? '💬 ' + r.title + '\n\n' : '';
  await send(header + (r.text || '(empty reply)'), p.messageId, r.conv);
}

async function download(fileId, name) {
  const f = await api('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${config.token}/${f.file_path}`);
  if (!res.ok) throw new Error('download failed');
  fs.mkdirSync(FILES_DIR, { recursive: true });
  const safe = (name || path.basename(f.file_path)).replace(/[^\w.\-]+/g, '_');
  const out = path.join(FILES_DIR, Date.now() + '-' + safe);
  fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
  return out;
}

async function handle(msg) {
  const chatId = msg.chat.id;

  // Pairing: the first person to send the code shown in VS Code becomes the owner.
  if (!config.chatId) {
    if (pairingCode && (msg.text || '').trim() === pairingCode) {
      saveConfig(Object.assign({}, config, { chatId }));
      pairingCode = null;
      await send('✅ Connected to Antigravity in VS Code.');
    } else {
      try { await api('sendMessage', { chat_id: chatId, text: 'Send the pairing code shown in VS Code.' }); } catch (e) {}
    }
    return;
  }
  if (chatId !== config.chatId) return; // ignore everyone else

  const files = [];
  try {
    if (msg.voice) files.push(await download(msg.voice.file_id, 'voice.ogg'));
    if (msg.audio) files.push(await download(msg.audio.file_id, msg.audio.file_name));
    if (msg.video_note) files.push(await download(msg.video_note.file_id, 'video-note.mp4'));
    if (msg.document) files.push(await download(msg.document.file_id, msg.document.file_name));
    if (msg.photo && msg.photo.length) files.push(await download(msg.photo[msg.photo.length - 1].file_id, 'photo.jpg'));
  } catch (e) {
    await send('⚠️ Could not download the file: ' + e.message);
    return;
  }
  let text = (msg.text || msg.caption || '').trim();

  if (text === '/stop') { if (host) host.stop(); return send('⏹ Stopped.'); }
  if (text === '/new' || text.startsWith('/new ')) {
    text = text.slice(4).trim();
    startNew = true;
    if (!text && !files.length) return send('🆕 Your next message starts a new conversation.');
  }
  if (!text && !files.length) return;

  // Which conversation: the one of the replied-to message, else a new one after /new, else the last.
  const replied = msg.reply_to_message && convByMessage.get(msg.reply_to_message.message_id);
  const conv = replied || (startNew ? 'new' : lastConv);
  startNew = false;

  const uris = files.map((f) => 'file://' + (process.platform === 'win32' ? '/' + f.replace(/\\/g, '/') : f));
  run({ id: crypto.randomUUID(), messageId: msg.message_id, text, uris, conv });
}

async function loop(gen) {
  let offset = 0;
  let backoff = 1000;
  while (gen === generation && config && config.token) {
    try {
      poll = new AbortController();
      const updates = await api('getUpdates', { offset, timeout: 50, allowed_updates: ['message'] }, poll.signal);
      backoff = 1000;
      for (const u of updates) {
        offset = u.update_id + 1;
        if (gen !== generation) break;
        if (u.message) await handle(u.message).catch(() => {});
      }
    } catch (e) {
      // 409: another VS Code window is already polling this bot.
      await new Promise((r) => setTimeout(r, e.code === 409 ? 30000 : backoff));
      backoff = Math.min(backoff * 2, 60000);
    }
  }
}

function start(hostApi) {
  host = hostApi;
  if (running || !loadConfig() || !config.token) return;
  running = true;
  loop(generation);
}

function stop() {
  running = false;
  generation++;
  if (poll) poll.abort();
}

// Called by the "Connect Telegram Bot" command.
async function setup(vscode, hostApi) {
  const token = await vscode.window.showInputBox({
    title: 'Antigravity: Connect Telegram Bot',
    prompt: 'Bot token from @BotFather',
    password: true,
    ignoreFocusOut: true,
  });
  if (!token) return;
  stop();
  saveConfig({ token: token.trim() });
  let me;
  try { me = await api('getMe'); } catch (e) {
    vscode.window.showErrorMessage('Telegram: invalid token (' + e.message + ')');
    return;
  }
  pairingCode = String(crypto.randomInt(100000, 1000000));
  start(hostApi);
  vscode.window.showInformationMessage(`Send this code to @${me.username} on Telegram: ${pairingCode}`, { modal: true });
}

// Plugin interface for vscode-antigravity-rtl.
module.exports = {
  activate: (ctx) => start(ctx.host),
  commands: [{ title: 'Connect Telegram Bot', run: (ctx) => setup(ctx.vscode, ctx.host) }],
};
