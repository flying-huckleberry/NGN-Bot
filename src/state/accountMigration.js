// src/state/accountMigration.js
const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('../config/env');
const {
  loadAccounts,
  saveAccounts,
  createAccount,
} = require('./accountsRepo');
const { saveAccountRuntime } = require('./accountRuntime');
const { saveAccountSettings } = require('./accountSettings');
const { saveAccountSecrets } = require('./accountSecrets');

const LEGACY_DEV_STATE = path.join(ROOT_DIR, 'dev_state.json');

function migrateDevStateToDefaultAccount() {
  if (!fs.existsSync(LEGACY_DEV_STATE)) return null;

  const data = loadAccounts();
  if (data.accounts.length > 0) {
    return null;
  }

  let legacy = null;
  try {
    legacy = JSON.parse(fs.readFileSync(LEGACY_DEV_STATE, 'utf8'));
  } catch {
    legacy = null;
  }

  const account = createAccount({ name: 'Default' });

  if (legacy && typeof legacy === 'object') {
    saveAccountRuntime(account.id, {
      liveChatId: legacy.liveChatId || null,
      nextPageToken: legacy.nextPageToken || null,
      primed: Boolean(legacy.primed),
      youtubeChannelId: legacy.youtubeChannelId || null,
    });

    if (Array.isArray(legacy.disabledModules)) {
      saveAccountSettings(account.id, {
        disabledModules: legacy.disabledModules,
      });
    } else {
      saveAccountSettings(account.id, {});
    }
  } else {
    saveAccountSettings(account.id, {});
  }
  saveAccountSecrets(account.id, {});

  try {
    fs.unlinkSync(LEGACY_DEV_STATE);
  } catch {}

  saveAccounts(loadAccounts());
  return account;
}

module.exports = {
  migrateDevStateToDefaultAccount,
};
