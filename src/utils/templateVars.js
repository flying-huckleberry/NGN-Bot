// src/utils/templateVars.js
const { getQuotaInfo } = require('../state/quota');

function formatLiveUptime(streamStartAt) {
  if (!streamStartAt) return 'unknown';
  const startMs = Date.parse(streamStartAt);
  if (!Number.isFinite(startMs)) return 'unknown';
  const diffMs = Date.now() - startMs;
  if (!Number.isFinite(diffMs) || diffMs < 0) return 'unknown';
  const totalMinutes = Math.max(0, Math.round(diffMs / 60000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    const hourLabel = hours === 1 ? 'hour' : 'hours';
    const minuteLabel = minutes === 1 ? 'minute' : 'minutes';
    return `${hours} ${hourLabel}, ${minutes} ${minuteLabel}`;
  }
  const minuteLabel = minutes === 1 ? 'minute' : 'minutes';
  return `${minutes} ${minuteLabel}`;
}

function formatLocalTime() {
  const now = new Date();
  return now.toLocaleString('en-US', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function buildTemplateValues({ sender, accountRuntime, quotaInfo }) {
  const targetInfo = accountRuntime?.targetInfo || {};
  const channelName =
    targetInfo.channelName ||
    targetInfo.channelTitle ||
    '';
  const liveTitle = targetInfo.title || '';
  const streamStartAt = targetInfo.streamStartAt || null;
  const quota = quotaInfo || getQuotaInfo();

  return {
    sender: sender || '',
    channel_name: channelName || 'unknown',
    live_title: liveTitle || 'unknown',
    live_uptime: formatLiveUptime(streamStartAt),
    quota_percent: Number.isFinite(quota?.percentUsed)
      ? `${quota.percentUsed}%`
      : 'unknown',
    time_local: formatLocalTime(),
  };
}

function renderTemplate(text, values) {
  const input = String(text ?? '');
  return input.replace(/\{([a-z_]+)\}/gi, (match, key) => {
    const lower = String(key || '').toLowerCase();
    if (!Object.prototype.hasOwnProperty.call(values, lower)) {
      return match;
    }
    return String(values[lower] ?? '');
  });
}

module.exports = {
  buildTemplateValues,
  renderTemplate,
  formatLiveUptime,
  formatLocalTime,
};
