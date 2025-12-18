// src/state/accountSecrets.js
const fs = require('fs');
const {
  ensureAccountDir,
  getAccountFilePath,
} = require('./accountPaths');

const SECRETS_FILE = 'secrets.json';
const cache = new Map();

function defaultSecrets() {
  return {
    youtubeTokens: null,
    discordBotToken: null,
  };
}

function readSecretsFile(accountId) {
  ensureAccountDir(accountId);
  const filePath = getAccountFilePath(accountId, SECRETS_FILE);
  if (!fs.existsSync(filePath)) {
    return defaultSecrets();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ...defaultSecrets(), ...raw };
  } catch {
    return defaultSecrets();
  }
}

function loadAccountSecrets(accountId) {
  if (!accountId) throw new Error('Account ID is required.');
  if (cache.has(accountId)) return cache.get(accountId);
  const secrets = readSecretsFile(accountId);
  cache.set(accountId, secrets);
  return secrets;
}

function saveAccountSecrets(accountId, secrets) {
  if (!accountId) throw new Error('Account ID is required.');
  const next = { ...defaultSecrets(), ...(secrets || {}) };
  ensureAccountDir(accountId);
  const filePath = getAccountFilePath(accountId, SECRETS_FILE);
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf8');
  cache.set(accountId, next);
  return next;
}

function resetSecretsCache(accountId) {
  if (accountId) {
    cache.delete(accountId);
  } else {
    cache.clear();
  }
}

module.exports = {
  loadAccountSecrets,
  saveAccountSecrets,
  resetSecretsCache,
};
