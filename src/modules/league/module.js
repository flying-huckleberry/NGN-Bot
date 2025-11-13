// src/modules/league/module.js
module.exports = {
  name: 'league',
  description: 'Fun/knowledge via APILeague (constrained for chat).',
  commands: {
    joke: {
      name: 'joke',
      description: 'Random joke.',
      usage: 'league joke [max=120]',
      async run(ctx) {
        const kv = Object.fromEntries(
          ctx.args.map(s => s.split('=')).filter(a => a.length === 2)
        );
        const max = kv.max ? Number(kv.max) : undefined;

        try {
          const text = await ctx.services.league.randomJoke({ maxLength: max });
          const out = text || 'No joke.';
          await ctx.reply(
            out.length > ctx.env.CHAT_MAX_CHARS
              ? out.slice(0, ctx.env.CHAT_MAX_CHARS - 1) + '…'
              : out
          );
        } catch (e) {
          ctx.logger.warn('[league.joke]', e.message || e);
          await ctx.reply('No joke right now.');
        }
      },
    },

    trivia: {
      name: 'trivia',
      description: 'Random trivia.',
      usage: 'league trivia [max=140]',
      async run(ctx) {
        const kv = Object.fromEntries(
          ctx.args.map(s => s.split('=')).filter(a => a.length === 2)
        );
        const max = kv.max ? Number(kv.max) : undefined;

        try {
          const text = await ctx.services.league.randomTrivia({ maxLength: max });
          const out = text || 'No trivia.';
          await ctx.reply(
            out.length > ctx.env.CHAT_MAX_CHARS
              ? out.slice(0, ctx.env.CHAT_MAX_CHARS - 1) + '…'
              : out
          );
        } catch (e) {
          ctx.logger.warn('[league.trivia]', e.message || e);
          await ctx.reply('No trivia right now.');
        }
      },
    },

    riddle: {
      name: 'riddle',
      description: 'Random riddle (difficulty fixed in code).',
      usage: 'league riddle',
      async run(ctx) {
        try {
          const text = await ctx.services.league.randomRiddle();
          const out = text || 'No riddle.';
          await ctx.reply(
            out.length > ctx.env.CHAT_MAX_CHARS
              ? out.slice(0, ctx.env.CHAT_MAX_CHARS - 1) + '…'
              : out
          );
        } catch (e) {
          ctx.logger.warn('[league.riddle]', e.message || e);
          await ctx.reply('No riddle right now.');
        }
      },
    },

    quote: {
      name: 'quote',
      description: 'Random quote (min/max bounded in code).',
      usage: 'league quote [min=40] [max=140]',
      async run(ctx) {
        const kv = Object.fromEntries(
          ctx.args.map(s => s.split('=')).filter(a => a.length === 2)
        );
        const min = kv.min ? Number(kv.min) : undefined;
        const max = kv.max ? Number(kv.max) : undefined;

        try {
          const text = await ctx.services.league.randomQuote({
            minLength: min,
            maxLength: max,
          });
          const out = text || 'No quote.';
          await ctx.reply(
            out.length > ctx.env.CHAT_MAX_CHARS
              ? out.slice(0, ctx.env.CHAT_MAX_CHARS - 1) + '…'
              : out
          );
        } catch (e) {
          ctx.logger.warn('[league.quote]', e.message || e);
          await ctx.reply('No quote right now.');
        }
      },
    },

    poem: {
      name: 'poem',
      description: 'Random short poem (1–4 lines, sanitized).',
      usage: 'league poem',
      async run(ctx) {
        try {
          const text = await ctx.services.league.randomPoem();
          const out = text || 'No poem.';
          await ctx.reply(
            out.length > ctx.env.CHAT_MAX_CHARS
              ? out.slice(0, ctx.env.CHAT_MAX_CHARS - 1) + '…'
              : out
          );
        } catch (e) {
          ctx.logger.warn('[league.poem]', e.message || e);
          await ctx.reply('No poem right now.');
        }
      },
    },

    convert: {
      name: 'convert',
      description: 'Convert units using APILeague.',
      usage: 'league convert <amount> <fromUnit> <toUnit>',
      async run(ctx) {
        const [amount, fromUnit, toUnit] = ctx.args;

        if (!amount || !fromUnit || !toUnit) {
          return ctx.reply('Usage: !league convert <amount> <fromUnit> <toUnit>');
        }

        // you can add more validation here if you want
        try {
          const answer = await ctx.services.league.convertUnits({
            sourceAmount: amount,
            sourceUnit: fromUnit,
            targetUnit: toUnit,
          });

          const out = answer || 'No conversion result.';
          const max = ctx.env.CHAT_MAX_CHARS;
          await ctx.reply(
            out.length > max ? out.slice(0, max - 1) + '…' : out
          );
        } catch (e) {
          ctx.logger.warn('[league.convert]', e.message || e);
          await ctx.reply('Conversion failed.');
        }
      },
    },
  },
};
