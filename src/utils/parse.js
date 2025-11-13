// src/utils/parse.js
function parseText(text, prefix) {
  const trimmed = (text || '').trim();
  if (!trimmed.startsWith(prefix)) return null;

  const body = trimmed.slice(prefix.length).trim();

  // dotted: !mod.cmd args...
  const dotted = body.match(/^([a-z0-9_-]+)\.([a-z0-9_-]+)\s*(.*)$/i);
  if (dotted) {
    const [, modName, cmdName, rest] = dotted;
    const args = rest ? rest.trim().split(/\s+/) : [];
    return { modName: modName.toLowerCase(), cmdName: cmdName.toLowerCase(), args };
  }

  // space separated: !mod cmd args... or flat: !cmd args...
  const [first, ...rest] = body.split(/\s+/);
  return { modName: first.toLowerCase(), cmdName: null, args: rest };
}

module.exports = { parseText };
