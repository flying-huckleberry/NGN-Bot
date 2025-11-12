// src/utils/parseCommand.js
// Parse "!command arg1 arg2 ..." into { name, args } or null.

function parseCommand(text, prefix) {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith(prefix)) return null;
  const [name, ...args] = trimmed.slice(prefix.length).split(/\s+/);
  return { name: name.toLowerCase(), args };
}

module.exports = { parseCommand };
