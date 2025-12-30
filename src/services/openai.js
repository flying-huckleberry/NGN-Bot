// src/services/openai.js
const OpenAI = require('openai');
const {
  OPENAI_API_KEY,
  OPENAI_MODEL,
  MAX_CHARS,
  DISCORD_MAX_CHARS,
} = require('../config/env');
const { logger } = require('../utils/logger'); 

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

const DISALLOWED_MESSAGE =
  'The topic of your message is not appropriate for a YouTube live chat. Please keep it clean, civil, and respectful.';
const DISCORD_DISALLOWED_MESSAGE =
  'The topic of your message is not appropriate for a Christian Minecraft Server. Please keep it clean, civil, and respectful.';

const SELF_HARM_MESSAGE =
  'If you are feeling unsafe or thinking about self-harm, please reach out to a trusted person or local emergency / mental health hotline. You are not alone.';

// Decide what to do based on moderation categories
// Returns: 'ok' | 'block' | 'self_harm'
async function getModerationAction(input) {
  try {
    const moderation = await openai.moderations.create({
      model: 'omni-moderation-latest',
      input,
    });

    const result = moderation.results?.[0];
    if (!result) return 'ok';

    const cat = result.categories || {};

    const isSelfHarm =
      cat['self-harm'] ||
      cat['self-harm/intent'] ||
      cat['self-harm/instructions'];

    if (isSelfHarm) {
      return 'self_harm';
    }

    const isSevereAbuse =
      cat['sexual'] ||
      cat['sexual/minors'] ||
      cat['hate'] ||
      cat['hate/threatening'] ||
      cat['harassment/threatening'] ||
      cat['violence/graphic'] ||
      cat['illicit/violent'];

    const isGeneralIllicit = cat['illicit'];

    const isGeneralViolenceOrHarassment =
      cat['violence'] || cat['harassment'];

    if (isSevereAbuse || isGeneralIllicit || isGeneralViolenceOrHarassment) {
      return 'block';
    }

    return 'ok';
  } catch (err) {
    logger.error('Moderation API error:', err);
    // Fail open: if moderation blows up, don't block everything
    return 'ok';
  }
}

async function moderateText(input) {
  const text = String(input || '').trim();
  if (!text) return 'ok';
  return getModerationAction(text);
}

/**
 * Ask OpenAI for a reply that fits into a single YouTube chat message.
 * - strict character budget
 * - small max_tokens
 * - final clamp to MAX_CHARS (by codepoints)
 */
async function askYoutube(prompt, maxChars = MAX_CHARS) {
  const targetTokens = Math.max(16, Math.min(100, Math.floor(maxChars / 4)));

  const system = `
    You are a helpful YouTube live-chat bot.
    You MUST keep the ENTIRE reply ≤ ${maxChars} characters.
    Be concise. Prefer short sentences. No preambles. No disclaimers.
    Only the answer; no code fences, line-breaks or formatting.
    CRITICAL RULE:
    If the user question contains ANY sexual content, sexual acts, porn, who had sex with whom, adult content, racism, hate speech, or sexism,
    you MUST NOT answer the question.
    In those cases, reply with EXACTLY this sentence and nothing else: "${DISALLOWED_MESSAGE}"
    Do NOT explain, do NOT partly answer, and do NOT mention this rule.

    SELF-HARM RULE:
    If the user expresses self-harm intent or asks for self-harm instructions,
    reply with: "${SELF_HARM_MESSAGE}"
  `.trimStart();


  const user = `
    HARD LIMIT: ≤ ${maxChars} characters total.
    If content seems long, compress aggressively: remove filler, use simple words.
    Unicode emojis are acceptable, but only as an afterthought, if it is wonderfully relevant; keep it short.

    Question: ${prompt}
  `.trimStart();

  try {
    // Moderation pre-check: decide what to do before calling chat
    const action = await getModerationAction(prompt);

    if (action === 'self_harm') {
      return SELF_HARM_MESSAGE;
    }
    if (action === 'block') {
      return DISALLOWED_MESSAGE;
    }

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: targetTokens,
      temperature: 0.5,
    });

    let reply = (completion.choices[0]?.message?.content || '').trim();

    // normalize whitespace → avoid line breaks / double spaces
    reply = reply.replace(/\s+/g, ' ').trim();

    // final clamp by codepoints, keep ellipsis if we truncate
    const cps = [...reply];
    if (cps.length > maxChars) {
      reply = cps.slice(0, maxChars - 1).join('') + '…';
    }

    return reply;
  } catch (err) {
    logger.error('OpenAI error:', err);
    return "Sorry, I couldn't reach the AI service.";
  }
}

async function askDiscord(prompt, maxChars = DISCORD_MAX_CHARS) {
  const targetTokens = Math.max(16, Math.min(100, Math.floor(maxChars / 4)));

  // TODO: Edit this system prompt for Discord-specific context.
  const system = `
    You are a helpful Discord chat bot.
    You MUST keep the ENTIRE reply ≤ ${maxChars} characters.
    Be concise. Prefer short sentences. No preambles. No disclaimers.
    Only the answer; no code fences, line-breaks or formatting.
    CRITICAL RULE:
    If the user question contains ANY sexual content, sexual acts, porn, who had sex with whom, adult content, racism, hate speech, or sexism,
    you MUST NOT answer the question.
    In those cases, reply with EXACTLY this sentence and nothing else: "${DISCORD_DISALLOWED_MESSAGE}"
    Do NOT explain, do NOT partly answer, and do NOT mention this rule.

    SELF-HARM RULE:
    If the user expresses self-harm intent or asks for self-harm instructions,
    reply with: "${SELF_HARM_MESSAGE}"
  `.trimStart();

  const user = `
    HARD LIMIT: ≤ ${maxChars} characters total.
    If content seems long, compress aggressively: remove filler, use simple words.
    Unicode emojis are acceptable, but only as an afterthought, if it is wonderfully relevant; keep it short.

    Question: ${prompt}
  `.trimStart();

  try {
    const action = await getModerationAction(prompt);

    if (action === 'self_harm') {
      return SELF_HARM_MESSAGE;
    }
    if (action === 'block') {
      return DISCORD_DISALLOWED_MESSAGE;
    }

    const completion = await openai.chat.completions.create({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
      max_tokens: targetTokens,
      temperature: 0.5,
    });

    let reply = (completion.choices[0]?.message?.content || '').trim();
    reply = reply.replace(/\s+/g, ' ').trim();

    const cps = [...reply];
    if (cps.length > maxChars) {
      reply = cps.slice(0, maxChars - 1).join('') + '…';
    }

    return reply;
  } catch (err) {
    logger.error('OpenAI error:', err);
    return "Sorry, I couldn't reach the AI service.";
  }
}

module.exports = {
  openai, // exported in case we need raw client access elsewhere
  askYoutube,
  askDiscord,
  getModerationAction,
  moderateText,
  DISALLOWED_MESSAGE,
  SELF_HARM_MESSAGE,
};
