// src/state/customCommands.js
const fs = require('fs');
const {
  ensureAccountDir,
  getAccountFilePath,
} = require('./accountPaths');
const { MAX_CHARS } = require('../config/env');

const COMMANDS_FILE = 'commands.json';
const cache = new Map();

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
  if (response.length > MAX_CHARS) {
    throw new Error(`Command response exceeds ${MAX_CHARS} characters.`);
  }
  return {
    name,
    response,
    platform: normalizePlatform(input?.platform),
    enabled: input?.enabled !== false,
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

function upsertCommand(accountId, payload, { originalName } = {}) {
  const commands = loadAccountCommands(accountId).slice();
  const next = buildCommand(payload);
  const targetKey = normalizeName(originalName || next.name).toLowerCase();

  const existingIdx = commands.findIndex(
    (cmd) => normalizeName(cmd.name).toLowerCase() === targetKey
  );

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
      createdAt: existing.createdAt || next.createdAt,
    };
  } else {
    const collision = commands.find(
      (cmd) => normalizeName(cmd.name).toLowerCase() === normalizeName(next.name).toLowerCase()
    );
    if (collision) {
      throw new Error(`Command "${next.name}" already exists.`);
    }
    commands.push(next);
  }

  return saveAccountCommands(accountId, commands);
}

function deleteCommand(accountId, name) {
  const commands = loadAccountCommands(accountId).slice();
  const key = normalizeName(name).toLowerCase();
  const next = commands.filter(
    (cmd) => normalizeName(cmd.name).toLowerCase() !== key
  );
  if (next.length === commands.length) {
    throw new Error('Command not found.');
  }
  return saveAccountCommands(accountId, next);
}

function toggleCommand(accountId, name, enabled) {
  const commands = loadAccountCommands(accountId).slice();
  const key = normalizeName(name).toLowerCase();
  const idx = commands.findIndex(
    (cmd) => normalizeName(cmd.name).toLowerCase() === key
  );
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
