// src/modules/league/module.js
const { getLogger } = require('../../utils/logger');
const botLogger = getLogger('bot');

function getChatLimit(env) {
  const n = Number(env?.CHAT_MAX_CHARS);
  return Number.isFinite(n) && n > 0 ? n : 300;
}

module.exports = {
  name: 'league',
  description: 'Fun/knowledge via APILeague (constrained for chat).',
  commands: {
    joke: {
      name: 'joke',
      description: 'Random joke.',
      usage: 'league joke',
      async run(ctx) {
        const maxLength = getChatLimit(ctx.env);

        try {
          const text = await ctx.services.league.randomJoke({ 
            'maxLength': maxLength,
          });
          const out = text || 'No joke.';
          botLogger.warn('returned joke is '+out.length+' characters long');
          const msg =
            out.length > maxLength
              ? out.slice(0, maxLength - 1) + '…'
              : out;

          botLogger.info('[league.joke] sending', {
            user: ctx.authorName,
            maxLength,
            out: msg,
          });

          await ctx.reply(msg);
        } catch (e) {
          botLogger.warn('[league.joke] failed', {
            user: ctx.authorName,
            error: e.message || String(e),
          });
          await ctx.reply('No joke right now.');
        }
      },
    },

    trivia: {
      name: 'trivia',
      description: 'Random trivia.',
      usage: 'league trivia',
      async run(ctx) {
        const maxLength = getChatLimit(ctx.env);

        try {
          const text = await ctx.services.league.randomTrivia({ maxLength });
          const out = text || 'No trivia.';
          const msg =
            out.length > maxLength
              ? out.slice(0, maxLength - 1) + '…'
              : out;

          botLogger.info('[league.trivia] sending', {
            user: ctx.authorName,
            maxLength,
            out: msg,
          });

          await ctx.reply(msg);
        } catch (e) {
          botLogger.warn('[league.trivia] failed', {
            user: ctx.authorName,
            error: e.message || String(e),
          });
          await ctx.reply('No trivia right now.');
        }
      },
    },

    riddle: {
      name: 'riddle',
      description:
        'Random riddle. Difficulty is fixed in code, answer is revealed after a delay.',
      usage: 'league riddle',
      async run(ctx) {
        try {
          const { riddle, answer } = await ctx.services.league.randomRiddle();

          const max = getChatLimit(ctx.env);
          const clamp = (text) =>
            String(text || '').length > max
              ? String(text || '').slice(0, max - 1) + '...'
              : String(text || '');

          const riddleMsg = clamp(riddle || 'No riddle.');

          botLogger.info('[league.riddle] sending riddle', {
            user: ctx.authorName,
            riddle: riddleMsg,
          });

          await ctx.reply(riddleMsg);

          const timeoutMs = Number(ctx.env.RIDDLE_TIMEOUT || 120000); // 2 mins

          setTimeout(() => {
            const reveal = clamp(`Answer: ${answer} || ${riddleMsg}`);

            botLogger.info('[league.riddle] sending answer', {
              user: ctx.authorName,
              reveal,
            });

            // fire-and-forget; add catch to avoid unhandled rejection noise
            ctx
              .reply(reveal)
              .catch(err =>
                botLogger.error('[league.riddle] reply failed', {
                  error: err.message || String(err),
                })
              );
          }, timeoutMs);
        } catch (e) {
          botLogger.warn('[league.riddle] failed', {
            user: ctx.authorName,
            error: e.message || String(e),
          });
          await ctx.reply('No riddle right now.');
        }
      },
    },

    quote: {
      name: 'quote',
      description: 'Random quote (min/max bounded in code).',
      usage: 'league quote',
      async run(ctx) {
        const maxLength = getChatLimit(ctx.env);
        const minLength = 20;

        try {
          const text = await ctx.services.league.randomQuote({
            minLength,
            maxLength,
          });
          const out = text || 'No quote.';
          const msg =
            out.length > maxLength
              ? out.slice(0, maxLength - 1) + '…'
              : out;

          botLogger.info('[league.quote] sending', {
            user: ctx.authorName,
            minLength,
            maxLength,
            out: msg,
          });

          await ctx.reply(msg);
        } catch (e) {
          botLogger.warn('[league.quote] failed', {
            user: ctx.authorName,
            error: e.message || String(e),
          });
          await ctx.reply('No quote right now.');
        }
      },
    },

    poem: {
      name: 'poem',
      description: 'Random short poem (1–4 lines, sanitized).',
      usage: 'league poem',
      async run(ctx) {
        const maxLength = getChatLimit(ctx.env);

        try {
          const text = await ctx.services.league.randomPoem({
            minLines: 1,
            maxLines: 4,
          });
          const out = text || 'No poem.';
          const msg =
            out.length > maxLength
              ? out.slice(0, maxLength - 1) + '…'
              : out;

          botLogger.info('[league.poem] sending', {
            user: ctx.authorName,
            out: msg,
          });

          await ctx.reply(msg);
        } catch (e) {
          botLogger.warn('[league.poem] failed', {
            user: ctx.authorName,
            error: e.message || String(e),
          });
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

        try {
          const answer = await ctx.services.league.convertUnits({
            sourceAmount: amount,
            sourceUnit: fromUnit,
            targetUnit: toUnit,
          });

          const out = answer || 'No conversion result.';
          const max = getChatLimit(ctx.env);
          const msg =
            out.length > max ? out.slice(0, max - 1) + '…' : out;

          botLogger.info('[league.convert] sending', {
            user: ctx.authorName,
            amount,
            fromUnit,
            toUnit,
            out: msg,
          });

          await ctx.reply(msg);
        } catch (e) {
          botLogger.warn('[league.convert] failed', {
            user: ctx.authorName,
            error: e.message || String(e),
          });
          await ctx.reply('Conversion failed.');
        }
      },
    },
  },
};
