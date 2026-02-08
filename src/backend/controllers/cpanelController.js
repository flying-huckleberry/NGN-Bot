const {
  getAccountById,
  validateUniqueChannelId,
} = require('../../state/accountsRepo');
const {
  loadAccountSettings,
  updateAccountSettings,
} = require('../../state/accountSettings');
const {
  loadAccountRuntime,
  saveAccountRuntime,
  resetAccountRuntime,
} = require('../../state/accountRuntime');
const { loadAccountCommands } = require('../../state/customCommands');
const { loadAccountAnnouncements } = require('../../state/autoAnnouncements');
const { loadAccountCountCommands } = require('../../state/countCommands');
const { getQuotaInfo } = require('../../state/quota');
const { resolveTargetLiveChatId } = require('../../services/liveChatTarget');
const { primeChat } = require('../../services/youtube');
const {
  buildCpanelViewModel,
  respondCpanel,
} = require('./helpers');

function createCpanelController({
  app,
  moduleNames,
  getDiscordStatus,
  pollOnce,
  startPolling,
  autoAnnouncements,
}) {
  return {
    async getCpanel(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const runtime = loadAccountRuntime(account.id);
      const settings = loadAccountSettings(account.id);
      const quota = getQuotaInfo();
      const customCommands = loadAccountCommands(account.id);
      const countCommands = loadAccountCountCommands(account.id);
      const autoAnnouncementsList = loadAccountAnnouncements(account.id);
      const data = buildCpanelViewModel({
        account,
        settings,
        runtime,
        modules: moduleNames,
        customCommands,
        countCommands,
        autoAnnouncements: autoAnnouncementsList,
        quota,
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      });
      return respondCpanel(app, req, res, data);
    },

    // Toggle module enablement without full page reload.
    async toggleModule(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const rawName = String(req.body?.module || '').trim();
      const platform = String(req.body?.platform || 'global').trim().toLowerCase();
      const enabled = String(req.body?.enabled || '').toLowerCase() === 'true';
      const targetName =
        moduleNames.find((n) => n.toLowerCase() === rawName.toLowerCase()) || null;

      const settings = loadAccountSettings(account.id);
      const disabled = new Set(
        (settings.disabledModules || []).map((name) => String(name || '').toLowerCase())
      );
      const disabledByPlatform = settings.disabledModulesByPlatform || {};
      const perDisabled = new Set(
        (disabledByPlatform[platform] || []).map((name) => String(name || '').toLowerCase())
      );

      if (!targetName) {
        const runtime = loadAccountRuntime(account.id);
        const quota = getQuotaInfo();
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          error: 'Unknown module.',
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }

      const targetKey = targetName.toLowerCase();
      if (platform === 'youtube' || platform === 'discord') {
        if (enabled) {
          perDisabled.delete(targetKey);
        } else {
          perDisabled.add(targetKey);
        }
        updateAccountSettings(account.id, {
          disabledModulesByPlatform: {
            ...disabledByPlatform,
            [platform]: Array.from(perDisabled),
          },
        });
      } else {
        if (enabled) {
          disabled.delete(targetKey);
        } else {
          disabled.add(targetKey);
        }
        updateAccountSettings(account.id, {
          disabledModules: Array.from(disabled),
        });
      }

      const runtime = loadAccountRuntime(account.id);
      const quota = getQuotaInfo();
      const platformLabel =
        platform === 'youtube' ? 'YouTube' :
        platform === 'discord' ? 'Discord' : 'Global';
      return respondCpanel(app, req, res, buildCpanelViewModel({
        account,
        settings: loadAccountSettings(account.id),
        runtime,
        modules: moduleNames,
        customCommands: loadAccountCommands(account.id),
        autoAnnouncements: loadAccountAnnouncements(account.id),
        quota,
        message: `${targetName} ${enabled ? 'enabled' : 'disabled'} (${platformLabel}).`,
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    },

    // YouTube connects/disconnects; Discord gates routing per account.
    async toggleTransport(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }

      const transport = String(req.body?.transport || '').trim().toLowerCase();
      const enabled = String(req.body?.enabled || '').toLowerCase() === 'true';
      const runtime = loadAccountRuntime(account.id);
      const settings = loadAccountSettings(account.id);
      const quota = getQuotaInfo();

      if (transport === 'discord') {
        updateAccountSettings(account.id, {
          discord: { enabled },
        });
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings: loadAccountSettings(account.id),
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          message: `Discord routing ${enabled ? 'enabled' : 'disabled'}.`,
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }

      if (transport !== 'youtube') {
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          error: 'Unknown transport.',
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }

      if (!enabled) {
        runtime.liveChatId = null;
        runtime.nextPageToken = null;
        runtime.primed = false;
        runtime.youtubeChannelId = null;
        runtime.resolvedMethod = null;
        runtime.targetInfo = {};
        saveAccountRuntime(account.id, runtime);
        updateAccountSettings(account.id, { youtube: { enabled: false } });
        if (autoAnnouncements?.stop) {
          autoAnnouncements.stop(account.id);
        }
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings: loadAccountSettings(account.id),
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          message: 'YouTube transport disabled.',
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }

      if (!account.youtube?.channelId) {
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          error: 'Set a YouTube Channel ID in the account settings first.',
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }

      const titleMatch = String(req.body?.youtubeTitleMatch || '').trim();
      try {
        const { liveChatId, method, targetInfo, estimatedUnits, channelId } =
          await resolveTargetLiveChatId(
            {},
            {
              channelId: account.youtube.channelId,
              titleMatch,
              livestreamUrl: '',
              videoId: '',
            }
          );

        const token = await primeChat(liveChatId);
        runtime.liveChatId = liveChatId;
        runtime.nextPageToken = token;
        runtime.primed = true;
        runtime.youtubeChannelId = channelId || account.youtube.channelId || null;
        runtime.resolvedMethod = method || null;
        runtime.targetInfo = targetInfo || {};
        saveAccountRuntime(account.id, runtime);
        updateAccountSettings(account.id, { youtube: { enabled: true } });
        if (autoAnnouncements?.refresh) {
          autoAnnouncements.refresh(account.id);
        }
        if (typeof startPolling === 'function') {
          startPolling(account.id, liveChatId);
        }

        const updatedQuota = getQuotaInfo();
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings: loadAccountSettings(account.id),
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota: updatedQuota,
          message: `YouTube transport enabled. ~${estimatedUnits} units.`,
          resolvedMethod: method,
          targetInfo,
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      } catch (err) {
        const rawMessage = err?.message || String(err);
        const friendlyMessage = /already linked/i.test(rawMessage)
          ? rawMessage
          : titleMatch
            ? 'Unable to connect to YouTube livestream with the provided title match. Please confirm the livestream title and that the channel is currently streaming.'
          : 'Unable to connect to YouTube livestream. Please make sure the channel ID is correct and the channel is currently livestreaming.';
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          error: friendlyMessage,
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }
    },

    // Manual connect override for a specific livestream URL.
    async connectOverride(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const runtime = loadAccountRuntime(account.id);
      const settings = loadAccountSettings(account.id);
      const targetLivestreamUrl = (req.body?.targetLivestreamUrl || '').trim();
      if (!targetLivestreamUrl && !account.youtube?.channelId) {
        const quota = getQuotaInfo();
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          error: 'Set a YouTube Channel ID in the account settings first.',
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }

      try {
        const { liveChatId, method, targetInfo, estimatedUnits, channelId } =
          await resolveTargetLiveChatId(
            {
              livestreamUrl: targetLivestreamUrl,
            },
            {
              channelId: account.youtube?.channelId || '',
              livestreamUrl: '',
              videoId: '',
            }
          );

        if (channelId) {
          const conflict = validateUniqueChannelId(channelId, account.id);
          if (conflict) {
            throw new Error(conflict);
          }
        }

        const token = await primeChat(liveChatId);
        runtime.liveChatId = liveChatId;
        runtime.nextPageToken = token;
        runtime.primed = true;
        runtime.youtubeChannelId = channelId || account.youtube?.channelId || null;
        runtime.resolvedMethod = method || null;
        runtime.targetInfo = targetInfo || {};
        saveAccountRuntime(account.id, runtime);

        if (settings.youtube?.enabled !== true) {
          updateAccountSettings(account.id, {
            youtube: { enabled: true },
          });
        }
        if (autoAnnouncements?.refresh) {
          autoAnnouncements.refresh(account.id);
        }
        if (typeof startPolling === 'function') {
          startPolling(account.id, liveChatId);
        }

        const nextSettings = loadAccountSettings(account.id);
        const quota = getQuotaInfo();

        const payload = buildCpanelViewModel({
          account: getAccountById(account.id),
          settings: nextSettings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          message: `Connected and primed successfully. ~${estimatedUnits} units.`,
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        });
        payload.liveChatId = liveChatId;
        payload.primed = true;
        payload.resolvedMethod = method;
        payload.targetInfo = targetInfo;
        return respondCpanel(app, req, res, payload);
      } catch (err) {
        const quota = getQuotaInfo();
        const rawMessage = err?.message || String(err);
        const friendlyMessage = /already linked/i.test(rawMessage)
          ? rawMessage
          : 'Unable to connect to YouTube livestream. Please make sure the channel ID is correct and the channel is currently livestreaming.';
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          error: friendlyMessage,
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }
    },

    async primeChat(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const runtime = loadAccountRuntime(account.id);
      const settings = loadAccountSettings(account.id);

      if (!runtime.liveChatId) {
        const quota = getQuotaInfo();
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          error: 'Not connected.',
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }

      try {
        const token = await primeChat(runtime.liveChatId);
        runtime.primed = true;
        runtime.nextPageToken = token;
        saveAccountRuntime(account.id, runtime);

        const quota = getQuotaInfo();
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          message: 'Re-primed: starting fresh from current point in chat.',
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      } catch (err) {
        const quota = getQuotaInfo();
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          error: err.message || String(err),
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }
    },

    // Manual single poll to conserve quota in dev mode.
    async pollOnce(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const runtime = loadAccountRuntime(account.id);
      const settings = loadAccountSettings(account.id);

      if (!runtime.liveChatId) {
        const quota = getQuotaInfo();
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          error: 'Not connected.',
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }

      try {
        const result = await pollOnce(account.id, runtime.liveChatId);
        const refreshedRuntime = loadAccountRuntime(account.id);
        const refreshedSettings = loadAccountSettings(account.id);
        const quota = getQuotaInfo();
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings: refreshedSettings,
          runtime: refreshedRuntime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          lastPoll: result?.ok
            ? {
              received: result.received,
              handled: result.handled,
            }
            : null,
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      } catch (err) {
        const quota = getQuotaInfo();
        return respondCpanel(app, req, res, buildCpanelViewModel({
          account,
          settings,
          runtime,
          modules: moduleNames,
          customCommands: loadAccountCommands(account.id),
          autoAnnouncements: loadAccountAnnouncements(account.id),
          quota,
          error: err.message || String(err),
          discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
        }));
      }
    },

    async resetRuntime(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const runtime = resetAccountRuntime(account.id);
      const settings = loadAccountSettings(account.id);
      const quota = getQuotaInfo();
      if (autoAnnouncements?.stop) {
        autoAnnouncements.stop(account.id);
      }
      return respondCpanel(app, req, res, buildCpanelViewModel({
        account,
        settings,
        runtime,
        modules: moduleNames,
        customCommands: loadAccountCommands(account.id),
        autoAnnouncements: loadAccountAnnouncements(account.id),
        quota,
        message: 'Runtime state reset.',
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    },
  };
}

module.exports = { createCpanelController };
