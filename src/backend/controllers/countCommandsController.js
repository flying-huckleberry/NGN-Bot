const { getAccountById } = require('../../state/accountsRepo');
const {
  loadAccountCountCommands,
  upsertCountCommand,
  deleteCountCommand,
  toggleCountCommand,
  resetCount,
} = require('../../state/countCommands');
const { loadAccountCommands } = require('../../state/customCommands');
const { respondCountCommands } = require('./helpers');
const { moderateText, DISALLOWED_MESSAGE, SELF_HARM_MESSAGE } = require('../../services/openai');
const { COUNT_COMMANDS_MAX } = require('../../config/env');

function normalizeCommandKey(raw) {
  const trimmed = String(raw || '').trim();
  if (!trimmed) return '';
  const withoutPrefix = trimmed.startsWith('!') ? trimmed.slice(1) : trimmed;
  return withoutPrefix.toLowerCase();
}

function createCountCommandsController({ app, reservedCommands }) {
  const reserved = reservedCommands instanceof Set ? reservedCommands : null;
  return {
    async listCountCommands(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const commands = loadAccountCountCommands(account.id);
      return respondCountCommands(app, req, res, {
        title: `Count Commands - ${account.name}`,
        active: 'accounts',
        account,
        commands,
        maxEntries: COUNT_COMMANDS_MAX,
        message: req.query?.message || null,
        error: req.query?.error || null,
      });
    },

    async saveCountCommand(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }

      const name = String(req.body?.name || '');
      const response = String(req.body?.response || '');
      const enabled = String(req.body?.enabled || '').toLowerCase() === 'on' ||
        String(req.body?.enabled || '').toLowerCase() === 'true';
      const id = String(req.body?.id || '').trim();

      try {
        // Normalize input so collisions are case-insensitive and prefix-agnostic.
        const key = normalizeCommandKey(name);
        if (reserved && key && reserved.has(key)) {
          throw new Error(`"${name}" is reserved by a built-in command.`);
        }
        const customCommands = loadAccountCommands(account.id);
        // Count commands may not reuse existing custom command names.
        const customCollision = customCommands.find(
          (cmd) => normalizeCommandKey(cmd?.name) === key
        );
        if (customCollision) {
          throw new Error(`"${name}" is already used by a custom command.`);
        }
        // Moderate on save/edit; runtime uses the stored response as-is.
        const moderation = await moderateText(response);
        if (moderation === 'self_harm') {
          throw new Error(SELF_HARM_MESSAGE);
        }
        if (moderation === 'block') {
          throw new Error(DISALLOWED_MESSAGE);
        }
        upsertCountCommand(account.id, { id, name, response, enabled });
        const commands = loadAccountCountCommands(account.id);
        return respondCountCommands(app, req, res, {
          title: `Count Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: COUNT_COMMANDS_MAX,
          message: 'Count command saved.',
          error: null,
        });
      } catch (err) {
        const commands = loadAccountCountCommands(account.id);
        return respondCountCommands(app, req, res, {
          title: `Count Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: COUNT_COMMANDS_MAX,
          message: null,
          error: err.message || String(err),
        });
      }
    },

    async deleteCountCommand(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const id = String(req.body?.id || '').trim();
      try {
        deleteCountCommand(account.id, id);
        const commands = loadAccountCountCommands(account.id);
        return respondCountCommands(app, req, res, {
          title: `Count Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: COUNT_COMMANDS_MAX,
          message: 'Count command deleted.',
          error: null,
        });
      } catch (err) {
        const commands = loadAccountCountCommands(account.id);
        return respondCountCommands(app, req, res, {
          title: `Count Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: COUNT_COMMANDS_MAX,
          message: null,
          error: err.message || String(err),
        });
      }
    },

    async toggleCountCommand(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const id = String(req.body?.id || '').trim();
      const enabled = String(req.body?.enabled || '').toLowerCase() === 'true';
      try {
        toggleCountCommand(account.id, id, enabled);
        const commands = loadAccountCountCommands(account.id);
        return respondCountCommands(app, req, res, {
          title: `Count Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: COUNT_COMMANDS_MAX,
          message: 'Count command updated.',
          error: null,
        });
      } catch (err) {
        const commands = loadAccountCountCommands(account.id);
        return respondCountCommands(app, req, res, {
          title: `Count Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: COUNT_COMMANDS_MAX,
          message: null,
          error: err.message || String(err),
        });
      }
    },

    async resetCountCommand(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const id = String(req.body?.id || '').trim();
      try {
        resetCount(account.id, id);
        const commands = loadAccountCountCommands(account.id);
        return respondCountCommands(app, req, res, {
          title: `Count Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: COUNT_COMMANDS_MAX,
          message: 'Count reset to 0.',
          error: null,
        });
      } catch (err) {
        const commands = loadAccountCountCommands(account.id);
        return respondCountCommands(app, req, res, {
          title: `Count Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
          maxEntries: COUNT_COMMANDS_MAX,
          message: null,
          error: err.message || String(err),
        });
      }
    },
  };
}

module.exports = { createCountCommandsController };
