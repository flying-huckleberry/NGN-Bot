// src/commands/ask.js
const { askGPTBounded } = require('../services/openai');
const { sendChatMessage } = require('../services/youtube');
const { MAX_CHARS } = require('../config/env');

module.exports = async function ask({ liveChatId, args }) {
  const question = args.join(' ').trim();
  if (!question) {
    await sendChatMessage(liveChatId, 'Usage: !ask <your question>');
    return;
  }

  let reply = await askGPTBounded(question, MAX_CHARS);

  // normalize whitespace and clamp hard (no ellipsis)
  reply = reply.replace(/\s+/g, ' ').trim();
  const cps = [...reply];
  if (cps.length > MAX_CHARS) reply = cps.slice(0, MAX_CHARS).join('');
  if (!reply) reply = 'NO REPLY FROM AI!';

  await sendChatMessage(liveChatId, reply);
  console.log(`🧠 !ask → ${reply}`);
};
