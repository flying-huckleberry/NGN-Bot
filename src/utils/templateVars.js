// src/utils/templateVars.js
const { getQuotaInfo } = require('../state/quota');
const { getWeatherSnapshot } = require('../services/weather');

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

function formatLocalTime(timezone) {
  const now = new Date();
  const options = {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  };
  if (timezone) {
    options.timeZone = timezone;
  }
  return now.toLocaleString('en-US', options);
}

async function buildTemplateValues({ sender, accountRuntime, quotaInfo, accountId, accountSettings }) {
  const targetInfo = accountRuntime?.targetInfo || {};
  const channelName =
    targetInfo.channelName ||
    targetInfo.channelTitle ||
    '';
  const liveTitle = targetInfo.title || '';
  const streamStartAt = targetInfo.streamStartAt || null;
  const quota = quotaInfo || getQuotaInfo();
  const timezone = accountSettings?.timezone || '';

  let weather = null;
  try {
    weather = await getWeatherSnapshot({
      accountId,
      settings: accountSettings?.weather || {},
      disabledModules: accountSettings?.disabledModules || [],
    });
  } catch {
    weather = null;
  }

  const weatherTemp = weather?.temperature;
  const weatherWindSpeed = weather?.windSpeed;
  const weatherWindDirection = weather?.windDirection;
  const weatherPrecipitation = weather?.precipitation;
  const weatherIsDayRaw = weather?.isDay;
  const weatherUnits = weather?.units || {};

  return {
    sender: sender || '',
    channel_name: channelName || 'unknown',
    live_title: liveTitle || 'unknown',
    live_uptime: formatLiveUptime(streamStartAt),
    quota_percent: Number.isFinite(quota?.percentUsed)
      ? `${quota.percentUsed}%`
      : 'unknown',
    time_local: formatLocalTime(timezone),
    weather_temp: Number.isFinite(weatherTemp)
      ? `${weatherTemp}${weatherUnits.temperature || ''}`
      : 'unknown',
    weather_wind_speed: Number.isFinite(weatherWindSpeed)
      ? `${weatherWindSpeed} ${weatherUnits.wind || ''}`.trim()
      : 'unknown',
    weather_wind_dir: weatherWindDirection || 'unknown',
    weather_precip: Number.isFinite(weatherPrecipitation)
      ? `${weatherPrecipitation} ${weatherUnits.precipitation || ''}`.trim()
      : 'unknown',
    weather_is_day: weatherIsDayRaw === 1
      ? 'daytime'
      : weatherIsDayRaw === 0
        ? 'nighttime'
        : 'unknown',
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
