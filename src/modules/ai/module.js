// src/modules/ai/module.js
const { askGPT } = require('../../services/openai');
const { MAX_CHARS } = require('../../config/env');

module.exports = {
  name: 'ai',
  description: 'OpenAI-powered commands.',
  middleware: [
    async (ctx, next) => {
      // Placeholder for per-command middleware if you ever want it
      await next();
    },
  ],
  commands: {
    ask: {
      name: 'ask',
      description: 'Ask the model a concise question.',
      usage: 'ask <question>',
      aliases: ['a', 'ai'],
      async run(ctx) {
        const q = ctx.args.join(' ').trim();
        if (!q) return ctx.reply(`Usage: ${ctx.commandPrefix}ai ask <question>`);

        let reply = await askGPT(q, MAX_CHARS);
        ctx.logger.info(`🧠 ai.ask → ${q}`);
        if (!reply) reply = 'NO REPLY FROM AI!';

        await ctx.reply(reply);
        ctx.logger.info(`🧠 ai.reply → ${reply}`);
      },
    },
  },
};
