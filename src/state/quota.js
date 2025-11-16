// src/state/quota.js
// Tracks an approximate YouTube quota usage for the current PT day.

const fs = require('fs');
const path = require('path');
const { ROOT_DIR } = require('../config/env');

const DAILY_LIMIT = Number(process.env.YT_DAILY_QUOTA || 10000); // default 10k units
const STATE_PATH = path.join(ROOT_DIR, 'quota_state.json');

// Get today's date in Pacific time as YYYY-MM-DD
function getTodayPacificDateKey() {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = fmt.formatToParts(now);
  const y = parts.find((p) => p.type === 'year').value;
  const m = parts.find((p) => p.type === 'month').value;
  const d = parts.find((p) => p.type === 'day').value;
  return `${y}-${m}-${d}`; // e.g. 2025-11-16
}

function loadRawState() {
  const today = getTodayPacificDateKey();

  if (!fs.existsSync(STATE_PATH)) {
    return { lastResetPst: today, used: 0 };
  }

  try {
    const text = fs.readFileSync(STATE_PATH, 'utf8');
    const parsed = JSON.parse(text);

    // If the recorded day is not today, reset usage.
    if (!parsed.lastResetPst || parsed.lastResetPst !== today) {
      return { lastResetPst: today, used: 0 };
    }

    return {
      lastResetPst: parsed.lastResetPst || today,
      used: Number(parsed.used || 0),
    };
  } catch {
    // On any parse error, start fresh for today
    return { lastResetPst: today, used: 0 };
  }
}

function saveRawState(state) {
  try {
    fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2), 'utf8');
  } catch (err) {
    // Quota tracking is best-effort only; don't crash the bot.
    // You can log this if you want.
  }
}

// Public: returns normalized info for UI
function getQuotaInfo() {
  const state = loadRawState();
  const used = Math.max(0, Number(state.used || 0));
  const limit = DAILY_LIMIT;
  const remaining = Math.max(0, limit - used);
  const percentUsed =
    limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;

  return {
    dailyLimit: limit,
    used,
    remaining,
    percentUsed,
    lastResetPst: state.lastResetPst,
  };
}

// Public: add units to today's tally and return updated info
function addQuotaUsage(units) {
  const delta = Number(units || 0);
  if (!Number.isFinite(delta) || delta <= 0) {
    return getQuotaInfo();
  }

  const state = loadRawState();
  state.used = Math.max(0, Number(state.used || 0) + delta);
  saveRawState(state);
  return getQuotaInfo();
}

// Optional: manual reset (e.g. test button)
function resetQuotaToday() {
  const today = getTodayPacificDateKey();
  const state = { lastResetPst: today, used: 0 };
  saveRawState(state);
  return getQuotaInfo();
}

module.exports = {
  DAILY_LIMIT,
  getQuotaInfo,
  addQuotaUsage,
  resetQuotaToday,
};
