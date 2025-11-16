// src/modules/core/module.js
const { ownerOnly } = require('../../utils/permissions');
const logCommand = require('../../utils/logCommand');



module.exports = {
  name: 'core',
  description: 'Core utility commands.',
  middleware: [logCommand],
  commands: {
    help: {
      name: 'help',
      description: 'List modules or commands.',
      usage: 'help [module] [command]',
      async run(ctx) {
        const { registry } = ctx.services;
        const [m, c] = ctx.args.map((s) => s.toLowerCase());

        // generic help, no specific module
        if (!m) return ctx.reply(`Modules: ${Object.keys(registry.modules).join(' | ')}`);

        const mod = registry.modules[m];
        // invalid module supplied
        if (!mod) return ctx.reply(`No module "${m}"`);

        // no command supplied, show them the commands for the module
        if (!c) return ctx.reply(`Commands for "${m}": ${Object.keys(mod.commands).join(' | ')}`);

        const def = mod.commands[c];
        // invalid command supplied for module
        if (!def) return ctx.reply(`No command "${m}.${c}"`);

        const usage = def.usage ? ` — ${ctx.env.COMMAND_PREFIX}${def.usage}` : '';
        // return description for [module] [command]
        return ctx.reply(`${m}.${c}: ${def.description || 'No description'}${usage}`);
      },
    },

    ping: {
      name: 'ping',
      description: 'Health check.',
      async run(ctx) {
        await ctx.reply('pong');
      },
    },

    // EXAMPLE: owner-only command
    whoami: {
      name: 'whoami',
      description: 'Debug info for the owner.',
      middleware: [ownerOnly()], // ← only the owner can run this command
      async run(ctx) {
        const a = ctx.msg?.authorDetails;
        await ctx.reply(
          `You are ${a?.displayName || 'unknown'}`
        );
      },
    },
  },
};
