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
const {
  normalizeWord,
  embedWord,
  getTargetEmbedding,
  cosineSim,
} = require('../../services/semantic/logic');
const { SEMANTIC_TARGET_WORD } = require('../../config/env');

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

const SCORE_FLOOR = 0.2; // treat anything below as 0%
const SCORE_CEIL = 0.9;  // treat anything at/above as 100%
function formatScore(n) {
  if (n === null || n === undefined) return '-';
  const clamped = Math.max(SCORE_FLOOR, Math.min(SCORE_CEIL, n));
  const scaled = ((clamped - SCORE_FLOOR) / (SCORE_CEIL - SCORE_FLOOR)) * 100;
  return (Math.round(scaled * 10) / 10).toFixed(1); // 0.1% resolution
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

        const rawGuess = args[0];
        const guess = normalizeWord(rawGuess);

        if (invalidWord(guess)) {
          const mention = ctx.mention(getPlayerId(ctx), getPlayerName(ctx));
          return ctx.reply(clamp(`${mention} invalid guess. Use letters only, no spaces.`));
        }

        const targetWord = normalizeWord(SEMANTIC_TARGET_WORD);
        if (!targetWord) {
          return ctx.reply(clamp('Semantic game is not configured yet.'));
        }

        const scopeKey = getScopeKey(ctx);
        if (isSolved(scopeKey)) {
          return ctx.reply(clamp('Game already solved. Restart with a new target to play again.'));
        }

        const targetVec = await getTargetEmbedding();
        if (!targetVec) {
          return ctx.reply(clamp('Could not load target embedding. Try again later.'));
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

        let guessVec;
        try {
          guessVec = await embedWord(guess);
        } catch (err) {
          if (err?.status === 429) {
            const mention = ctx.mention(userId, userName);
            return ctx.reply(clamp(`${mention} OpenAI rate limit exceeded. Try again soon.`));
          }
          return ctx.reply(clamp('Error computing embedding. Try again later.'));
        }

        if (!guessVec) {
          return ctx.reply(clamp('Could not embed that guess. Try a different word.'));
        }

        const score = cosineSim(targetVec, guessVec);
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
