// src/modules/core/module.js
const { adminOnly } = require('../../utils/permissions');
const logCommand = require('../../utils/logCommand');
const partsConfig = require('../../services/racing/parts');
const {
  loadAccountSettings,
  updateAccountSettings,
} = require('../../state/accountSettings');

function formatRacingPartTypes() {
  const keys = Object.keys(partsConfig || {});
  const pretty = keys.map((key) => {
    switch (key.toLowerCase()) {
      case 'carbonfiber':
        return 'CarbonFiber';
      default:
        return key.charAt(0).toUpperCase() + key.slice(1);
    }
  });
  return pretty.join(', ');
}

function isModuleDisabledForPlatform(ctx, moduleName) {
  const key = String(moduleName || '').toLowerCase();
  const settings = ctx.accountSettings || {};
  const global = (settings.disabledModules || []).map((n) => String(n || '').toLowerCase());
  if (global.includes(key)) return true;
  const per = settings.disabledModulesByPlatform || {};
  const platformKey = ctx.platform === 'discord' ? 'discord' : 'youtube';
  const list = (per[platformKey] || []).map((n) => String(n || '').toLowerCase());
  return list.includes(key);
}

function isModuleGloballyDisabled(settings, moduleName) {
  const key = String(moduleName || '').toLowerCase();
  const global = (settings?.disabledModules || []).map((n) => String(n || '').toLowerCase());
  return global.includes(key);
}

module.exports = {
  name: 'core',
  description: 'Core utility commands.',
  middleware: [logCommand],
  commands: {
    help: {
      name: 'help',
      description: 'List modules or commands.',
      usage: 'help [module] [command]',
      async run(ctx) {
        const { registry } = ctx.services;
        const args = ctx.args || [];
        const [rawM, rawC] = args;
        const m = rawM && rawM.toLowerCase();
        const c = rawC && rawC.toLowerCase();
        const isDisabled = (name) => isModuleDisabledForPlatform(ctx, name);

        // generic help, no specific module
        if (!m) {
          const list = Object.values(registry.modules || {})
            .filter((mod) => !isDisabled(mod.name))
            .map((mod) => mod.name);
          return ctx.reply(`Modules: ${list.join(' | ')}`);
        }

        const mod = registry.modules[m];
        const disabledMod = mod ? isDisabled(mod.name) : false;

        // If there's no such module and no second arg, treat m as a COMMAND name
        if (!mod && !c) {
          const cmdToken = m;
          const matches = [];

          for (const [modName, module] of Object.entries(registry.modules)) {
            if (isDisabled(modName)) continue;
            const commands = module.commands || {};
            for (const [cmdName, def] of Object.entries(commands)) {
              const cmdLower = cmdName.toLowerCase();
              const aliases = (def.aliases || []).map((a) => a.toLowerCase());

              if (cmdLower === cmdToken || aliases.includes(cmdToken)) {
                matches.push({ modName, cmdName, def });
              }
            }
          }

          if (matches.length === 0) {
            return ctx.reply(`No module or command "${cmdToken}"`);
          }

          if (matches.length === 1) {
            const { modName, cmdName, def } = matches[0];
            const usage = def.usage
              ? ` — ${ctx.env.COMMAND_PREFIX}${def.usage}`
              : '';

            const isRacingUpgrade =
              modName === 'racing' && cmdName === 'upgrade';

            const extra = isRacingUpgrade
              ? ` Part types are: ${formatRacingPartTypes()}.`
              : '';

            return ctx.reply(
              `${modName}.${cmdName}: ${def.description || 'No description'}${usage}${extra}`
            );
          }

          const list = matches
            .map(({ modName, cmdName }) => `${modName}.${cmdName}`)
            .join(' | ');

          return ctx.reply(
            `Command "${cmdToken}" exists in: ${list}. Use ${ctx.commandPrefix}help <module> ${cmdToken} for details.`
          );
        }

        if (!mod || disabledMod) {
          return ctx.reply(`No module "${m}"`);
        }

        // no command supplied, show them the commands for the module
        if (!c) {
          const cmds = Object.entries(mod.commands)
            .filter(([, def]) => !def.hidden) // skip hidden
            .map(([name, def]) => {
              const middle = def.middleware || [];
              const isAdmin = middle.some((fn) => fn && fn.name && fn.name.includes('adminOnly'));
              return isAdmin ? `(Admin Only) ${name}` : name;
            });

          return ctx.reply(`Commands for "${m}": ${cmds.join(' | ')}`);
        }


        const def = mod.commands[c];
        // invalid command supplied for module
        if (!def || def.hidden) return ctx.reply(`No command "${m}.${c}"`);

        const usage = def.usage
          ? ` — ${ctx.env.COMMAND_PREFIX}${def.usage}`
          : '';

        const isRacingUpgrade = m === 'racing' && c === 'upgrade';
        const extra = isRacingUpgrade
          ? ` Part types are: ${formatRacingPartTypes()}.`
          : '';

        // return description for [module] [command]
        return ctx.reply(
          `${m}.${c}: ${def.description || 'No description'}${usage}${extra}`
        );
      },
    },


    ping: {
      name: 'ping',
      description: 'Health check.',
      async run(ctx) {
        await ctx.reply('pong');
      },
    },

    // EXAMPLE: admin-only command
    whoami: {
      name: 'whoami',
      description: 'Debug info for admins.',
      middleware: [adminOnly()], // only admins can run this command
      async run(ctx) {
        const a = ctx.msg?.authorDetails;
        await ctx.reply(
          `You are ${a?.displayName || 'unknown'}`
        );
      },
    },
    module: {
      name: 'module',
      description: 'Toggle a module on/off for the current platform.',
      usage: 'module <name> <on|off>',
      middleware: [adminOnly()],
      async run(ctx) {
        const args = ctx.args || [];
        const [rawName, rawToggle] = args;
        const settings = loadAccountSettings(ctx.accountId);
        const { registry } = ctx.services;

        if (rawName && String(rawName).toLowerCase() === 'status') {
          const platformKey =
            ctx.platform === 'discord' ? 'discord' :
            ctx.platform === 'youtube' ? 'youtube' : null;
          if (!platformKey) {
            return ctx.reply('Module toggles are not supported on this platform.');
          }

          const list = Object.values(registry.modules || {})
            .map((mod) => mod?.name)
            .filter(Boolean)
            .filter((name) => !isModuleGloballyDisabled(settings, name))
            .map((name) => {
              const enabled = !isModuleDisabledForPlatform(ctx, name);
              return `${name}:${enabled ? 'on' : 'off'}`;
            });

          return ctx.reply(
            `Modules (${platformKey}): ${list.join(' | ') || 'none'}`
          );
        }

        if (!rawName || !rawToggle) {
          return ctx.reply(`Usage: ${ctx.commandPrefix}module <name> <on|off>`);
        }

        const platformKey =
          ctx.platform === 'discord' ? 'discord' :
          ctx.platform === 'youtube' ? 'youtube' : null;
        if (!platformKey) {
          return ctx.reply('Module toggles are not supported on this platform.');
        }

        const toggle = String(rawToggle || '').toLowerCase();
        const enabled = toggle === 'on' || toggle === 'enable' || toggle === 'enabled';
        const disabled = toggle === 'off' || toggle === 'disable' || toggle === 'disabled';
        if (!enabled && !disabled) {
          return ctx.reply(`Usage: ${ctx.commandPrefix}module <name> <on|off>`);
        }

        const moduleName =
          Object.values(registry.modules || {}).find(
            (mod) => mod?.name?.toLowerCase() === String(rawName).toLowerCase()
          )?.name || null;
        if (!moduleName) {
          return ctx.reply(`No module "${rawName}"`);
        }

        if (isModuleGloballyDisabled(settings, moduleName)) {
          return ctx.reply('Module not available.');
        }

        const per = settings.disabledModulesByPlatform || {};
        const list = new Set(
          (per[platformKey] || []).map((n) => String(n || '').toLowerCase())
        );
        const key = moduleName.toLowerCase();
        if (enabled) {
          list.delete(key);
        } else {
          list.add(key);
        }

        updateAccountSettings(ctx.accountId, {
          disabledModulesByPlatform: {
            ...per,
            [platformKey]: Array.from(list),
          },
        });

        return ctx.reply(
          `${moduleName} ${enabled ? 'enabled' : 'disabled'} on ${platformKey}.`
        );
      },
    },
  },
};




