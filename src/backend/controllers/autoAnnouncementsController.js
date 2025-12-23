const { getAccountById } = require('../../state/accountsRepo');
const {
  loadAccountAnnouncements,
  upsertAnnouncement,
  deleteAnnouncement,
  toggleAnnouncement,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
} = require('../../state/autoAnnouncements');
const { respondAutoAnnouncements } = require('./helpers');
const { AUTO_ANNOUNCEMENTS_MAX } = require('../../config/env');
const { loadAccountRuntime } = require('../../state/accountRuntime');

function createAutoAnnouncementsController({ app, refreshAutoAnnouncements }) {
  return {
    async listAnnouncements(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const announcements = loadAccountAnnouncements(account.id);
      const runtime = loadAccountRuntime(account.id);
      return respondAutoAnnouncements(app, req, res, {
        title: `Auto Announcements - ${account.name}`,
        active: 'accounts',
        account,
        announcements,
        runtime,
        minMinutes: MIN_INTERVAL_MINUTES,
        maxMinutes: MAX_INTERVAL_MINUTES,
        maxEntries: AUTO_ANNOUNCEMENTS_MAX,
        message: req.query?.message || null,
        error: req.query?.error || null,
      });
    },

    async saveAnnouncement(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }

      const name = String(req.body?.name || '');
      const message = String(req.body?.message || '');
      const intervalMinutes = String(req.body?.intervalMinutes || '');
      const enabled = String(req.body?.enabled || '').toLowerCase() === 'on' ||
        String(req.body?.enabled || '').toLowerCase() === 'true';
      const originalName = String(req.body?.originalName || '').trim();

      try {
        upsertAnnouncement(account.id, {
          name,
          message,
          intervalMinutes,
          enabled,
        }, { originalName });
        if (typeof refreshAutoAnnouncements === 'function') {
          refreshAutoAnnouncements(account.id);
        }
        const announcements = loadAccountAnnouncements(account.id);
        const runtime = loadAccountRuntime(account.id);
        return respondAutoAnnouncements(app, req, res, {
          title: `Auto Announcements - ${account.name}`,
          active: 'accounts',
          account,
          announcements,
          runtime,
          minMinutes: MIN_INTERVAL_MINUTES,
          maxMinutes: MAX_INTERVAL_MINUTES,
          maxEntries: AUTO_ANNOUNCEMENTS_MAX,
          message: 'Auto announcement saved.',
          error: null,
        });
      } catch (err) {
        const announcements = loadAccountAnnouncements(account.id);
        const runtime = loadAccountRuntime(account.id);
        return respondAutoAnnouncements(app, req, res, {
          title: `Auto Announcements - ${account.name}`,
          active: 'accounts',
          account,
          announcements,
          runtime,
          minMinutes: MIN_INTERVAL_MINUTES,
          maxMinutes: MAX_INTERVAL_MINUTES,
          maxEntries: AUTO_ANNOUNCEMENTS_MAX,
          message: null,
          error: err.message || String(err),
        });
      }
    },

    async deleteAnnouncement(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const name = String(req.body?.name || '').trim();
      try {
        deleteAnnouncement(account.id, name);
        if (typeof refreshAutoAnnouncements === 'function') {
          refreshAutoAnnouncements(account.id);
        }
        const announcements = loadAccountAnnouncements(account.id);
        const runtime = loadAccountRuntime(account.id);
        return respondAutoAnnouncements(app, req, res, {
          title: `Auto Announcements - ${account.name}`,
          active: 'accounts',
          account,
          announcements,
          runtime,
          minMinutes: MIN_INTERVAL_MINUTES,
          maxMinutes: MAX_INTERVAL_MINUTES,
          maxEntries: AUTO_ANNOUNCEMENTS_MAX,
          message: 'Auto announcement deleted.',
          error: null,
        });
      } catch (err) {
        const announcements = loadAccountAnnouncements(account.id);
        const runtime = loadAccountRuntime(account.id);
        return respondAutoAnnouncements(app, req, res, {
          title: `Auto Announcements - ${account.name}`,
          active: 'accounts',
          account,
          announcements,
          runtime,
          minMinutes: MIN_INTERVAL_MINUTES,
          maxMinutes: MAX_INTERVAL_MINUTES,
          maxEntries: AUTO_ANNOUNCEMENTS_MAX,
          message: null,
          error: err.message || String(err),
        });
      }
    },

    async toggleAnnouncement(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const name = String(req.body?.name || '').trim();
      const enabled = String(req.body?.enabled || '').toLowerCase() === 'true';
      try {
        toggleAnnouncement(account.id, name, enabled);
        if (typeof refreshAutoAnnouncements === 'function') {
          refreshAutoAnnouncements(account.id);
        }
        const announcements = loadAccountAnnouncements(account.id);
        const runtime = loadAccountRuntime(account.id);
        return respondAutoAnnouncements(app, req, res, {
          title: `Auto Announcements - ${account.name}`,
          active: 'accounts',
          account,
          announcements,
          runtime,
          minMinutes: MIN_INTERVAL_MINUTES,
          maxMinutes: MAX_INTERVAL_MINUTES,
          maxEntries: AUTO_ANNOUNCEMENTS_MAX,
          message: 'Auto announcement updated.',
          error: null,
        });
      } catch (err) {
        const announcements = loadAccountAnnouncements(account.id);
        const runtime = loadAccountRuntime(account.id);
        return respondAutoAnnouncements(app, req, res, {
          title: `Auto Announcements - ${account.name}`,
          active: 'accounts',
          account,
          announcements,
          runtime,
          minMinutes: MIN_INTERVAL_MINUTES,
          maxMinutes: MAX_INTERVAL_MINUTES,
          maxEntries: AUTO_ANNOUNCEMENTS_MAX,
          message: null,
          error: err.message || String(err),
        });
      }
    },
  };
}

module.exports = { createAutoAnnouncementsController };
