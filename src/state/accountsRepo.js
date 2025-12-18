// src/state/accountsRepo.js
const fs = require('fs');
const path = require('path');
const {
  ACCOUNTS_FILE,
  ACCOUNTS_DIR,
  ensureAccountsDir,
  ensureAccountDir,
} = require('./accountPaths');

const DEFAULT_DATA = { version: 1, accounts: [] };
let cache = null;

function normalizeName(name) {
  return String(name || '').trim();
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function readAccountsFile() {
  ensureAccountsDir();
  if (!fs.existsSync(ACCOUNTS_FILE)) {
    return { ...DEFAULT_DATA };
  }
  try {
    const raw = JSON.parse(fs.readFileSync(ACCOUNTS_FILE, 'utf8'));
    if (!raw || typeof raw !== 'object') return { ...DEFAULT_DATA };
    if (!Array.isArray(raw.accounts)) raw.accounts = [];
    return { ...DEFAULT_DATA, ...raw };
  } catch {
    return { ...DEFAULT_DATA };
  }
}

function writeAccountsFile(data) {
  ensureAccountsDir();
  fs.writeFileSync(ACCOUNTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

function loadAccounts() {
  if (!cache) {
    cache = readAccountsFile();
  }
  return cache;
}

function saveAccounts(data) {
  cache = data;
  writeAccountsFile(data);
}

function listAccounts() {
  return loadAccounts().accounts.slice();
}

function getAccountById(id) {
  const key = String(id || '').trim();
  if (!key) return null;
  return loadAccounts().accounts.find((acc) => acc.id === key) || null;
}

function getAccountByName(name) {
  const key = normalizeKey(name);
  if (!key) return null;
  return (
    loadAccounts().accounts.find(
      (acc) => normalizeKey(acc.name) === key
    ) || null
  );
}

function findAccountByYoutubeChannelId(channelId) {
  const key = normalizeKey(channelId);
  if (!key) return null;
  return (
    loadAccounts().accounts.find(
      (acc) => normalizeKey(acc.youtube?.channelId) === key
    ) || null
  );
}

function findAccountByDiscordGuildId(guildId) {
  const key = normalizeKey(guildId);
  if (!key) return null;
  return (
    loadAccounts().accounts.find(
      (acc) => normalizeKey(acc.discord?.guildId) === key
    ) || null
  );
}

function generateAccountId(name) {
  const base = normalizeKey(name).replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const suffix = Math.random().toString(36).slice(2, 8);
  const token = base ? `${base}-${suffix}` : `account-${suffix}`;
  return token;
}

function validateUniqueName(name, ignoreId = null) {
  const key = normalizeKey(name);
  if (!key) return null;
  const conflict = loadAccounts().accounts.find(
    (acc) => normalizeKey(acc.name) === key && acc.id !== ignoreId
  );
  if (conflict) {
    return `Account name "${name}" is already in use.`;
  }
  return null;
}

function validateUniqueChannelId(channelId, ignoreId = null) {
  const key = normalizeKey(channelId);
  if (!key) return null;
  const conflict = loadAccounts().accounts.find(
    (acc) => normalizeKey(acc.youtube?.channelId) === key && acc.id !== ignoreId
  );
  if (conflict) {
    return `YouTube channel ID is already linked to "${conflict.name}".`;
  }
  return null;
}

function validateUniqueGuildId(guildId, ignoreId = null) {
  const key = normalizeKey(guildId);
  if (!key) return null;
  const conflict = loadAccounts().accounts.find(
    (acc) => normalizeKey(acc.discord?.guildId) === key && acc.id !== ignoreId
  );
  if (conflict) {
    return `Discord guild ID is already linked to "${conflict.name}".`;
  }
  return null;
}

function createAccount({ name }) {
  const safeName = normalizeName(name);
  if (!safeName) {
    throw new Error('Account name is required.');
  }
  const nameConflict = validateUniqueName(safeName);
  if (nameConflict) {
    throw new Error(nameConflict);
  }

  const account = {
    id: generateAccountId(safeName),
    name: safeName,
    createdAt: new Date().toISOString(),
    youtube: { channelId: '' },
    discord: { guildId: '' },
  };

  const data = loadAccounts();
  data.accounts.push(account);
  saveAccounts(data);
  ensureAccountDir(account.id);

  return account;
}

function updateAccount(accountId, updates = {}) {
  const data = loadAccounts();
  const idx = data.accounts.findIndex((acc) => acc.id === accountId);
  if (idx === -1) {
    throw new Error('Account not found.');
  }

  const current = data.accounts[idx];
  const next = { ...current };

  if (updates.name !== undefined) {
    const safeName = normalizeName(updates.name);
    if (!safeName) throw new Error('Account name is required.');
    const nameConflict = validateUniqueName(safeName, accountId);
    if (nameConflict) throw new Error(nameConflict);
    next.name = safeName;
  }

  if (updates.youtube?.channelId !== undefined) {
    const channelId = String(updates.youtube.channelId || '').trim();
    const channelConflict = validateUniqueChannelId(channelId, accountId);
    if (channelConflict) throw new Error(channelConflict);
    next.youtube = { ...(next.youtube || {}), channelId };
  }

  if (updates.discord?.guildId !== undefined) {
    const guildId = String(updates.discord.guildId || '').trim();
    const guildConflict = validateUniqueGuildId(guildId, accountId);
    if (guildConflict) throw new Error(guildConflict);
    next.discord = { ...(next.discord || {}), guildId };
  }

  data.accounts[idx] = next;
  saveAccounts(data);
  ensureAccountDir(next.id);
  return next;
}

function deleteAccount(accountId) {
  const data = loadAccounts();
  const idx = data.accounts.findIndex((acc) => acc.id === accountId);
  if (idx === -1) {
    throw new Error('Account not found.');
  }
  const [removed] = data.accounts.splice(idx, 1);
  saveAccounts(data);

  const accountDir = path.join(ACCOUNTS_DIR, accountId);
  try {
    if (fs.existsSync(accountDir)) {
      fs.rmSync(accountDir, { recursive: true, force: true });
    }
  } catch {}

  return removed;
}

function resetAccountsCache() {
  cache = null;
}

module.exports = {
  loadAccounts,
  saveAccounts,
  listAccounts,
  getAccountById,
  getAccountByName,
  findAccountByYoutubeChannelId,
  findAccountByDiscordGuildId,
  createAccount,
  updateAccount,
  deleteAccount,
  resetAccountsCache,
  validateUniqueChannelId,
  validateUniqueGuildId,
  validateUniqueName,
};
