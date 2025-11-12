// src/commands/hello.js
const { sendChatMessage } = require('../services/youtube');

module.exports = async function hello({ liveChatId, msg }) {
  await sendChatMessage(liveChatId, 'Hello, world!');
  console.log(`↩︎ !hello from ${msg.authorDetails?.displayName}`);
};
