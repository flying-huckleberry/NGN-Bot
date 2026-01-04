// src/backend/routes/accounts.js
const express = require('express');
const { createAccountsController } = require('../controllers/accountsController');
const { createCpanelController } = require('../controllers/cpanelController');
const { createModulesController } = require('../controllers/modulesController');
const { createCommandsController } = require('../controllers/commandsController');
const { createAutoAnnouncementsController } = require('../controllers/autoAnnouncementsController');
const { createCountCommandsController } = require('../controllers/countCommandsController');

function registerAccountRoutes(app, {
  pollOnce,
  startPolling,
  getDiscordStatus,
  modules = {},
  refreshAutoAnnouncements,
  autoAnnouncements,
  reservedCommands,
}) {
  app.use(express.urlencoded({ extended: true }));

  // Controllers encapsulate logic; routes just bind URLs.
  const moduleNames = Object.keys(modules || {}).sort();
  const accountsController = createAccountsController({ app, moduleNames, getDiscordStatus });
  const cpanelController = createCpanelController({
    app,
    moduleNames,
    getDiscordStatus,
    pollOnce,
    startPolling,
    autoAnnouncements,
  });
  const modulesController = createModulesController({ app, moduleNames });
  const commandsController = createCommandsController({ app, reservedCommands });
  const autoAnnouncementsController = createAutoAnnouncementsController({
    app,
    refreshAutoAnnouncements,
  });
  const countCommandsController = createCountCommandsController({ app, reservedCommands });

  app.get('/', accountsController.redirectRoot);
  app.get('/accounts', accountsController.listAccounts);
  app.post('/accounts', accountsController.createAccount);
  app.get('/accounts/:id/cpanel', cpanelController.getCpanel);
  app.post('/accounts/:id', accountsController.updateAccount);
  app.post('/accounts/:id/delete', accountsController.deleteAccount);

  app.get('/accounts/:id/commands', commandsController.listCommands);
  app.post('/accounts/:id/commands/save', commandsController.saveCommand);
  app.post('/accounts/:id/commands/delete', commandsController.deleteCommand);
  app.post('/accounts/:id/commands/toggle', commandsController.toggleCommand);

  app.get('/accounts/:id/auto-announcements', autoAnnouncementsController.listAnnouncements);
  app.post('/accounts/:id/auto-announcements/save', autoAnnouncementsController.saveAnnouncement);
  app.post('/accounts/:id/auto-announcements/delete', autoAnnouncementsController.deleteAnnouncement);
  app.post('/accounts/:id/auto-announcements/toggle', autoAnnouncementsController.toggleAnnouncement);

  app.get('/accounts/:id/counts', countCommandsController.listCountCommands);
  app.post('/accounts/:id/counts/save', countCommandsController.saveCountCommand);
  app.post('/accounts/:id/counts/delete', countCommandsController.deleteCountCommand);
  app.post('/accounts/:id/counts/toggle', countCommandsController.toggleCountCommand);
  app.post('/accounts/:id/counts/reset', countCommandsController.resetCountCommand);

  app.get('/accounts/:id/modules/:module', modulesController.getModule);
  app.post('/accounts/:id/modules/:module', modulesController.updateModule);
  app.get('/accounts/:id/modules/:module/geocode', modulesController.geocodeWeather);

  app.post('/accounts/:id/cpanel/modules', cpanelController.toggleModule);
  app.post('/accounts/:id/cpanel/transports', cpanelController.toggleTransport);
  app.post('/accounts/:id/cpanel/connect', cpanelController.connectOverride);
  app.post('/accounts/:id/cpanel/prime', cpanelController.primeChat);
  app.post('/accounts/:id/cpanel/poll', cpanelController.pollOnce);
  app.post('/accounts/:id/cpanel/reset', cpanelController.resetRuntime);
}

module.exports = { registerAccountRoutes };
