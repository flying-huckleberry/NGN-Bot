// src/state/autoAnnouncements.js
const fs = require('fs');
const {
  ensureAccountDir,
  getAccountFilePath,
} = require('./accountPaths');
const { MAX_CHARS, AUTO_ANNOUNCEMENTS_MAX } = require('../config/env');

const ANNOUNCEMENTS_FILE = 'auto_announcements.json';
const cache = new Map();
const MIN_INTERVAL_MINUTES = 3;
const MAX_INTERVAL_MINUTES = 60;

function parseId(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  if (!Number.isInteger(n)) return null;
  if (n <= 0) return null;
  return n;
}

function normalizeName(raw) {
  const trimmed = String(raw || '').trim();
  return trimmed;
}

function clampIntervalMinutes(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    throw new Error('Interval must be a number.');
  }
  if (!Number.isInteger(n)) {
    throw new Error('Interval must be a whole number of minutes.');
  }
  if (n < MIN_INTERVAL_MINUTES || n > MAX_INTERVAL_MINUTES) {
    throw new Error(`Interval must be between ${MIN_INTERVAL_MINUTES} and ${MAX_INTERVAL_MINUTES} minutes.`);
  }
  return n;
}

function buildAnnouncement(input) {
  const name = normalizeName(input?.name);
  if (!name) throw new Error('Name is required.');
  if (name.length > MAX_CHARS) {
    throw new Error(`Name exceeds ${MAX_CHARS} characters.`);
  }
  const message = String(input?.message || '').trim();
  if (!message) throw new Error('Message is required.');
  if (message.length > MAX_CHARS) {
    throw new Error(`Message exceeds ${MAX_CHARS} characters.`);
  }
  const intervalMinutes = clampIntervalMinutes(input?.intervalMinutes);
  return {
    name,
    message,
    intervalSeconds: intervalMinutes * 60,
    enabled: input?.enabled !== false,
    id: parseId(input?.id) || null,
    // Persist the last send timestamp so cadence survives restarts.
    // This is intentionally stored per message (not runtime-only) to avoid
    // a burst of messages when the server restarts or the transport re-enables.
    lastSentAt: input?.lastSentAt || null,
    createdAt: input?.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

function readAnnouncementsFile(accountId) {
  ensureAccountDir(accountId);
  const filePath = getAccountFilePath(accountId, ANNOUNCEMENTS_FILE);
  if (!fs.existsSync(filePath)) {
    return [];
  }
  try {
    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function loadAccountAnnouncements(accountId) {
  if (!accountId) throw new Error('Account ID is required.');
  if (cache.has(accountId)) return cache.get(accountId);
  const items = readAnnouncementsFile(accountId);
  cache.set(accountId, items);
  return items;
}

function saveAccountAnnouncements(accountId, announcements) {
  if (!accountId) throw new Error('Account ID is required.');
  const normalized = Array.isArray(announcements) ? announcements : [];
  ensureAccountDir(accountId);
  const filePath = getAccountFilePath(accountId, ANNOUNCEMENTS_FILE);
  fs.writeFileSync(filePath, JSON.stringify(normalized, null, 2), 'utf8');
  cache.set(accountId, normalized);
  return normalized;
}

function upsertAnnouncement(accountId, payload) {
  const announcements = loadAccountAnnouncements(accountId).slice();
  const next = buildAnnouncement(payload);
  const requestedId = parseId(payload?.id);
  const existingIdx = requestedId
    ? announcements.findIndex((item) => parseId(item?.id) === requestedId)
    : -1;

  if (existingIdx >= 0) {
    const existing = announcements[existingIdx];
    const collision = announcements.find(
      (item, idx) =>
        idx !== existingIdx &&
        normalizeName(item.name).toLowerCase() === normalizeName(next.name).toLowerCase()
    );
    if (collision) {
      throw new Error(`Auto announcement "${next.name}" already exists.`);
    }
    announcements[existingIdx] = {
      ...existing,
      ...next,
      id: existing.id,
      createdAt: existing.createdAt || next.createdAt,
      // Preserve lastSentAt on edits so timing remains stable.
      lastSentAt: existing.lastSentAt || next.lastSentAt || null,
    };
  } else {
    if (requestedId) {
      throw new Error('Auto announcement not found.');
    }
    if (announcements.length >= AUTO_ANNOUNCEMENTS_MAX) {
      throw new Error(`You can only create ${AUTO_ANNOUNCEMENTS_MAX} auto announcements.`);
    }
    const collision = announcements.find(
      (item) => normalizeName(item.name).toLowerCase() === normalizeName(next.name).toLowerCase()
    );
    if (collision) {
      throw new Error(`Auto announcement "${next.name}" already exists.`);
    }
    const nextId = announcements.reduce((max, item) => Math.max(max, parseId(item?.id) || 0), 0) + 1;
    announcements.push({ ...next, id: nextId });
  }

  return saveAccountAnnouncements(accountId, announcements);
}

function deleteAnnouncement(accountId, id) {
  const announcements = loadAccountAnnouncements(accountId).slice();
  const targetId = parseId(id);
  if (!targetId) {
    throw new Error('Auto announcement not found.');
  }
  const next = announcements.filter((item) => parseId(item?.id) !== targetId);
  if (next.length === announcements.length) {
    throw new Error('Auto announcement not found.');
  }
  return saveAccountAnnouncements(accountId, next);
}

function toggleAnnouncement(accountId, id, enabled) {
  const announcements = loadAccountAnnouncements(accountId).slice();
  const targetId = parseId(id);
  const idx = announcements.findIndex((item) => parseId(item?.id) === targetId);
  if (idx === -1) {
    throw new Error('Auto announcement not found.');
  }
  announcements[idx] = {
    ...announcements[idx],
    enabled: Boolean(enabled),
    updatedAt: new Date().toISOString(),
  };
  return saveAccountAnnouncements(accountId, announcements);
}

function updateAnnouncementLastSent(accountId, id, lastSentAt) {
  const announcements = loadAccountAnnouncements(accountId).slice();
  const targetId = parseId(id);
  const idx = announcements.findIndex((item) => parseId(item?.id) === targetId);
  if (idx === -1) return announcements;
  // Update lastSentAt only; we intentionally avoid touching other fields
  // to keep this a lightweight, timing-only persistence hook.
  announcements[idx] = {
    ...announcements[idx],
    lastSentAt: lastSentAt || new Date().toISOString(),
  };
  return saveAccountAnnouncements(accountId, announcements);
}

function resetAnnouncementsCache(accountId) {
  if (accountId) cache.delete(accountId);
  else cache.clear();
}

module.exports = {
  loadAccountAnnouncements,
  saveAccountAnnouncements,
  upsertAnnouncement,
  deleteAnnouncement,
  toggleAnnouncement,
  updateAnnouncementLastSent,
  resetAnnouncementsCache,
  MIN_INTERVAL_MINUTES,
  MAX_INTERVAL_MINUTES,
};
