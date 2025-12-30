const { getAccountById } = require('../../state/accountsRepo');
const { loadAccountSettings, updateAccountSettings } = require('../../state/accountSettings');
const { respondModuleEdit, parseCsv, parseNumber, wantsJson } = require('./helpers');
const { geocodeLocation } = require('../../services/weather');

function createModulesController({ app, moduleNames }) {
  return {
    async getModule(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const moduleSlug = String(req.params.module || '').toLowerCase();
      const moduleName =
        moduleNames.find((name) => name.toLowerCase() === moduleSlug) || null;
      if (!moduleName) {
        return res.status(404).send('Module not found.');
      }
      const settings = loadAccountSettings(account.id);
      return respondModuleEdit(app, req, res, {
        title: `Edit ${moduleName} - ${account.name}`,
        active: 'accounts',
        account,
        moduleName,
        settings,
        message: null,
        error: null,
      });
    },

    // Module-specific settings editing (racing/crypto).
    async updateModule(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).send('Account not found.');
      }
      const moduleSlug = String(req.params.module || '').toLowerCase();
      const moduleName =
        moduleNames.find((name) => name.toLowerCase() === moduleSlug) || null;
      if (!moduleName) {
        return res.status(404).send('Module not found.');
      }
      const moduleKey = moduleName.toLowerCase();

      try {
        if (moduleKey === 'racing') {
          const racingChannelId = String(req.body?.discordRacingChannelId || '').trim();
          const raceCooldownMs = parseNumber(req.body?.raceCooldownMs);
          const raceJoinWindowMs = parseNumber(req.body?.raceJoinWindowMs);
          updateAccountSettings(account.id, {
            discord: { racingChannelId },
            race: {
              cooldownMs: raceCooldownMs,
              joinWindowMs: raceJoinWindowMs,
            },
          });
        } else if (moduleKey === 'crypto') {
          const cryptoAllowedCoins = parseCsv(req.body?.cryptoAllowedCoins || '');
          const cryptoStartingCash = parseNumber(req.body?.cryptoStartingCash);
          const cryptoTtlMs = parseNumber(req.body?.cryptoTtlMs);
          updateAccountSettings(account.id, {
            crypto: {
              allowedCoins: cryptoAllowedCoins,
              startingCash: cryptoStartingCash,
              coingeckoTtlMs: cryptoTtlMs,
            },
          });
        } else if (moduleKey === 'weather') {
          // Weather settings are per account and used by template variables.
          // We store raw decimal coordinates and unit tokens for OpenMeteo.
          const latitudeRaw = String(req.body?.weatherLatitude || '').trim();
          const longitudeRaw = String(req.body?.weatherLongitude || '').trim();
          const locationLabel = String(req.body?.weatherLocationLabel || '').trim();
          const temperatureUnit = String(req.body?.weatherTemperatureUnit || '').trim();
          const windSpeedUnit = String(req.body?.weatherWindSpeedUnit || '').trim();
          const precipitationUnit = String(req.body?.weatherPrecipitationUnit || '').trim();

          // Allow blank values to disable weather without validation errors.
          const latitude = latitudeRaw === '' ? '' : parseNumber(latitudeRaw);
          const longitude = longitudeRaw === '' ? '' : parseNumber(longitudeRaw);

          // Validate decimals when provided.
          if (latitudeRaw !== '' && latitude === null) {
            throw new Error('Latitude must be a decimal number.');
          }
          if (longitudeRaw !== '' && longitude === null) {
            throw new Error('Longitude must be a decimal number.');
          }

          updateAccountSettings(account.id, {
            weather: {
              latitude: latitudeRaw === '' ? '' : String(latitude),
              longitude: longitudeRaw === '' ? '' : String(longitude),
              locationLabel,
              temperatureUnit,
              windSpeedUnit,
              precipitationUnit,
            },
          });
        } else {
          throw new Error('This module does not have editable settings yet.');
        }

        const settings = loadAccountSettings(account.id);
        return respondModuleEdit(app, req, res, {
          title: `Edit ${moduleName} - ${account.name}`,
          active: 'accounts',
          account,
          moduleName,
          settings,
          message: `${moduleName.charAt(0).toUpperCase() + moduleName.slice(1)} settings saved.`,
          error: null,
        });
      } catch (err) {
        const settings = loadAccountSettings(account.id);
        if (wantsJson(req)) {
          return respondModuleEdit(app, req, res, {
            title: `Edit ${moduleName} - ${account.name}`,
            active: 'accounts',
            account,
            moduleName,
            settings,
            message: null,
            error: err.message || String(err),
          });
        }
        return res.status(400).render('modules/index', {
          title: `Edit ${moduleName} - ${account.name}`,
          active: 'accounts',
          account,
          moduleName,
          settings,
          message: null,
          error: err.message || String(err),
        });
      }
    },

    async geocodeWeather(req, res) {
      const account = getAccountById(req.params.id);
      if (!account) {
        return res.status(404).json({ error: 'Account not found.' });
      }
      const moduleSlug = String(req.params.module || '').toLowerCase();
      if (moduleSlug !== 'weather') {
        return res.status(404).json({ error: 'Module not found.' });
      }
      const query = String(req.query?.q || '').trim();
      if (!query) {
        return res.json({ results: [] });
      }
      try {
        const results = await geocodeLocation(query);
        return res.json({ results });
      } catch (err) {
        return res.status(500).json({ error: err.message || String(err) });
      }
    },
  };
}

module.exports = { createModulesController };
