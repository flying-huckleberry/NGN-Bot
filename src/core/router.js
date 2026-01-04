// src/core/router.js
const { COMMAND_PREFIX } = require('../config/env');
const { parseText } = require('../utils/parse');
const { loadAccountCommands } = require('../state/customCommands');
const { loadAccountCountCommands, incrementCount } = require('../state/countCommands');
const { buildTemplateValues, renderTemplate } = require('../utils/templateVars');
const { isAdmin } = require('../utils/permissions');

// Returns dispatcher: (msg) => Promise<void>
function createRouter({ registry, buildContext, isModuleDisabled }) {
  // registry: { modules: { [moduleName]: ModuleManifest }, flat: Map<commandName, {mod, def}> }
  return async function dispatch({
    msg,
    liveChatId,
    transport,
    platformMeta,
    accountId,
    accountSettings,
    account,
    accountRuntime,
  }) {
    const text = msg?.snippet?.textMessageDetails?.messageText || '';
    const prefix = accountSettings?.commandPrefix || COMMAND_PREFIX || '!';
    const parsed = parseText(text, prefix);
    if (!parsed) return; // not a command

    const { modName, cmdName, args } = parsed;

    // 1) dotted form "!mod.cmd"
    if (modName && cmdName) {
      const mod = registry.modules[modName];
      const def = mod?.commands?.[cmdName];
      if (def) {
        if (isModuleDisabled && isModuleDisabled(mod.name, transport, platformMeta, accountSettings)) return;
        return runCommand({
          mod,
          def,
          msg,
          liveChatId,
          args,
          buildContext,
          transport,
          platformMeta,
          accountId,
          accountSettings,
          account,
          accountRuntime,
        });
      }
    }

    // 2) space-separated form "!mod cmd"
    if (!cmdName && modName) {
      const [maybeCmd, ...rest] = args;
      const mod = registry.modules[modName];
      const def = mod?.commands?.[maybeCmd];
      if (def) {
        if (isModuleDisabled && isModuleDisabled(mod.name, transport, platformMeta, accountSettings)) return;
        return runCommand({
          mod,
          def,
          msg,
          liveChatId,
          args: rest,
          buildContext,
          transport,
          platformMeta,
          accountId,
          accountSettings,
          account,
          accountRuntime,
        });
      }
    }

    // 3) flat "!cmd"
    const flat = registry.flat.get(modName);
    if (flat) {
      const { mod, def } = flat;
      if (isModuleDisabled && isModuleDisabled(mod.name, transport, platformMeta, accountSettings)) return;
      return runCommand({
        mod,
        def,
        msg,
        liveChatId,
        args,
        buildContext,
        transport,
        platformMeta,
        accountId,
        accountSettings,
        account,
        accountRuntime,
      });
    }

    // 4) account-scoped custom commands (flat only)
    if (modName && !cmdName) {
      const commands = loadAccountCommands(accountId || '');
      const match = commands.find(
        (cmd) => String(cmd?.name || '').toLowerCase() === modName.toLowerCase()
      );
      if (match && match.enabled !== false) {
        const platform = String(match.platform || 'both').toLowerCase();
        const transportType = transport?.type || '';
        const allowed =
          platform === 'both' ||
          (platform === 'youtube' && transportType === 'youtube') ||
          (platform === 'discord' && transportType === 'discord');
        if (allowed) {
          const ctx = await buildContext({
            msg,
            liveChatId,
            args,
            transport,
            platformMeta,
            accountId,
            accountSettings,
            account,
            accountRuntime,
          });
          const values = await buildTemplateValues({
            sender: ctx.mention(),
            accountRuntime: ctx.accountRuntime,
            accountId,
            accountSettings,
          });
          const rendered = renderTemplate(match.response, values);
          await ctx.reply(rendered);
          return;
        }
      }
    }

    // 5) account-scoped count commands (flat only, YouTube only)
    if (modName && !cmdName) {
      const commands = loadAccountCountCommands(accountId || '');
      const match = commands.find(
        (cmd) => String(cmd?.name || '').toLowerCase() === modName.toLowerCase()
      );
      if (match && match.enabled !== false) {
        if (transport?.type !== 'youtube') return;

        const ctx = await buildContext({
          msg,
          liveChatId,
          args,
          transport,
          platformMeta,
          accountId,
          accountSettings,
          account,
          accountRuntime,
        });

        if (!isAdmin(ctx.msg, ctx)) {
          return;
        }

        const nextCount = incrementCount(accountId, match.id);
        const response = String(match.response || '');
        const rendered = response.replace(/\{count\}/gi, String(nextCount));
        await ctx.reply(rendered);
        return;
      }
    }

    // else: unknown command → optionally reply or ignore
  };
}

async function runCommand({
  mod,
  def,
  msg,
  liveChatId,
  args,
  buildContext,
  transport,
  platformMeta,
  accountId,
  accountSettings,
  account,
  accountRuntime,
}) {
  const ctx = await buildContext({
    msg,
    liveChatId,
    args,
    transport,
    platformMeta,
    accountId,
    accountSettings,
    account,
    accountRuntime,
  });
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
