const { getAccountById } = require('../../state/accountsRepo');
const {
  loadAccountCommands,
  upsertCommand,
  deleteCommand,
  toggleCommand,
} = require('../../state/customCommands');
const { respondCommands } = require('./helpers');
const { moderateText, DISALLOWED_MESSAGE, SELF_HARM_MESSAGE } = require('../../services/openai');
const { CUSTOM_COMMANDS_MAX } = require('../../config/env');

function normalizeCommandKey(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const withoutPrefix = trimmed.startsWith('!') ? trimmed.slice(1) : trimmed;
  return withoutPrefix.toLowerCase();
}

function createCommandsController({ app, reservedCommands }) {
  const reserved = reservedCommands instanceof Set ? reservedCommands : null;
  return {
    async listCommands(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const commands = loadAccountCommands(account.id);
      return respondCommands(app, req, res, {
        title: `Custom Commands - ${account.name}`,
        active: 'accounts',
        account,
        commands,
        maxEntries: CUSTOM_COMMANDS_MAX,
        message: req.query?.message || null,
        error: req.query?.error || null,
      });
    },

    // Create or update a command by name (case-insensitive).
    async saveCommand(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }

      const name = String(req.body?.name || '');
      const response = String(req.body?.response || '');
      const platform = String(req.body?.platform || 'both');
      const enabled = String(req.body?.enabled || '').toLowerCase() === 'on' ||
        String(req.body?.enabled || '').toLowerCase() === 'true';
      const id = String(req.body?.id || '').trim();

      try {
        const key = normalizeCommandKey(name);
        if (reserved && key && reserved.has(key)) {
          throw new Error(`"${name}" is reserved by a built-in command.`);
        }
        const moderation = await moderateText(response);
        if (moderation === 'self_harm') {
          throw new Error(SELF_HARM_MESSAGE);
        }
        if (moderation === 'block') {
          throw new Error(DISALLOWED_MESSAGE);
        }
        upsertCommand(account.id, { id, name, response, platform, enabled });
        const commands = loadAccountCommands(account.id);
        return respondCommands(app, req, res, {
          title: `Custom Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: CUSTOM_COMMANDS_MAX,
          message: 'Custom command saved.',
          error: null,
        });
      } catch (err) {
        const commands = loadAccountCommands(account.id);
        return respondCommands(app, req, res, {
          title: `Custom Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: CUSTOM_COMMANDS_MAX,
          message: null,
          error: err.message || String(err),
        });
      }
    },

    async deleteCommand(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const id = String(req.body?.id || '').trim();
      try {
        deleteCommand(account.id, id);
        const commands = loadAccountCommands(account.id);
        return respondCommands(app, req, res, {
          title: `Custom Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: CUSTOM_COMMANDS_MAX,
          message: 'Custom command deleted.',
          error: null,
        });
      } catch (err) {
        const commands = loadAccountCommands(account.id);
        return respondCommands(app, req, res, {
          title: `Custom Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: CUSTOM_COMMANDS_MAX,
          message: null,
          error: err.message || String(err),
        });
      }
    },

    // Toggle enabled flag for quick on/off without editing.
    async toggleCommand(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const id = String(req.body?.id || '').trim();
      const enabled = String(req.body?.enabled || '').toLowerCase() === 'true';
      try {
        toggleCommand(account.id, id, enabled);
        const commands = loadAccountCommands(account.id);
        return respondCommands(app, req, res, {
          title: `Custom Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: CUSTOM_COMMANDS_MAX,
          message: 'Custom command updated.',
          error: null,
        });
      } catch (err) {
        const commands = loadAccountCommands(account.id);
        return respondCommands(app, req, res, {
          title: `Custom Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: CUSTOM_COMMANDS_MAX,
          message: null,
          error: err.message || String(err),
        });
      }
    },
  };
}

module.exports = { createCommandsController };
