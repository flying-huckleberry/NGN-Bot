// src/modules/core/module.js
const { ownerOnly } = require('../../utils/permissions');

module.exports = {
  name: 'core',
  description: 'Core utility commands.',
  // EXAMPLE: to make the entire module owner-only, uncomment:
  // middleware: [ownerOnly()],
  commands: {
    help: {
      name: 'help',
      description: 'List modules or commands.',
      usage: 'help [module] [command]',
      async run(ctx) {
        const { registry } = ctx.services;
        const [m, c] = ctx.args.map((s) => s.toLowerCase());
        if (!m) return ctx.reply(`Modules: ${Object.keys(registry.modules).join(', ')}`);

        const mod = registry.modules[m];
        if (!mod) return ctx.reply(`No module "${m}"`);
        if (!c) return ctx.reply(`${m}: ${Object.keys(mod.commands).join(', ')}`);

        const def = mod.commands[c];
        if (!def) return ctx.reply(`No command "${m}.${c}"`);
        const usage = def.usage ? ` — ${def.usage}` : '';
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
