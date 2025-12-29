// src/services/autoAnnouncements.js
const { loadAccountAnnouncements, updateAnnouncementLastSent } = require('../state/autoAnnouncements');
const { buildTemplateValues, renderTemplate } = require('../utils/templateVars');
const { loadAccountRuntime, saveAccountRuntime } = require('../state/accountRuntime');
const { loadAccountSettings, updateAccountSettings } = require('../state/accountSettings');
const { logger } = require('../utils/logger');

const FAILURE_LIMIT = 2;
const FALLBACK_CHECK_MS = 30000;

  function normalizeId(raw) {
    return String(raw || '').trim();
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
      const key = normalizeId(item.id);
      if (!key) continue;
      const intervalMs = Math.max(1, Number(item.intervalSeconds) || 0) * 1000;
      let stateEntry = state.messageState.get(key);
      if (!stateEntry) {
        // Bootstrap per-message schedule using the persisted lastSentAt value.
        // This prevents a flood after restarts because each message resumes
        // from its prior cadence instead of firing immediately.
        const lastSentAt = item.lastSentAt ? Date.parse(item.lastSentAt) : null;
        let nextRunAt = now + intervalMs;
        if (Number.isFinite(lastSentAt)) {
          // If the stored cadence is still in the future, use it as-is.
          // If it is in the past, schedule the next full interval from now.
          const candidate = lastSentAt + intervalMs;
          nextRunAt = candidate > now ? candidate : now + intervalMs;
        }
        stateEntry = {
          nextRunAt,
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
          logger.info('Auto announcement send attempt.', {
            accountId,
            name: item.name,
            intervalSeconds: item.intervalSeconds,
          });
          const values = buildTemplateValues({
            mention: '',
            accountRuntime: runtime,
          });
          const rendered = renderTemplate(String(item.message || '').trim(), values);
          await sendChatMessage(runtime.liveChatId, rendered);
          stateEntry.failCount = 0;
          stateEntry.nextRunAt = now + intervalMs;
          // Persist lastSentAt so timing survives server restarts and
          // transport toggles without bunching all messages together.
          updateAnnouncementLastSent(accountId, item.id, new Date().toISOString());
          logger.info('Auto announcement sent.', {
            accountId,
            name: item.name,
            nextRunAt: new Date(stateEntry.nextRunAt).toISOString(),
          });
        } catch (err) {
          stateEntry.failCount += 1;
          stateEntry.nextRunAt = now + intervalMs;
          logger.error('Auto announcement send failed.', {
            accountId,
            name: item.name,
            failCount: stateEntry.failCount,
            error: err?.message || String(err),
          });
          if (stateEntry.failCount >= FAILURE_LIMIT) {
            const message = err?.message || String(err);
            logger.warn('Auto announcements paused after repeated failures.', {
              accountId,
              name: item.name,
              failCount: stateEntry.failCount,
              reason: message,
            });
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
      announcements.map((item) => normalizeId(item.id)).filter(Boolean)
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
