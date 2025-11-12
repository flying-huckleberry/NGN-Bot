// src/services/openai.js
const OpenAI = require('openai');
const { OPENAI_API_KEY, OPENAI_MODEL, MAX_CHARS } = require('../config/env');

const openai = new OpenAI({ apiKey: OPENAI_API_KEY });

// simple helper (kept for parity with your current code)
async function askGPT(prompt) {
  try {
    const completion = await openai.chat.completions.create({
      model: 'gpt-4o-mini', // leave as-is; you can swap to OPENAI_MODEL if desired
      messages: [
        { role: 'system', content: 'You are a friendly chatbot in a YouTube live chat.' },
        { role: 'user', content: prompt },
      ],
      max_tokens: 80,
    });
    return completion.choices[0].message.content.trim();
  } catch (err) {
    console.error('OpenAI error:', err);
    return "Sorry, I couldn't reach the AI service right now.";
  }
}

/**
 * Ask OpenAI for a reply that fits into a single YouTube chat message.
 * - strict character budget
 * - small max_tokens
 * - final clamp to MAX_CHARS
 */
async function askGPTBounded(prompt, maxChars = MAX_CHARS) {
  const targetTokens = Math.max(16, Math.min(100, Math.floor(maxChars / 4)));

  const system = [
    'You are a helpful YouTube live-chat bot.',
    `You MUST keep the ENTIRE reply ≤ ${maxChars} characters.`,
    'Be concise. Prefer short sentences. No preambles. No disclaimers.',
    'Only the answer; no code fences, line-breaks or formatting.',
  ].join(' ');

  const user = [
    `HARD LIMIT: ≤ ${maxChars} characters total.`,
    'If content seems long, compress aggressively: remove filler, use simple words.',
    'Unicode emojis are acceptable, but only as an afterthought, if it is wonderfully relevant; keep it short.',
    '',
    `Question: ${prompt}`,
  ].join('\n');

  try {
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
    if (reply.length > maxChars) reply = reply.slice(0, maxChars - 1) + '…';
    return reply;
  } catch (err) {
    console.error('OpenAI error:', err);
    return "Sorry, I couldn't reach the AI service.";
  }
}

module.exports = {
  openai, // exported in case you want raw client access elsewhere
  askGPT,
  askGPTBounded,
};
