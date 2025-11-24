// src/services/racing/transfer.js
// Helper for player-to-player cash transfers in racing.
const { ensurePlayer, getPlayer, updatePlayerCash } = require('./state');

/**
 * Attempt to transfer cash from one player to another.
 * Returns a result object with status and relevant data:
 * - ok: { status: 'ok', sender, recipient, amount }
 * - missing_recipient: recipient not found
 * - insufficient: sender doesn't have enough cash (includes senderCash)
 * - self: sender and recipient are the same
 * - invalid_amount: amount <= 0 or NaN
 */
function transferCash(scopeKey, senderId, senderName, recipientId, amount) {
  const amountInt = Number.parseInt(amount, 10);
  if (!Number.isFinite(amountInt) || amountInt <= 0) {
    return { status: 'invalid_amount' };
  }

  const sender = ensurePlayer(scopeKey, senderId, senderName);

  // Prevent self-transfers
  if (recipientId === sender.id) {
    return { status: 'self' };
  }

  const recipient = getPlayer(scopeKey, recipientId);
  if (!recipient) {
    return { status: 'missing_recipient' };
  }

  const senderCash = sender.cash || 0;
  if (amountInt > senderCash) {
    return { status: 'insufficient', senderCash, amount: amountInt };
  }

  updatePlayerCash(scopeKey, sender.id, -amountInt);
  updatePlayerCash(scopeKey, recipient.id, amountInt);

  return { status: 'ok', sender, recipient, amount: amountInt };
}

module.exports = {
  transferCash,
};
