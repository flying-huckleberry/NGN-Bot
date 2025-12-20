const {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  getAccountById,
} = require('../../state/accountsRepo');
const {
  loadAccountSettings,
  updateAccountSettings,
  saveAccountSettings,
  resetSettingsCache,
} = require('../../state/accountSettings');
const {
  loadAccountRuntime,
  resetRuntimeCache,
} = require('../../state/accountRuntime');
const { saveAccountSecrets } = require('../../state/accountSecrets');
const { deleteScope } = require('../../state/scopedStore');
const { getQuotaInfo } = require('../../state/quota');
const { loadAccountCommands } = require('../../state/customCommands');
const {
  wantsJson,
  parseCsv,
  buildCpanelViewModel,
  respondAccounts,
  respondCpanel,
} = require('./helpers');

function createAccountsController({ app, moduleNames, getDiscordStatus }) {
  return {
    redirectRoot(req, res) {
      res.redirect('/accounts');
    },

    async listAccounts(req, res) {
      return respondAccounts(app, req, res, {
        title: 'Accounts',
        accounts: listAccounts(),
        message: req.query?.message || null,
        error: req.query?.error || null,
      });
    },

    async createAccount(req, res) {
      const name = String(req.body?.name || '').trim();
      try {
        const account = createAccount({ name });
        saveAccountSettings(account.id, {});
        saveAccountSecrets(account.id, {});
        return res.redirect(`/accounts/${account.id}/cpanel`);
      } catch (err) {
        return respondAccounts(app, req, res, {
          title: 'Accounts',
          accounts: listAccounts(),
          error: err.message || String(err),
        });
      }
    },

    // Update registry + settings; redirect if the ID changes from rename.
    async updateAccount(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const settings = loadAccountSettings(account.id);

      const name = String(req.body?.name || '').trim();
      const youtubeChannelId = String(req.body?.youtubeChannelId || '').trim();
      const discordGuildId = String(req.body?.discordGuildId || '').trim();
      const allowedChannelIds = parseCsv(req.body?.discordAllowedChannelIds || '');
      const rawPrefix = String(req.body?.commandPrefix || '').trim();
      const commandPrefix = rawPrefix ? rawPrefix[0] : '!';

      try {
        const { account: updated, previousId } = updateAccount(account.id, {
          name,
          youtube: { channelId: youtubeChannelId },
          discord: { guildId: discordGuildId },
        });

        updateAccountSettings(updated.id, {
          commandPrefix,
          youtube: {
            enabled: settings.youtube?.enabled ?? true,
          },
          discord: {
            enabled: settings.discord?.enabled ?? true,
            allowedChannelIds,
          },
        });

        if (previousId && previousId !== updated.id) {
          resetSettingsCache(previousId);
          resetRuntimeCache(previousId);
        }

        if (previousId && previousId !== updated.id && wantsJson(req)) {
          return res.json({ redirect: `/accounts/${updated.id}/cpanel` });
        }
        if (previousId && previousId !== updated.id) {
          return res.redirect(`/accounts/${updated.id}/cpanel`);
        }

        const runtime = loadAccountRuntime(updated.id);
        const refreshedSettings = loadAccountSettings(updated.id);
        const quota = getQuotaInfo();
        const customCommands = loadAccountCommands(updated.id);
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account: updated,
          settings: refreshedSettings,
          runtime,
          modules: moduleNames,
          customCommands,
          quota,
          message: 'Account updated.',
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      } catch (err) {
        const runtime = loadAccountRuntime(account.id);
        const refreshedSettings = loadAccountSettings(account.id);
        const quota = getQuotaInfo();
        const customCommands = loadAccountCommands(account.id);
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings: refreshedSettings,
          runtime,
          modules: moduleNames,
          customCommands,
          quota,
          error: err.message || String(err),
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }
    },

    // Delete account registry entry and all scoped state.
    async deleteAccount(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }

      try {
        const removed = deleteAccount(account.id);
        if (removed.youtube?.channelId) {
          deleteScope(`youtube:${removed.youtube.channelId}`);
        }
        if (removed.discord?.guildId) {
          deleteScope(`discord:${removed.discord.guildId}`);
        }
        return res.redirect('/accounts?message=Account%20deleted');
      } catch (err) {
        return res.redirect(`/accounts?error=${encodeURIComponent(err.message || String(err))}`);
      }
    },
  };
}

module.exports = { createAccountsController };
