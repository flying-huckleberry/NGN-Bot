// src/services/semantic/logic.js
// Shared helpers for the semantic word game.
function normalizeWord(word) {
  return String(word || '').trim().toLowerCase();
}

module.exports = {
  normalizeWord,
};
