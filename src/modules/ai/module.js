// src/modules/ai/module.js
const { askGPTBounded } = require('../../services/openai');
const { MAX_CHARS } = require('../../config/env');

module.exports = {
  name: 'ai',
  description: 'OpenAI-powered commands.',
  middleware: [
    // Example: simple arg guard for all AI commands
    async (ctx, next) => {
      // e.g., run a moderation check here in the future
      await next();
    },
  ],
  commands: {
    ask: {
      name: 'ask',
      description: 'Ask the model a concise question.',
      usage: 'ask <question>',
      aliases: ['a'],
      async run(ctx) {
        const q = ctx.args.join(' ').trim();
        if (!q) return ctx.reply('Usage: !ai ask <question>');

        let reply = await askGPTBounded(q, MAX_CHARS);
        reply = reply.replace(/\s+/g, ' ').trim();
        const cps = [...reply];
        if (cps.length > MAX_CHARS) reply = cps.slice(0, MAX_CHARS).join('');
        if (!reply) reply = 'NO REPLY FROM AI!';
        await ctx.reply(reply);
        ctx.logger.info(`🧠 ai.ask → ${reply}`);
      },
    },
  },
};
