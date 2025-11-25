// src/services/semantic/logic.js
// Handles embeddings and similarity for the semantic word game.
const { openai } = require('../openai');
const { SEMANTIC_TARGET_WORD } = require('../../config/env');
const { logger } = require('../../utils/logger');

const MODEL = 'text-embedding-3-large';

let cachedTargetWord = null;
let cachedTargetEmbedding = null;

function normalizeWord(word) {
  return String(word || '').trim().toLowerCase();
}

async function embedWord(word) {
  const normalized = normalizeWord(word);
  if (!normalized) return null;
  const res = await openai.embeddings.create({
    model: MODEL,
    input: [normalized],
  });
  return res.data?.[0]?.embedding || null;
}

async function getTargetEmbedding() {
  const target = normalizeWord(SEMANTIC_TARGET_WORD);
  if (!target) return null;
  if (cachedTargetWord === target && cachedTargetEmbedding) {
    return cachedTargetEmbedding;
  }
  try {
    const vec = await embedWord(target);
    cachedTargetWord = target;
    cachedTargetEmbedding = vec;
    return vec;
  } catch (err) {
    logger.error('[semantic] failed to embed target word', err);
    return null;
  }
}

function cosineSim(a, b) {
  if (!a || !b || a.length !== b.length) return null;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (!normA || !normB) return null;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
  normalizeWord,
  embedWord,
  getTargetEmbedding,
  cosineSim,
};
