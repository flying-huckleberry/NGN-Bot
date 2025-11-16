// src/middleware/logCommand.js
const { getLogger } = require('./logger');
const botLogger = getLogger('bot');

module.exports = async function logCommand(ctx, next) {
  try {
    botLogger.info('command.received', {
      command: ctx.commandName,    // make sure ctx has this (see context.js change below)
      user: ctx.authorName,
      args: ctx.args,
    });
  } catch (err) {
    // If logging itself fails, don't break the command
  }

  await next();
};
