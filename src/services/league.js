// src/services/league.js
const { APILEAGUE_API_KEY, CHAT_MAX_CHARS, RIDDLE_TIMEOUT } = require('../config/env');
const ApileagueJs = require('apileague-js');

const defaultClient = ApileagueJs.ApiClient.instance;
defaultClient.authentications['apiKey'].apiKey = APILEAGUE_API_KEY;
defaultClient.authentications['headerApiKey'].apiKey = APILEAGUE_API_KEY;

// ---------- helpers ----------
const MAX_CHARS = Number.isFinite(+CHAT_MAX_CHARS) ? +CHAT_MAX_CHARS : 190;

function clampLen(v, lo = 10, hi = MAX_CHARS) {
  const n = Number(v);
  const safe = Number.isFinite(n) ? n : undefined;
  if (safe === undefined) return undefined;
  return Math.max(lo, Math.min(hi, safe));
}

function sanitizeOneLine(str) {
  return String(str || '')
    .replace(/\r?\n+/g, ' / ')
    .replace(/\s+/g, ' ')
    .trim();
}

// generic promisifier for SDK callbacks
function promisify(fn, thisArg) {
  return (...args) =>
    new Promise((resolve, reject) => {
      fn.call(thisArg, ...args, (error, data, response) => {
        if (error) reject(error);
        else resolve({ data, response });
      });
    });
}

// ---------- SDK instances ----------
const humorApi = new ApileagueJs.HumorApi();
const knowledgeApi = new ApileagueJs.KnowledgeApi();
const artApi = new ApileagueJs.ArtApi();
const mathApi = new ApileagueJs.MathApi();

// ---------- Promisified raw methods ----------
const randomJokeAPIP   = promisify(humorApi.randomJokeAPI, humorApi);
const randomTriviaAPIP = promisify(knowledgeApi.randomTriviaAPI, knowledgeApi);
const randomRiddleAPIP = promisify(knowledgeApi.randomRiddleAPI, knowledgeApi);
const randomQuoteAPIP  = promisify(knowledgeApi.randomQuoteAPI, knowledgeApi);
const randomPoemAPIP   = promisify(artApi.randomPoemAPI, artApi);
const convertUnitsAPIP  = promisify(mathApi.convertUnitsAPI, mathApi);

// ---------- App-level wrappers with YOUR constraints ----------

// You can edit these defaults later; they are not exposed to users.
const JOKE_DEFAULTS = {
  includeTags: [],  // https://apileague.com/apis/random-joke-api/
  excludeTags: ['nsfw','racist','insult','jewish'],   // e.g., ['nsfw', 'racist']
  minRating: 0.5,      // 0.0 - 1.0
};

/**
 * Random joke with internal filters + bounded length.
 * Users do NOT provide include/exclude/minRating; all internal here.
 */
async function randomJoke({ maxLength } = {}) {
  const apiOpts = {
    'include-tags': JOKE_DEFAULTS.includeTags,
    'exclude-tags': JOKE_DEFAULTS.excludeTags,
    'min-rating':   JOKE_DEFAULTS.minRating,
    'max-length':   clampLen(maxLength), // between 10 and MAX_CHARS
  };
  const { data } = await randomJokeAPIP(apiOpts);
  // sanitize to one line for chat safety
  data.joke = sanitizeOneLine(data.joke);
  return data.joke;
}

/**
 * Trivia with bounded length.
 */
async function randomTrivia({ maxLength } = {}) {
  const apiOpts = { 'max-length': clampLen(maxLength) };
  const { data } = await randomTriviaAPIP(apiOpts);
  data.trivia = sanitizeOneLine(data.trivia);
  return data.trivia;
}


//----------------------------------TODO RIDDLE AND GUESS--------------------------------------------------
/**
 * Riddle with fixed difficulty
 */
async function randomRiddle() {
  const apiOpts = { difficulty: 'medium' }; // easy, medium, hard
  const { data } = await randomRiddleAPIP(apiOpts);
  const riddle = sanitizeOneLine(data.riddle);
  const answer = sanitizeOneLine(data.answer);
  return { riddle, answer };
}

/**
 * Quote with bounded min/max length.
 */
async function randomQuote({ minLength, maxLength } = {}) {
  const lo = clampLen(minLength);
  const hi = clampLen(maxLength);
  const apiOpts = {
    'min-length': lo,
    'max-length': hi,
  };
  const { data } = await randomQuoteAPIP(apiOpts);
  data.quote = sanitizeOneLine(data.quote);
  data.author = sanitizeOneLine(data.author);
  const quote = [data.quote, data.author].filter(Boolean).join(' - ');

  return quote;
}

/**
 * Poem with fixed 1..4 lines and newline sanitization.
 */
async function randomPoem() {
  const apiOpts = {
    'min-lines': 1,
    'max-lines': 4,
  };
  const { data } = await randomPoemAPIP(apiOpts);
  // Replace newlines with ' / ' as required
  data.title = sanitizeOneLine(data.title);
  data.poem = sanitizeOneLine(data.poem);
  data.author = sanitizeOneLine(data.author);
  let poem = '("'+data.title+'" by '+data.author+') '+data.poem;

  return poem;
}

/**
 * Low-level Promise wrapper around MathApi.convertUnitsAPI
 * Signature per SDK: convertUnitsAPI(sourceAmount, sourceUnit, targetUnit, opts, callback)
 */
function convertUnitsRaw(sourceAmount, sourceUnit, targetUnit, extraOpts = {}) {
  return new Promise((resolve, reject) => {
    mathApi.convertUnitsAPI(
      sourceAmount,
      sourceUnit,
      targetUnit,
      extraOpts,
      (error, data, response) => {
        if (error) reject(error);
        else resolve({ data, response });
      }
    );
  });
}


/**
 * Convert units [sourceAmount, sourceUnit, targetUnit]
 * Returns a single string like "28.35 oz"
 */
async function convertUnits({ sourceAmount, sourceUnit, targetUnit, foodName } = {}) {
  // SDK expects numbers, but will usually coerce strings; still, be nice:
  const amountNum = Number(sourceAmount);
  if (!Number.isFinite(amountNum)) {
    throw new Error(`Invalid sourceAmount: ${sourceAmount}`);
  }

  const extraOpts = {};
  if (foodName) extraOpts['food-name'] = foodName;

  const { data } = await convertUnitsRaw(amountNum, sourceUnit, targetUnit, extraOpts);

  // Per docs, data looks like:
  // { "target_amount": 220.46226218487757, "target_unit": "lb" }
  const targetAmount = sanitizeOneLine(
    data.target_amount ?? data['target_amount'] ?? data['target-amount'] ?? ''
  );
  const targetUnitClean = sanitizeOneLine(
    data.target_unit ?? data['target_unit'] ?? data['target-unit'] ?? targetUnit
  );

  const answer = [targetAmount, targetUnitClean].filter(Boolean).join(' ');
  return answer;
}


module.exports = {
  _clients: { humorApi, knowledgeApi, artApi, mathApi },
  randomJoke,
  randomTrivia,
  randomRiddle,
  randomQuote,
  randomPoem,
  convertUnits,
};
