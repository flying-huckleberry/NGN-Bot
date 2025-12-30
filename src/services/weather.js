// src/services/weather.js
// Weather caching + formatting for template variables.
// Stores a per-account snapshot on disk so commands don't hit the API every time.
const fs = require('fs');
const { ensureAccountDir, getAccountFilePath } = require('../state/accountPaths');

const CACHE_FILE = 'weather_cache.json';
const CACHE_TTL_MS = 30 * 60 * 1000;
const GEOCODE_TTL_MS = 30 * 60 * 1000;
const geocodeCache = new Map();

function normalizeNumber(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    return null;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeUnit(value) {
  const trimmed = String(value || '').trim();
  return trimmed;
}

function readCache(accountId) {
  // Cached payload shape: { fetchedAt: <ms>, data: { ...snapshot } }
  ensureAccountDir(accountId);
  const path = getAccountFilePath(accountId, CACHE_FILE);
  if (!fs.existsSync(path)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(path, 'utf8'));
    return raw && typeof raw === 'object' ? raw : null;
  } catch {
    return null;
  }
}

function writeCache(accountId, payload) {
  // Best-effort cache write; failure should not block message rendering.
  ensureAccountDir(accountId);
  const path = getAccountFilePath(accountId, CACHE_FILE);
  fs.writeFileSync(path, JSON.stringify(payload, null, 2), 'utf8');
}

function isFresh(cache) {
  // Cache is valid for 30 minutes.
  if (!cache || !cache.fetchedAt) return false;
  const ts = Number(cache.fetchedAt);
  if (!Number.isFinite(ts)) return false;
  return Date.now() - ts <= CACHE_TTL_MS;
}

function formatDirection(deg) {
  // Convert degrees to 16-point compass direction.
  if (!Number.isFinite(deg)) return 'unknown';
  const directions = [
    'N', 'NNE', 'NE', 'ENE',
    'E', 'ESE', 'SE', 'SSE',
    'S', 'SSW', 'SW', 'WSW',
    'W', 'WNW', 'NW', 'NNW',
  ];
  const index = Math.round(((deg % 360) / 22.5)) % 16;
  return directions[index];
}

function formatUnits(settings) {
  // Map OpenMeteo unit tokens to display suffixes.
  const tempUnit = normalizeUnit(settings?.temperatureUnit);
  const windUnit = normalizeUnit(settings?.windSpeedUnit);
  const precipUnit = normalizeUnit(settings?.precipitationUnit);

  return {
    temperature: tempUnit === 'fahrenheit' ? '°F' : '°C',
    wind: windUnit === 'mph'
      ? 'mph'
      : windUnit === 'ms'
        ? 'm/s'
        : windUnit === 'kn'
          ? 'kn'
          : 'km/h',
    precipitation: precipUnit === 'inch' ? 'in' : 'mm',
  };
}

async function geocodeLocation(query) {
  // Simple geocoding wrapper for city/state/country lookup.
  const term = String(query || '').trim();
  if (!term) return [];

  const cached = geocodeCache.get(term.toLowerCase());
  if (cached && Date.now() - cached.fetchedAt <= GEOCODE_TTL_MS) {
    return cached.results || [];
  }

  const url = new URL('https://geocoding-api.open-meteo.com/v1/search');
  url.searchParams.set('name', term);
  url.searchParams.set('count', '5');
  url.searchParams.set('language', 'en');
  url.searchParams.set('format', 'json');

  const res = await fetch(url.toString());
  if (!res.ok) {
    throw new Error(`Geocoding failed (${res.status})`);
  }
  const json = await res.json();
  const results = Array.isArray(json?.results)
    ? json.results.map((item) => ({
      name: item.name || '',
      admin1: item.admin1 || '',
      country: item.country || '',
      latitude: item.latitude,
      longitude: item.longitude,
      timezone: item.timezone || '',
    }))
    : [];

  geocodeCache.set(term.toLowerCase(), {
    fetchedAt: Date.now(),
    results,
  });

  return results;
}

async function fetchWeather({ latitude, longitude, settings }) {
  // OpenMeteo call for "current" only. Units are configurable per account.
  const url = 'https://api.open-meteo.com/v1/forecast';
  const params = new URLSearchParams();
  params.set('latitude', String(latitude));
  params.set('longitude', String(longitude));
  params.set('current', [
    'temperature_2m',
    'is_day',
    'wind_speed_10m',
    'wind_direction_10m',
    'precipitation',
  ].join(','));
  params.set('forecast_days', '1');
  params.set('timezone', 'auto');

  const tempUnit = normalizeUnit(settings?.temperatureUnit);
  const windUnit = normalizeUnit(settings?.windSpeedUnit);
  const precipUnit = normalizeUnit(settings?.precipitationUnit);

  if (tempUnit) params.set('temperature_unit', tempUnit);
  if (windUnit) params.set('wind_speed_unit', windUnit);
  if (precipUnit) params.set('precipitation_unit', precipUnit);

  const res = await fetch(`${url}?${params.toString()}`);
  if (!res.ok) {
    throw new Error(`Weather API failed (${res.status})`);
  }
  return res.json();
}

async function getWeatherSnapshot({ accountId, settings, disabledModules }) {
  // Returns a normalized snapshot for template variables or null if disabled.
  if (!accountId) return null;
  if (Array.isArray(disabledModules) &&
    disabledModules.some((name) => String(name || '').toLowerCase() === 'weather')) {
    return null;
  }

  const latitude = normalizeNumber(settings?.latitude);
  const longitude = normalizeNumber(settings?.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return null;
  }

  const cache = readCache(accountId);
  if (isFresh(cache)) {
    return cache.data || null;
  }

  const json = await fetchWeather({ latitude, longitude, settings });
  const current = json?.current || {};
  const units = formatUnits(settings);
  const snapshot = {
    temperature: Number.isFinite(current.temperature_2m) ? current.temperature_2m : null,
    windSpeed: Number.isFinite(current.wind_speed_10m) ? current.wind_speed_10m : null,
    windDirection: Number.isFinite(current.wind_direction_10m)
      ? formatDirection(current.wind_direction_10m)
      : 'unknown',
    precipitation: Number.isFinite(current.precipitation) ? current.precipitation : null,
    isDay: Number.isFinite(current.is_day) ? current.is_day : null,
    units,
  };

  writeCache(accountId, { fetchedAt: Date.now(), data: snapshot });
  return snapshot;
}

module.exports = {
  getWeatherSnapshot,
  formatDirection,
  geocodeLocation,
};
