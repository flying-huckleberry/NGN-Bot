// src/state/customCommands.js
const fs = require('fs');
const {
  ensureAccountDir,
  getAccountFilePath,
} = require('./accountPaths');
const { MAX_CHARS, CUSTOM_COMMANDS_MAX, DISCORD_MAX_CHARS } = require('../config/env');

const COMMANDS_FILE = 'commands.json';
const cache = new Map();

function parseId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n <= 0) return null;
  return n;
}

function normalizeName(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  return trimmed.startsWith('!') ? trimmed.slice(1) : trimmed;
}

function normalizePlatform(raw) {
  const value = String(raw || '').trim().toLowerCase();
  if (value === 'youtube' || value === 'discord') return value;
  return 'both';
}

function buildCommand(input) {
  const name = normalizeName(input?.name);
  if (!name) throw new Error('Command name is required.');
  if (name.length > MAX_CHARS) {
    throw new Error(`Command name exceeds ${MAX_CHARS} characters.`);
  }
  const response = String(input?.response || '').trim();
  if (!response) throw new Error('Command response is required.');
  const platform = normalizePlatform(input?.platform);
  if ((platform === 'both' || platform === 'youtube') && response.length > MAX_CHARS) {
    throw new Error(`YouTube commands are limited to ${MAX_CHARS} characters.`);
  }
  if ((platform === 'both' || platform === 'discord') && response.length > DISCORD_MAX_CHARS) {
    throw new Error(`Discord commands are limited to ${DISCORD_MAX_CHARS} characters.`);
  }
  return {
    name,
    response,
    platform,
    enabled: input?.enabled !== false,
    id: parseId(input?.id) || null,
    createdAt: input?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function readCommandsFile(accountId) {
  ensureAccountDir(accountId);
  const filePath = getAccountFilePath(accountId, COMMANDS_FILE);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function loadAccountCommands(accountId) {
  if (!accountId) throw new Error('Account ID is required.');
  if (cache.has(accountId)) return cache.get(accountId);
  const commands = readCommandsFile(accountId);
  cache.set(accountId, commands);
  return commands;
}

function saveAccountCommands(accountId, commands) {
  if (!accountId) throw new Error('Account ID is required.');
  const normalized = Array.isArray(commands) ? commands : [];
  ensureAccountDir(accountId);
  const filePath = getAccountFilePath(accountId, COMMANDS_FILE);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');
  cache.set(accountId, normalized);
  return normalized;
}

function upsertCommand(accountId, payload) {
  const commands = loadAccountCommands(accountId).slice();
  const next = buildCommand(payload);
  const requestedId = parseId(payload?.id);
  const existingIdx = requestedId
    ? commands.findIndex((cmd) => parseId(cmd?.id) === requestedId)
    : -1;

  if (existingIdx >= 0) {
    const existing = commands[existingIdx];
    const collision = commands.find(
      (cmd, idx) =>
        idx !== existingIdx &&
        normalizeName(cmd.name).toLowerCase() === normalizeName(next.name).toLowerCase()
    );
    if (collision) {
      throw new Error(`Command "${next.name}" already exists.`);
    }
    commands[existingIdx] = {
      ...existing,
      ...next,
      id: existing.id,
      createdAt: existing.createdAt || next.createdAt,
    };
  } else {
    if (commands.length >= CUSTOM_COMMANDS_MAX) {
      throw new Error(`You can only create ${CUSTOM_COMMANDS_MAX} custom commands.`);
    }
    if (requestedId) {
      throw new Error('Command not found.');
    }
    const collision = commands.find(
      (cmd) => normalizeName(cmd.name).toLowerCase() === normalizeName(next.name).toLowerCase()
    );
    if (collision) {
      throw new Error(`Command "${next.name}" already exists.`);
    }
    const nextId = commands.reduce((max, cmd) => Math.max(max, parseId(cmd?.id) || 0), 0) + 1;
    commands.push({ ...next, id: nextId });
  }

  return saveAccountCommands(accountId, commands);
}

function deleteCommand(accountId, id) {
  const commands = loadAccountCommands(accountId).slice();
  const targetId = parseId(id);
  if (!targetId) {
    throw new Error('Command not found.');
  }
  const next = commands.filter((cmd) => parseId(cmd?.id) !== targetId);
  if (next.length === commands.length) {
    throw new Error('Command not found.');
  }
  return saveAccountCommands(accountId, next);
}

function toggleCommand(accountId, id, enabled) {
  const commands = loadAccountCommands(accountId).slice();
  const targetId = parseId(id);
  const idx = commands.findIndex((cmd) => parseId(cmd?.id) === targetId);
  if (idx === -1) {
    throw new Error('Command not found.');
  }
  commands[idx] = {
    ...commands[idx],
    enabled: Boolean(enabled),
    updatedAt: new Date().toISOString(),
  };
  return saveAccountCommands(accountId, commands);
}

function resetCommandsCache(accountId) {
  if (accountId) cache.delete(accountId);
  else cache.clear();
}

module.exports = {
  loadAccountCommands,
  saveAccountCommands,
  upsertCommand,
  deleteCommand,
  toggleCommand,
  resetCommandsCache,
};
