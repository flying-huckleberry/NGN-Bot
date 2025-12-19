// src/routes/accounts.js
const express = require('express');
const {
  listAccounts,
  createAccount,
  updateAccount,
  deleteAccount,
  getAccountById,
  validateUniqueChannelId,
} = require('../state/accountsRepo');
const {
  loadAccountSettings,
  updateAccountSettings,
  saveAccountSettings,
  resetSettingsCache,
} = require('../state/accountSettings');
const { saveAccountSecrets } = require('../state/accountSecrets');
const {
  loadAccountRuntime,
  saveAccountRuntime,
  resetAccountRuntime,
  resetRuntimeCache,
  accountRuntimeExists,
} = require('../state/accountRuntime');
const { deleteScope } = require('../state/scopedStore');
const { getQuotaInfo, addQuotaUsage } = require('../state/quota');
const { resolveTargetLiveChatId } = require('../services/liveChatTarget');
const { primeChat } = require('../services/youtube');

function wantsJson(req) {
  return req.headers.accept?.includes('application/json');
}

function parseCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((token) => token.trim())
    .filter(Boolean);
}

function parseNumber(value) {
  if (value === undefined || value === null || String(value).trim() === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildCpanelViewModel({
  account,
  settings,
  runtime,
  modules,
  quota,
  message,
  error,
  discordStatus,
  lastPoll,
  resolvedMethod,
  targetInfo,
  ...rest
}) {
  const safeAccount = account || {
    id: '',
    name: 'Unknown',
    youtube: {},
    discord: {},
  };
  const safeSettings = settings || {};
  const safeRuntime = runtime || {};
  const safeModules = Array.isArray(modules) ? modules : [];
  const safeDiscordStatus = discordStatus || { enabled: false, state: 'disabled' };
  const resolved = resolvedMethod ?? safeRuntime.resolvedMethod ?? null;
  const target = targetInfo ?? safeRuntime.targetInfo ?? {};
  return {
    title: `Control Panel - ${safeAccount.name}`,
    account: safeAccount,
    settings: safeSettings,
    runtime: safeRuntime,
    modules: safeModules,
    quota,
    message,
    error,
    discordStatus: safeDiscordStatus,
    lastPoll,
    resolvedMethod: resolved,
    targetInfo: target,
    stateFile: safeAccount.id && accountRuntimeExists(safeAccount.id) ? 'present' : 'missing',
    ...rest,
  };
}

function renderEjs(app, view, data) {
  return new Promise((resolve, reject) => {
    app.render(view, data, (err, html) => {
      if (err) reject(err);
      else resolve(html);
    });
  });
}

async function respondCpanel(app, req, res, data) {
  if (wantsJson(req)) {
    const html = await renderEjs(app, 'cpanel/content', data);
    return res.json({ html });
  }
  return res.render('cpanel/index', data);
}

async function respondAccounts(app, req, res, data) {
  if (wantsJson(req)) {
    const html = await renderEjs(app, 'accounts/index', data);
    return res.json({ html });
  }
  return res.render('accounts/index', data);
}

async function respondModuleEdit(app, req, res, data) {
  if (wantsJson(req)) {
    const html = await renderEjs(app, 'modules/content', data);
    return res.json({ html });
  }
  return res.render('modules/index', data);
}

function registerAccountRoutes(app, { pollOnce, getDiscordStatus, modules = {} }) {
  app.use(express.urlencoded({ extended: true }));

  const moduleNames = Object.keys(modules || {}).sort();

  // Account picker landing
  app.get('/', (req, res) => {
    res.redirect('/accounts');
  });

  // List + create accounts
  app.get('/accounts', async (req, res) => {
    return respondAccounts(app, req, res, {
      title: 'Accounts',
      accounts: listAccounts(),
      message: req.query?.message || null,
      error: req.query?.error || null,
    });
  });

  app.post('/accounts', async (req, res) => {
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
  });

  app.get('/accounts/:id/cpanel', async (req, res) => {
    const account = getAccountById(req.params.id);
    if (!account) {
      return res.status(404).send('Account not found.');
    }
    // Load current account runtime/settings for display
    const runtime = loadAccountRuntime(account.id);
    const settings = loadAccountSettings(account.id);
    const quota = getQuotaInfo();
    const data = buildCpanelViewModel({
      account,
      settings,
      runtime,
      modules: moduleNames,
      quota,
      discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
    });
    return respondCpanel(app, req, res, data);
  });

  app.post('/accounts/:id', async (req, res) => {
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
      // Account registry holds unique IDs (name/youtube/discord) for validation.
      const { account: updated, previousId } = updateAccount(account.id, {
        name,
        youtube: { channelId: youtubeChannelId },
        discord: { guildId: discordGuildId },
      });

      // Settings are account-scoped and editable in the control panel.
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
      return respondCpanel(app, req, res, buildCpanelViewModel({
        account: updated,
        settings: refreshedSettings,
        runtime,
        modules: moduleNames,
        quota,
        message: 'Account updated.',
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    } catch (err) {
      const runtime = loadAccountRuntime(account.id);
      const settings = loadAccountSettings(account.id);
      const quota = getQuotaInfo();
      return respondCpanel(app, req, res, buildCpanelViewModel({
        account,
        settings,
        runtime,
        modules: moduleNames,
        quota,
        error: err.message || String(err),
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    }
  });

  app.post('/accounts/:id/delete', async (req, res) => {
    const account = getAccountById(req.params.id);
    if (!account) {
      return res.status(404).send('Account not found.');
    }

    try {
      // Remove account registry + all scoped state on delete.
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
  });

  // Module config pages (account-scoped settings)
  app.get('/accounts/:id/modules/:module', async (req, res) => {
    const account = getAccountById(req.params.id);
    if (!account) {
      return res.status(404).send('Account not found.');
    }
    const moduleSlug = String(req.params.module || '').toLowerCase();
    const moduleName =
      moduleNames.find((name) => name.toLowerCase() === moduleSlug) || null;
    if (!moduleName) {
      return res.status(404).send('Module not found.');
    }
    const settings = loadAccountSettings(account.id);
    return respondModuleEdit(app, req, res, {
      title: `Edit ${moduleName} - ${account.name}`,
      active: 'accounts',
      account,
      moduleName,
      settings,
      message: null,
      error: null,
    });
  });

  app.post('/accounts/:id/modules/:module', async (req, res) => {
    const account = getAccountById(req.params.id);
    if (!account) {
      return res.status(404).send('Account not found.');
    }
    const moduleSlug = String(req.params.module || '').toLowerCase();
    const moduleName =
      moduleNames.find((name) => name.toLowerCase() === moduleSlug) || null;
    if (!moduleName) {
      return res.status(404).send('Module not found.');
    }
    const moduleKey = moduleName.toLowerCase();

    try {
      if (moduleKey === 'racing') {
        const racingChannelId = String(req.body?.discordRacingChannelId || '').trim();
        const raceCooldownMs = parseNumber(req.body?.raceCooldownMs);
        const raceJoinWindowMs = parseNumber(req.body?.raceJoinWindowMs);
        updateAccountSettings(account.id, {
          discord: { racingChannelId },
          race: {
            cooldownMs: raceCooldownMs,
            joinWindowMs: raceJoinWindowMs,
          },
        });
      } else if (moduleKey === 'crypto') {
        const cryptoAllowedCoins = parseCsv(req.body?.cryptoAllowedCoins || '');
        const cryptoStartingCash = parseNumber(req.body?.cryptoStartingCash);
        const cryptoTtlMs = parseNumber(req.body?.cryptoTtlMs);
        updateAccountSettings(account.id, {
          crypto: {
            allowedCoins: cryptoAllowedCoins,
            startingCash: cryptoStartingCash,
            coingeckoTtlMs: cryptoTtlMs,
          },
        });
      } else {
        throw new Error('This module does not have editable settings yet.');
      }

      const settings = loadAccountSettings(account.id);
      return respondModuleEdit(app, req, res, {
        title: `Edit ${moduleName} - ${account.name}`,
        active: 'accounts',
        account,
        moduleName,
        settings,
        message: `${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)} settings saved.`,
        error: null,
      });
    } catch (err) {
      const settings = loadAccountSettings(account.id);
      return res.status(400).render('modules/index', {
        title: `Edit ${moduleName} - ${account.name}`,
        active: 'accounts',
        account,
        moduleName,
        settings,
        message: null,
        error: err.message || String(err),
      });
    }
  });

  app.post('/accounts/:id/cpanel/modules', async (req, res) => {
    const account = getAccountById(req.params.id);
    if (!account) {
      return res.status(404).send('Account not found.');
    }
    const rawName = String(req.body?.module || '').trim();
    const enabled = String(req.body?.enabled || '').toLowerCase() === 'true';
    const targetName =
      moduleNames.find((n) => n.toLowerCase() === rawName.toLowerCase()) || null;

    const settings = loadAccountSettings(account.id);
    const disabled = new Set(
      (settings.disabledModules || []).map((name) => String(name || '').toLowerCase())
    );

    if (!targetName) {
      const runtime = loadAccountRuntime(account.id);
      const quota = getQuotaInfo();
      return respondCpanel(app, req, res, buildCpanelViewModel({
        account,
        settings,
        runtime,
        modules: moduleNames,
        quota,
        error: 'Unknown module.',
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    }

    const targetKey = targetName.toLowerCase();
    if (enabled) {
      disabled.delete(targetKey);
    } else {
      disabled.add(targetKey);
    }

    updateAccountSettings(account.id, {
      disabledModules: Array.from(disabled),
    });

    const runtime = loadAccountRuntime(account.id);
    const quota = getQuotaInfo();
    return respondCpanel(app, req, res, buildCpanelViewModel({
      account,
      settings: loadAccountSettings(account.id),
      runtime,
      modules: moduleNames,
      quota,
      message: `${targetName} ${enabled ? 'enabled' : 'disabled'}.`,
      discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
    }));
  });

  // Transport toggles: YouTube connects/disconnects, Discord gates routing per account.
  app.post('/accounts/:id/cpanel/transports', async (req, res) => {
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
        quota,
        error: 'Unknown transport.',
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    }

    if (!enabled) {
      // Disable YouTube transport and clear cached runtime for this account.
      runtime.liveChatId = null;
      runtime.nextPageToken = null;
      runtime.primed = false;
      runtime.youtubeChannelId = null;
      runtime.resolvedMethod = null;
      runtime.targetInfo = {};
      saveAccountRuntime(account.id, runtime);
      updateAccountSettings(account.id, { youtube: { enabled: false } });
      return respondCpanel(app, req, res, buildCpanelViewModel({
        account,
        settings: loadAccountSettings(account.id),
        runtime,
        modules: moduleNames,
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
        quota,
        error: 'Set a YouTube Channel ID in the account settings first.',
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    }

    const shouldReuseRuntime =
      Boolean(runtime.liveChatId) &&
      runtime.primed === true &&
      Boolean(runtime.youtubeChannelId) &&
      runtime.youtubeChannelId === account.youtube?.channelId;

    if (shouldReuseRuntime) {
      updateAccountSettings(account.id, { youtube: { enabled: true } });
      return respondCpanel(app, req, res, buildCpanelViewModel({
        account,
        settings: loadAccountSettings(account.id),
        runtime,
        modules: moduleNames,
        quota,
        message: 'YouTube transport enabled.',
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    }

    const titleMatch = String(req.body?.youtubeTitleMatch || '').trim();
    try {
      // Enable YouTube transport by resolving live chat via account channel ID.
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

      const updatedQuota = addQuotaUsage(estimatedUnits);
      return respondCpanel(app, req, res, buildCpanelViewModel({
        account,
        settings: loadAccountSettings(account.id),
        runtime,
        modules: moduleNames,
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
        quota,
        error: friendlyMessage,
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    }
  });

  // Manual connect override for a specific livestream URL (does not update account channel ID).
  app.post('/accounts/:id/cpanel/connect', async (req, res) => {
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

      const nextSettings = loadAccountSettings(account.id);
      const quota = addQuotaUsage(estimatedUnits);

      const payload = buildCpanelViewModel({
        account: getAccountById(account.id),
        settings: nextSettings,
        runtime,
        modules: moduleNames,
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
        quota,
        error: friendlyMessage,
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    }
  });

  app.post('/accounts/:id/cpanel/prime', async (req, res) => {
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
        quota,
        error: err.message || String(err),
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    }
  });

  app.post('/accounts/:id/cpanel/poll', async (req, res) => {
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
        quota,
        error: 'Not connected.',
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    }

    try {
      const result = await pollOnce(account.id, runtime.liveChatId);
      const refreshedRuntime = loadAccountRuntime(account.id);
      const refreshedSettings = loadAccountSettings(account.id);
      const quota = result?.ok ? addQuotaUsage(5) : getQuotaInfo();
      return respondCpanel(app, req, res, buildCpanelViewModel({
        account,
        settings: refreshedSettings,
        runtime: refreshedRuntime,
        modules: moduleNames,
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
        quota,
        error: err.message || String(err),
        discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
      }));
    }
  });

  app.post('/accounts/:id/cpanel/reset', async (req, res) => {
    const account = getAccountById(req.params.id);
    if (!account) {
      return res.status(404).send('Account not found.');
    }
    const runtime = resetAccountRuntime(account.id);
    const settings = loadAccountSettings(account.id);
    const quota = getQuotaInfo();
    return respondCpanel(app, req, res, buildCpanelViewModel({
      account,
      settings,
      runtime,
      modules: moduleNames,
      quota,
      message: 'Runtime state reset.',
      discordStatus: typeof getDiscordStatus === 'function' ? getDiscordStatus() : null,
    }));
  });
}

module.exports = { registerAccountRoutes };
