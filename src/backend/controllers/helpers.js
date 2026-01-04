const { accountRuntimeExists } = require('../../state/accountRuntime');
const { loadAccountCommands } = require('../../state/customCommands');
const { loadAccountCountCommands } = require('../../state/countCommands');

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
  customCommands,
  countCommands,
  autoAnnouncements,
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
  const safeCommands = Array.isArray(customCommands)
    ? customCommands
    : (safeAccount.id ? loadAccountCommands(safeAccount.id) : []);
  const safeCountCommands = Array.isArray(countCommands)
    ? countCommands
    : (safeAccount.id ? loadAccountCountCommands(safeAccount.id) : []);
  const safeAutoAnnouncements = Array.isArray(autoAnnouncements)
    ? autoAnnouncements
    : [];
  const safeDiscordStatus = discordStatus || { enabled: false, state: 'disabled' };
  const resolved = resolvedMethod ?? safeRuntime.resolvedMethod ?? null;
  const target = targetInfo ?? safeRuntime.targetInfo ?? {};
  return {
    title: `Control Panel - ${safeAccount.name}`,
    account: safeAccount,
    settings: safeSettings,
    runtime: safeRuntime,
    modules: safeModules,
    customCommands: safeCommands,
    countCommands: safeCountCommands,
    autoAnnouncements: safeAutoAnnouncements,
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

// Render a full page or return partial HTML for AJAX replacements.
async function respondCpanel(app, req, res, data) {
  if (wantsJson(req)) {
    const html = await renderEjs(app, 'cpanel/content', data);
    return res.json({ html });
  }
  return res.render('cpanel/index', data);
}

// Accounts list supports both full-page and JSON HTML payloads.
async function respondAccounts(app, req, res, data) {
  if (wantsJson(req)) {
    const html = await renderEjs(app, 'accounts/index', data);
    return res.json({ html });
  }
  return res.render('accounts/index', data);
}

// Module editor is rendered as full page or partial.
async function respondModuleEdit(app, req, res, data) {
  if (wantsJson(req)) {
    const html = await renderEjs(app, 'modules/content', data);
    return res.json({ html });
  }
  return res.render('modules/index', data);
}

// Custom commands view: used for CRUD responses.
async function respondCommands(app, req, res, data) {
  if (wantsJson(req)) {
    const html = await renderEjs(app, 'commands/content', data);
    return res.json({ html });
  }
  return res.render('commands/index', data);
}

// Auto announcements view: used for CRUD responses.
async function respondAutoAnnouncements(app, req, res, data) {
  if (wantsJson(req)) {
    const html = await renderEjs(app, 'auto-announcements/content', data);
    return res.json({ html });
  }
  return res.render('auto-announcements/index', data);
}

// Count commands view: used for CRUD responses.
async function respondCountCommands(app, req, res, data) {
  if (wantsJson(req)) {
    const html = await renderEjs(app, 'counts/content', data);
    return res.json({ html });
  }
  return res.render('counts/index', data);
}

module.exports = {
  wantsJson,
  parseCsv,
  parseNumber,
  buildCpanelViewModel,
  respondCpanel,
  respondAccounts,
  respondModuleEdit,
  respondCommands,
  respondAutoAnnouncements,
  respondCountCommands,
};
