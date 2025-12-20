// src/backend/routes/accounts.js
const express = require('express');
const { createAccountsController } = require('../controllers/accountsController');
const { createCpanelController } = require('../controllers/cpanelController');
const { createModulesController } = require('../controllers/modulesController');
const { createCommandsController } = require('../controllers/commandsController');

function registerAccountRoutes(app, { pollOnce, getDiscordStatus, modules = {} }) {
  app.use(express.urlencoded({ extended: true }));

  const moduleNames = Object.keys(modules || {}).sort();
  const accountsController = createAccountsController({ app, moduleNames, getDiscordStatus });
  const cpanelController = createCpanelController({ app, moduleNames, getDiscordStatus, pollOnce });
  const modulesController = createModulesController({ app, moduleNames });
  const commandsController = createCommandsController({ app });

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

  app.get('/accounts/:id/modules/:module', modulesController.getModule);
  app.post('/accounts/:id/modules/:module', modulesController.updateModule);

  app.post('/accounts/:id/cpanel/modules', cpanelController.toggleModule);
  app.post('/accounts/:id/cpanel/transports', cpanelController.toggleTransport);
  app.post('/accounts/:id/cpanel/connect', cpanelController.connectOverride);
  app.post('/accounts/:id/cpanel/prime', cpanelController.primeChat);
  app.post('/accounts/:id/cpanel/poll', cpanelController.pollOnce);
  app.post('/accounts/:id/cpanel/reset', cpanelController.resetRuntime);
}

module.exports = { registerAccountRoutes };
