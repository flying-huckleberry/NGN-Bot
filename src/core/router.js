// src/core/router.js
const { COMMAND_PREFIX } = require('../config/env');
const { parseText } = require('../utils/parse');

// Returns dispatcher: (msg) => Promise<void>
function createRouter({ registry, buildContext, isModuleDisabled }) {
  // registry: { modules: { [moduleName]: ModuleManifest }, flat: Map<commandName, {mod, def}> }
  return async function dispatch({ msg, liveChatId, transport, platformMeta }) {
    const text = msg?.snippet?.textMessageDetails?.messageText || '';
    const parsed = parseText(text, COMMAND_PREFIX);
    if (!parsed) return; // not a command

    const { modName, cmdName, args } = parsed;

    // 1) dotted form "!mod.cmd"
    if (modName && cmdName) {
      const mod = registry.modules[modName];
      const def = mod?.commands?.[cmdName];
      if (def) {
        if (isModuleDisabled && isModuleDisabled(mod.name, transport, platformMeta)) return;
        return runCommand({
          mod,
          def,
          msg,
          liveChatId,
          args,
          buildContext,
          transport,
          platformMeta,
        });
      }
    }

    // 2) space-separated form "!mod cmd"
    if (!cmdName && modName) {
      const [maybeCmd, ...rest] = args;
      const mod = registry.modules[modName];
      const def = mod?.commands?.[maybeCmd];
      if (def) {
        if (isModuleDisabled && isModuleDisabled(mod.name, transport, platformMeta)) return;
        return runCommand({
          mod,
          def,
          msg,
          liveChatId,
          args: rest,
          buildContext,
          transport,
          platformMeta,
        });
      }
    }

    // 3) flat "!cmd"
    const flat = registry.flat.get(modName);
    if (flat) {
      const { mod, def } = flat;
      if (isModuleDisabled && isModuleDisabled(mod.name, transport, platformMeta)) return;
      return runCommand({
        mod,
        def,
        msg,
        liveChatId,
        args,
        buildContext,
        transport,
        platformMeta,
      });
    }

    // else: unknown command → optionally reply or ignore
  };
}

async function runCommand({ mod, def, msg, liveChatId, args, buildContext, transport, platformMeta }) {
  const ctx = await buildContext({ msg, liveChatId, args, transport, platformMeta });
  const stack = [
    ...(mod.middleware || []),
    ...(def.middleware || []),
    async (ctx) => def.run(ctx),
  ];

  let idx = -1;
  const next = async () => {
    idx++;
    const fn = stack[idx];
    if (!fn) return;
    await fn(ctx, next);
  };

  try {
    await next();
  } catch (err) {
    ctx.logger.error(`Command error [${mod.name}.${def.name}]`, err);
    // Optional: ctx.reply('An error occurred.')
  }
}

module.exports = { createRouter };
