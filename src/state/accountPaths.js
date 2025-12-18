// src/state/accountPaths.js
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('../config/env');

const ACCOUNTS_DIR = path.join(ROOT_DIR, 'state', 'accounts');
const ACCOUNTS_FILE = path.join(ROOT_DIR, 'state', 'accounts.json');

function ensureAccountsDir() {
  if (!fs.existsSync(ACCOUNTS_DIR)) {
    fs.mkdirSync(ACCOUNTS_DIR, { recursive: true });
  }
}

function ensureAccountDir(accountId) {
  ensureAccountsDir();
  const dir = path.join(ACCOUNTS_DIR, accountId);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getAccountDir(accountId) {
  return path.join(ACCOUNTS_DIR, accountId);
}

function getAccountFilePath(accountId, fileName) {
  return path.join(getAccountDir(accountId), fileName);
}

module.exports = {
  ACCOUNTS_DIR,
  ACCOUNTS_FILE,
  ensureAccountsDir,
  ensureAccountDir,
  getAccountDir,
  getAccountFilePath,
};
