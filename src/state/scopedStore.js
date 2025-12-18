// src/state/scopedStore.js
// Generic JSON persistence scoped by logical context (e.g., youtube:UC123).

const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('../config/env');

const BASE_DIR = path.join(ROOT_DIR, 'state', 'scoped');
const cache = new Map();

function safeSegment(segment) {
  return String(segment || 'global').replace(/[^a-zA-Z0-9-_]/g, '_');
}

function getFilePath(scopeKey, fileName) {
  const key = safeSegment(scopeKey);
  const dir = path.join(BASE_DIR, key);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return path.join(dir, fileName);
}

function getCacheKey(scopeKey, fileName) {
  return `${scopeKey || 'global'}::${fileName}`;
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getScopedState(scopeKey, fileName, defaultFactory = () => ({})) {
  const cacheKey = getCacheKey(scopeKey, fileName);
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const filePath = getFilePath(scopeKey, fileName);
  let data;
  if (fs.existsSync(filePath)) {
    try {
      data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch {
      data = defaultFactory();
    }
  } else {
    data = defaultFactory();
  }

  cache.set(cacheKey, data);
  return data;
}

function saveScopedState(scopeKey, fileName) {
  const cacheKey = getCacheKey(scopeKey, fileName);
  if (!cache.has(cacheKey)) return;
  const filePath = getFilePath(scopeKey, fileName);
  fs.writeFileSync(filePath, JSON.stringify(cache.get(cacheKey), null, 2), 'utf8');
}

function setScopedState(scopeKey, fileName, data) {
  const cacheKey = getCacheKey(scopeKey, fileName);
  cache.set(cacheKey, clone(data));
  saveScopedState(scopeKey, fileName);
}

function resetScopedState(scopeKey, fileName, defaultFactory = () => ({})) {
  const cacheKey = getCacheKey(scopeKey, fileName);
  const fresh = defaultFactory();
  cache.set(cacheKey, fresh);
  saveScopedState(scopeKey, fileName);
  return fresh;
}

function deleteScope(scopeKey) {
  if (!scopeKey) return false;
  const key = safeSegment(scopeKey);
  const dir = path.join(BASE_DIR, key);
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    for (const cacheKey of cache.keys()) {
      if (cacheKey.startsWith(`${scopeKey}::`)) {
        cache.delete(cacheKey);
      }
    }
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  getScopedState,
  saveScopedState,
  setScopedState,
  resetScopedState,
  deleteScope,
};
