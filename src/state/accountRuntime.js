// src/state/accountRuntime.js
const fs = require('fs');
const {
  ensureAccountDir,
  getAccountFilePath,
} = require('./accountPaths');

const RUNTIME_FILE = 'runtime.json';
const cache = new Map();

function defaultRuntime() {
  // Per-account runtime state for active YouTube chat connections.
  return {
    liveChatId: null,
    nextPageToken: null,
    primed: false,
    youtubeChannelId: null,
    // Capture how we resolved the live chat (override vs account config) for UI display.
    resolvedMethod: null,
    targetInfo: {},
  };
}

function readRuntimeFile(accountId) {
  ensureAccountDir(accountId);
  const filePath = getAccountFilePath(accountId, RUNTIME_FILE);
  if (!fs.existsSync(filePath)) {
    return defaultRuntime();
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return { ...defaultRuntime(), ...raw };
  } catch {
    return defaultRuntime();
  }
}

function loadAccountRuntime(accountId) {
  if (!accountId) throw new Error('Account ID is required.');
  if (cache.has(accountId)) return cache.get(accountId);
  const runtime = readRuntimeFile(accountId);
  cache.set(accountId, runtime);
  return runtime;
}

function saveAccountRuntime(accountId, runtime) {
  if (!accountId) throw new Error('Account ID is required.');
  const next = { ...defaultRuntime(), ...(runtime || {}) };
  ensureAccountDir(accountId);
  const filePath = getAccountFilePath(accountId, RUNTIME_FILE);
  fs.writeFileSync(filePath, JSON.stringify(next, null, 2), 'utf8');
  cache.set(accountId, next);
  return next;
}

function resetAccountRuntime(accountId) {
  const fresh = defaultRuntime();
  saveAccountRuntime(accountId, fresh);
  return fresh;
}

function resetRuntimeCache(accountId) {
  if (accountId) {
    cache.delete(accountId);
  } else {
    cache.clear();
  }
}

function accountRuntimeExists(accountId) {
  if (!accountId) return false;
  const filePath = getAccountFilePath(accountId, RUNTIME_FILE);
  return fs.existsSync(filePath);
}

module.exports = {
  loadAccountRuntime,
  saveAccountRuntime,
  resetAccountRuntime,
  resetRuntimeCache,
  accountRuntimeExists,
};
