// src/core/loader.js
// auto-loads module manifests from src/modules/*/module.js

const fs = require('fs');
const path = require('path');
function loadModules(modulesDir) {
  const modules = {};
  const flat = new Map();

  for (const dir of fs.readdirSync(modulesDir)) {
    const modPath = path.join(modulesDir, dir, 'module.js');
    if (!fs.existsSync(modPath)) continue;
    // eslint-disable-next-line import/no-dynamic-require
    const manifest = require(modPath);
    if (!manifest?.name || !manifest?.commands) continue;

    modules[manifest.name] = manifest;

    // build flat registry (aliases included)
    for (const [name, def] of Object.entries(manifest.commands)) {
      flat.set(name, { mod: manifest, def });
      (def.aliases || []).forEach((alias) => flat.set(alias, { mod: manifest, def }));
    }
  }

  return { modules, flat };
}

module.exports = { loadModules };
