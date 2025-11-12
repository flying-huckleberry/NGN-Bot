// src/routes/dev.js
// Dev panel + routes. Minimal API burn: reuses cached state and only calls
// getLiveChatIdFromUrl when we don't already have liveChatId.

const express = require('express');
const {
  TARGET_LIVESTREAM_URL,
} = require('../config/env');

const {
  getLiveChatIdFromUrl,
  primeChat,
} = require('../services/youtube');

const {
  loadDevState,
  saveDevState,
  resetDevState,
  devStateExists,
} = require('../state/devState');

const g = require('../state/g');

function renderDev(status = {}) {
  const s = JSON.stringify(status, null, 2);
  const exists = devStateExists();
  return `
    <!doctype html>
    <meta charset="utf-8" />
    <title>YT Bot Dev Panel</title>
    <style>
      body { font: 14px/1.4 system-ui, sans-serif; padding: 20px; max-width: 820px; }
