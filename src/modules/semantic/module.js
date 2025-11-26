// src/modules/semantic/module.js
// Semantic similarity guessing game using OpenAI embeddings.
const { MAX_CHARS } = require('../../config/env');
const {
  ensurePlayer,
  setPlayer,
  listPlayers,
  setSolved,
  isSolved,
  resetAll,
} = require('../../services/semantic/state');
const { normalizeWord } = require('../../services/semantic/logic');
const { SEMANTIC_TARGET_WORD } = require('../../config/env');
const { getModerationAction, DISALLOWED_MESSAGE, SELF_HARM_MESSAGE, openai } = require('../../services/openai');

const DEFAULT_MAX_CHARS = Number(MAX_CHARS || 190);

function clamp(text) {
  if (!text) return '';
  if (text.length <= DEFAULT_MAX_CHARS) return text;
  return `${text.slice(0, DEFAULT_MAX_CHARS - 3)}...`;
}

function getScopeKey(ctx) {
  return ctx.stateScope || 'global';
}

function getPlayerId(ctx) {
  const author =
    ctx.author ||
    ctx.user ||
    (ctx.msg && ctx.msg.authorDetails) ||
    null;

  return (
    author?.channelId ||
    author?.id ||
    ctx.userId ||
    ctx.username ||
    'anonymous'
  );
}

function getPlayerName(ctx) {
  const author =
    ctx.author ||
    ctx.user ||
    (ctx.msg && ctx.msg.authorDetails) ||
    null;

  return (
    author?.displayName ||
    author?.name ||
    ctx.username ||
    'Player'
  );
}

function isAdminOrOwner(ctx) {
  if (ctx.platform === 'discord') {
    const member = ctx.platformMeta?.rawDiscord?.member;
    return Boolean(member?.permissions?.has?.('Administrator'));
  }
  if (ctx.platform === 'youtube') {
    return Boolean(ctx.msg?.authorDetails?.isChatOwner);
  }
  return false;
}

function cosineToHumanScore(cosine) {
  if (cosine === null || cosine === undefined || Number.isNaN(cosine)) {
    return null;
  }

  // Clamp to [-1, 1] just to be safe
  let c = Math.max(-1, Math.min(1, cosine));

  const tCold = 0.20;   // up to here = "cold"
  const tHot = 0.60;    // from here up = "very close"
  const lowMax = 25;    // max score in the "cold" band

  // Everything negative we just treat as zero-cold
  if (c <= 0) {
    return 0;
  }

  // 0 .. tCold  →  0 .. lowMax  (linear)
  if (c <= tCold) {
    return (c / tCold) * lowMax;
  }

  // tCold .. tHot  →  lowMax .. 100  (linear)
  if (c < tHot) {
    const frac = (c - tCold) / (tHot - tCold); // 0..1
    return lowMax + frac * (100 - lowMax);
  }

  // tHot+ → maxed out
  return 100;
}

function formatScore(n) {
  const human = cosineToHumanScore(n);
  if (human === null) return '-';
  return (Math.round(human * 10) / 10).toFixed(1); // 0.1% resolution
}

function formatBest(best) {
  if (!best || best.word === undefined || best.score === undefined) {
    return 'best guess - -';
  }
  return `best guess ${best.word} ${formatScore(best.score)}%`;
}

function invalidWord(word) {
  return !/^[a-zA-Z]+$/.test(word);
}

module.exports = {
  name: 'semantic',
  description: 'Semantic similarity guessing game.',
  commands: {
    guess: {
      name: 'guess',
      description: 'Guess the target word.',
      usage: 'guess <word>',
      aliases: [],
      async run(ctx) {
        const args = ctx.args || [];
        if (args.length < 1) {
          return ctx.reply(clamp('Usage: !guess <word>'));
        }

        const rawGuess = args.join(' ').trim();
        const guess = normalizeWord(rawGuess);

        // Single-word, letters-only rule
        if (!guess || /\s/.test(rawGuess) || invalidWord(guess)) {
          const mention = ctx.mention(getPlayerId(ctx), getPlayerName(ctx));
          return ctx.reply(
            clamp(
              `${mention} invalid guess. Use a single word with letters only. (Target is one word.)`
            )
          );
        }

        const targetWord = normalizeWord(SEMANTIC_TARGET_WORD);
        if (!targetWord) {
          return ctx.reply(clamp('Semantic game is not configured yet.'));
        }

        const scopeKey = getScopeKey(ctx);
        if (isSolved(scopeKey)) {
          return ctx.reply(clamp('Game already solved. Restart with a new target to play again.'));
        }

        const userId = getPlayerId(ctx);
        const userName = getPlayerName(ctx);
        const player = ensurePlayer(scopeKey, userId, userName);

        // Check exact win
        if (guess === targetWord) {
          player.wins += 1;
          player.guesses += 1;
          player.best = { word: guess, score: 1 };
          setPlayer(scopeKey, player.id, player);
          setSolved(scopeKey, true);
          const mention = ctx.mention(userId, userName);
          return ctx.reply(
            clamp(`${mention} solved it in ${player.guesses} guesses! word: ${targetWord}`)
          );
        }

        // Moderation check (guess only)
        const action = await getModerationAction(guess);
        if (action === 'self_harm') {
          return ctx.reply(clamp(SELF_HARM_MESSAGE));
        }
        if (action === 'block') {
          return ctx.reply(clamp(DISALLOWED_MESSAGE));
        }

        // Call chat to get similarity scores
        let score = null;
        try {
          const completion = await openai.chat.completions.create({
            model: ctx.env.OPENAI_MODEL || 'gpt-4o-mini',
            temperature: 0,
            response_format: { type: 'json_object' },
            messages: [
              {
                role: 'system',
                content:
                  'You are a word similarity grader for a word-guessing game.\n' +
                  'Your job is to analyze the relationship between two English words: a TARGET (single word) and a GUESS.\n' +
                  'You must score several different kinds of meaning-based closeness between 0 and 100.\n' +
                  'IMPORTANT:\n' +
                  '- Focus ONLY on meaning and conceptual relationships, unless a field explicitly mentions spelling.\n' +
                  '- Do NOT increase any meaning-based scores just because the words look or sound similar.\n' +
                  '- If the GUESS is incomprehensible gibberish or not a valid English word/phrase, return 0 for all fields.\n' +
                  '- Unrelated or extremely weakly related words should receive scores near 0–10 in all meaning-based fields.\n' +
                  '- Return ONLY a single JSON object, with integer values, no explanation text.\n',
              },
              {
                role: 'user',
                content:
                  `TARGET: "${targetWord}"\n` +
                  `GUESS: "${guess}"\n` +
                  'Return JSON exactly in this format:\n' +
                  '{\n' +
                  '  "semantic_domain": 0,\n' +
                  '  "synonymy": 0,\n' +
                  '  "antonymy": 0,\n' +
                  '  "functional_relation": 0,\n' +
                  '  "association": 0,\n' +
                  '  "spelling_or_sound_similarity": 0\n' +
                  '}\n' +
                  'Fill in each value with an integer from 0 to 100.',
              },
            ],
          });

          const raw = completion.choices[0]?.message?.content || '{}';
          let parsed = {};
          try {
            parsed = JSON.parse(raw);
          } catch (_) {
            parsed = {};
          }
          const values = Object.values(parsed).filter((v) => Number.isFinite(v));
          score = values.length ? Math.max(...values) / 100 : null;
        } catch (err) {
          if (err?.status === 429) {
            const mention = ctx.mention(userId, userName);
            return ctx.reply(clamp(`${mention} OpenAI rate limit exceeded. Try again soon.`));
          }
          return ctx.reply(clamp('Error computing similarity. Try again later.'));
        }

        if (score === null) {
          return ctx.reply(clamp('Similarity could not be computed.'));
        }

        player.guesses += 1;
        if (!player.best || score > player.best.score) {
          player.best = { word: guess, score };
        }
        setPlayer(scopeKey, player.id, player);

        const mention = ctx.mention(userId, userName);
        const reply = `${mention} guess ${guess} similarity ${formatScore(
          score
        )}% | ${formatBest(player.best)} | guesses ${player.guesses}`;
        return ctx.reply(clamp(reply));
      },
    },

    semantic: {
      name: 'semantic',
      description: 'Show semantic game commands.',
      usage: 'semantic',
      aliases: ['semantichelp'],
      async run(ctx) {
        const mention = ctx.mention(getPlayerId(ctx), getPlayerName(ctx));
        const cmds = [
          '!guess <word>',
          '!semantic',
          '!semanticwins',
          '!semanticreset',
        ];
        return ctx.reply(clamp(`${mention} semantic: ${cmds.join(' | ')}`));
      },
    },

    semanticwins: {
      name: 'semanticwins',
      description: 'Show win leaderboard.',
      usage: 'semanticwins',
      aliases: [],
      async run(ctx) {
        const scopeKey = getScopeKey(ctx);
        const players = listPlayers(scopeKey);
        if (!players.length) {
          return ctx.reply(clamp('No players yet.'));
        }
        const ranked = players
          .map((p) => ({ id: p.id, name: p.name, wins: p.wins || 0 }))
          .sort((a, b) => b.wins - a.wins || a.name.localeCompare(b.name));

        const parts = [];
        ranked.forEach((p, idx) => {
          const mention = ctx.mention(p.id, p.name);
          const row = `${idx + 1}) ${mention} wins ${p.wins}`;
          if (parts.join(' | ').length + row.length + 3 <= DEFAULT_MAX_CHARS) {
            parts.push(row);
          }
        });

        return ctx.reply(clamp(parts.join(' | ') || 'No players yet.'));
      },
    },

    semanticreset: {
      name: 'semanticreset',
      description: 'ADMIN-ONLY: Reset semantic game data.',
      usage: 'semanticreset',
      aliases: ['resetsemantic'],
      async run(ctx) {
        if (!isAdminOrOwner(ctx)) {
          return; // silent deny
        }
        const scopeKey = getScopeKey(ctx);
        resetAll(scopeKey);
        return ctx.reply(clamp('Semantic game state reset for this scope.'));
      },
    },
  },
};
