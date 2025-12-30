// src/modules/weather/module.js
const { getWeatherSnapshot } = require('../../services/weather');

function buildSummary(snapshot) {
  const temp = Number.isFinite(snapshot.temperature)
    ? `${snapshot.temperature}${snapshot.units.temperature || ''}`
    : 'unknown';
  const wind = Number.isFinite(snapshot.windSpeed)
    ? `${snapshot.windSpeed} ${snapshot.units.wind || ''}`.trim()
    : 'unknown';
  const precip = Number.isFinite(snapshot.precipitation)
    ? `${snapshot.precipitation} ${snapshot.units.precipitation || ''}`.trim()
    : 'unknown';
  const day =
    snapshot.isDay === 1
      ? 'daytime'
      : snapshot.isDay === 0
        ? 'nighttime'
        : 'unknown';

  return `Temp: ${temp} | Wind: ${wind} ${snapshot.windDirection || ''} | Precip: ${precip} | ${day}`;
}

async function loadSnapshot(ctx) {
  return getWeatherSnapshot({
    accountId: ctx.accountId,
    settings: ctx.accountSettings?.weather || {},
    disabledModules: ctx.accountSettings?.disabledModules || [],
  });
}

module.exports = {
  name: 'weather',
  description: 'Weather commands.',
  commands: {
    weather: {
      name: 'weather',
      description: 'Current weather summary.',
      async run(ctx) {
        const snapshot = await loadSnapshot(ctx);
        if (!snapshot) {
          return ctx.reply('Weather unavailable.');
        }
        return ctx.reply(buildSummary(snapshot));
      },
    },
    temp: {
      name: 'temp',
      description: 'Current temperature.',
      async run(ctx) {
        const snapshot = await loadSnapshot(ctx);
        if (!snapshot) {
          return ctx.reply('Weather unavailable.');
        }
        const temp = Number.isFinite(snapshot.temperature)
          ? `${snapshot.temperature}${snapshot.units.temperature || ''}`
          : 'unknown';
        return ctx.reply(`Temp: ${temp}`);
      },
    },
    wind: {
      name: 'wind',
      description: 'Current wind speed and direction.',
      async run(ctx) {
        const snapshot = await loadSnapshot(ctx);
        if (!snapshot) {
          return ctx.reply('Weather unavailable.');
        }
        const speed = Number.isFinite(snapshot.windSpeed)
          ? `${snapshot.windSpeed} ${snapshot.units.wind || ''}`.trim()
          : 'unknown';
        const dir = snapshot.windDirection || 'unknown';
        return ctx.reply(`Wind: ${speed} ${dir}`);
      },
    },
    precip: {
      name: 'precip',
      description: 'Current precipitation.',
      async run(ctx) {
        const snapshot = await loadSnapshot(ctx);
        if (!snapshot) {
          return ctx.reply('Weather unavailable.');
        }
        const precip = Number.isFinite(snapshot.precipitation)
          ? `${snapshot.precipitation} ${snapshot.units.precipitation || ''}`.trim()
          : 'unknown';
        return ctx.reply(`Precip: ${precip}`);
      },
    },
    day: {
      name: 'day',
      description: 'Daytime or nighttime.',
      async run(ctx) {
        const snapshot = await loadSnapshot(ctx);
        if (!snapshot) {
          return ctx.reply('Weather unavailable.');
        }
        const day =
          snapshot.isDay === 1
            ? 'daytime'
            : snapshot.isDay === 0
              ? 'nighttime'
              : 'unknown';
        return ctx.reply(day);
      },
    },
  },
};
