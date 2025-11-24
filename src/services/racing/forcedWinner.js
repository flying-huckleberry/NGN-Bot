// src/services/racing/forcedWinner.js
// Helpers for managing "forced winner" overrides for the current race.
const { getRace, setRace } = require('./state');

function getForcedWinnerId(scopeKey) {
  const race = getRace(scopeKey);
  return race?.forcedWinnerId || null;
}

function setForcedWinnerId(scopeKey, playerId) {
  if (!playerId) return false;
  const race = getRace(scopeKey);
  if (!race) return false;
  race.forcedWinnerId = playerId;
  setRace(scopeKey, race);
  return true;
}

function clearForcedWinnerId(scopeKey) {
  const race = getRace(scopeKey);
  if (!race) return false;
  if (!race.forcedWinnerId) return true;
  race.forcedWinnerId = null;
  setRace(scopeKey, race);
  return true;
}

function applyForcedWinner(ranked, casualties, forcedWinnerId) {
  if (!forcedWinnerId) return { ranked, casualties };

  const idx = ranked.findIndex((p) => p.id === forcedWinnerId);
  if (idx === -1) {
    return { ranked, casualties };
  }

  const forced = {
    ...ranked[idx],
    dnf: false,
    dnfReason: null,
    failedComponent: null,
  };

  const newRanked = ranked.slice();
  newRanked.splice(idx, 1);
  newRanked.unshift(forced);

  const newCasualties = (casualties || []).filter((c) => c.id !== forced.id);

  return { ranked: newRanked, casualties: newCasualties };
}

module.exports = {
  getForcedWinnerId,
  setForcedWinnerId,
  clearForcedWinnerId,
  applyForcedWinner,
};
