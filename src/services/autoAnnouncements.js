// src/services/autoAnnouncements.js
const { loadAccountAnnouncements } = require('../state/autoAnnouncements');
const { loadAccountRuntime, saveAccountRuntime } = require('../state/accountRuntime');
const { loadAccountSettings, updateAccountSettings } = require('../state/accountSettings');
const { logger } = require('../utils/logger');

const FAILURE_LIMIT = 2;
const FALLBACK_CHECK_MS = 30000;

function normalizeName(raw) {
  return String(raw || '').trim().toLowerCase();
}

function createAutoAnnouncementsManager({ sendChatMessage, onTransportDown }) {
  const schedules = new Map();

  function stop(accountId) {
    const state = schedules.get(accountId);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    schedules.delete(accountId);
  }

  function resetFailures(accountId) {
    const state = schedules.get(accountId);
    if (!state) return;
    state.messageState.forEach((item) => {
      item.failCount = 0;
    });
  }

  function scheduleNext(accountId, delayMs) {
    const state = schedules.get(accountId);
    if (!state) return;
    if (state.timer) clearTimeout(state.timer);
    const nextDelay = Number.isFinite(delayMs) && delayMs > 0 ? delayMs : FALLBACK_CHECK_MS;
    state.timer = setTimeout(() => tick(accountId), nextDelay);
  }

  function ensureState(accountId) {
    if (schedules.has(accountId)) return schedules.get(accountId);
    const state = {
      messageState: new Map(),
      timer: null,
    };
    schedules.set(accountId, state);
    return state;
  }

  async function handleFailure(accountId, reason) {
    const runtime = loadAccountRuntime(accountId);
    runtime.liveChatId = null;
    runtime.nextPageToken = null;
    runtime.primed = false;
    runtime.youtubeChannelId = null;
    runtime.resolvedMethod = null;
    runtime.targetInfo = {};
    runtime.autoAnnouncementsPaused = true;
    runtime.autoAnnouncementsPausedAt = new Date().toISOString();
    runtime.autoAnnouncementsPausedReason = reason || 'Auto announcements paused due to send failures.';
    saveAccountRuntime(accountId, runtime);

    updateAccountSettings(accountId, {
      youtube: { enabled: false },
    });

    stop(accountId);
    if (typeof onTransportDown === 'function') {
      await onTransportDown(accountId, reason);
    }
  }

  async function tick(accountId) {
    const state = schedules.get(accountId);
    if (!state) return;

    const settings = loadAccountSettings(accountId);
    const runtime = loadAccountRuntime(accountId);

    if (settings.youtube?.enabled === false || !runtime.liveChatId) {
      stop(accountId);
      return;
    }

    const announcements = loadAccountAnnouncements(accountId).filter(
      (item) => item && item.enabled !== false
    );

    if (!announcements.length) {
      stop(accountId);
      return;
    }

    const now = Date.now();
    let nextRunAt = null;

    for (const item of announcements) {
      const key = normalizeName(item.name);
      if (!key) continue;
      const intervalMs = Math.max(1, Number(item.intervalSeconds) || 0) * 1000;
      let stateEntry = state.messageState.get(key);
      if (!stateEntry) {
        stateEntry = {
          nextRunAt: now + intervalMs,
          failCount: 0,
          intervalMs,
        };
        state.messageState.set(key, stateEntry);
      } else if (stateEntry.intervalMs !== intervalMs) {
        stateEntry.intervalMs = intervalMs;
        stateEntry.nextRunAt = now + intervalMs;
      }

      if (now >= stateEntry.nextRunAt) {
        try {
          await sendChatMessage(runtime.liveChatId, String(item.message || '').trim());
          stateEntry.failCount = 0;
          stateEntry.nextRunAt = now + intervalMs;
        } catch (err) {
          stateEntry.failCount += 1;
          stateEntry.nextRunAt = now + intervalMs;
          if (stateEntry.failCount >= FAILURE_LIMIT) {
            const message = err?.message || String(err);
            logger.warn(`Auto announcements paused for ${accountId}: ${message}`);
            await handleFailure(accountId, message);
            return;
          }
        }
      }

      if (nextRunAt === null || stateEntry.nextRunAt < nextRunAt) {
        nextRunAt = stateEntry.nextRunAt;
      }
    }

    const activeKeys = new Set(
      announcements.map((item) => normalizeName(item.name)).filter(Boolean)
    );
    for (const key of state.messageState.keys()) {
      if (!activeKeys.has(key)) {
        state.messageState.delete(key);
      }
    }

    const delay = nextRunAt ? Math.max(1000, nextRunAt - Date.now()) : FALLBACK_CHECK_MS;
    scheduleNext(accountId, delay);
  }

  function start(accountId) {
    if (!accountId) return;
    const state = ensureState(accountId);
    if (state.timer) return;
    scheduleNext(accountId, 1000);
  }

  function refresh(accountId) {
    if (!accountId) return;
    const settings = loadAccountSettings(accountId);
    const runtime = loadAccountRuntime(accountId);
    const announcements = loadAccountAnnouncements(accountId).filter(
      (item) => item && item.enabled !== false
    );
    if (settings.youtube?.enabled === false || !runtime.liveChatId || !announcements.length) {
      stop(accountId);
      return;
    }
    start(accountId);
  }

  function clearPausedState(accountId) {
    const runtime = loadAccountRuntime(accountId);
    if (runtime.autoAnnouncementsPaused) {
      runtime.autoAnnouncementsPaused = false;
      runtime.autoAnnouncementsPausedAt = null;
      runtime.autoAnnouncementsPausedReason = '';
      saveAccountRuntime(accountId, runtime);
    }
  }

  return {
    start,
    stop,
    refresh,
    resetFailures,
    clearPausedState,
  };
}

module.exports = { createAutoAnnouncementsManager };
