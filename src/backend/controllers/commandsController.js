const { getAccountById } = require('../../state/accountsRepo');
const {
  loadAccountCommands,
  upsertCommand,
  deleteCommand,
  toggleCommand,
} = require('../../state/customCommands');
const { respondCommands } = require('./helpers');

function createCommandsController({ app }) {
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
      const originalName = String(req.body?.originalName || '').trim();

      try {
        upsertCommand(account.id, { name, response, platform, enabled }, { originalName });
        const commands = loadAccountCommands(account.id);
        return respondCommands(app, req, res, {
          title: `Custom Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
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
      const name = String(req.body?.name || '').trim();
      try {
        deleteCommand(account.id, name);
        const commands = loadAccountCommands(account.id);
        return respondCommands(app, req, res, {
          title: `Custom Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
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
      const name = String(req.body?.name || '').trim();
      const enabled = String(req.body?.enabled || '').toLowerCase() === 'true';
      try {
        toggleCommand(account.id, name, enabled);
        const commands = loadAccountCommands(account.id);
        return respondCommands(app, req, res, {
          title: `Custom Commands - ${account.name}`,
          active: 'accounts',
          account,
          commands,
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
          message: null,
          error: err.message || String(err),
        });
      }
    },
  };
}

module.exports = { createCommandsController };
