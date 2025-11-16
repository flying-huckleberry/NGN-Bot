// src/server/layout.js
const { MODE } = require('../config/env');

function renderLayout({ title, active, content }) {
  const safeTitle = title || 'YouTube Bot Panel';

  // active is one of: 'dev', 'sandbox', 'auth' (or whatever you like)
  const isActive = (key) => (active === key ? 'class="active"' : '');

  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>${safeTitle}</title>
    <style>
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
        background: #111827;
        color: #f9fafb;
      }
      .layout {
        display: flex;
        min-height: 100vh;
      }
      .sidebar {
        width: 220px;
        background: #020617;
        border-right: 1px solid #1f2937;
        padding: 16px 12px;
      }
      .sidebar h1 {
        font-size: 1.1rem;
        margin: 0 0 12px 4px;
      }
      .mode {
        font-size: 0.85rem;
        color: #9ca3af;
        margin: 0 0 16px 4px;
      }
      .nav {
        list-style: none;
        padding: 0;
        margin: 0;
      }
      .nav li {
        margin-bottom: 6px;
      }
      .nav a {
        display: block;
        padding: 8px 10px;
        border-radius: 6px;
        text-decoration: none;
        font-size: 0.9rem;
        color: #d1d5db;
      }
      .nav a:hover {
        background: #111827;
      }
      .nav a.active {
        background: #1d4ed8;
        color: #f9fafb;
      }
      .main {
        flex: 1;
        padding: 20px 24px;
      }
      .main h2 {
        margin-top: 0;
      }
      code {
        background: #111827;
        padding: 2px 4px;
        border-radius: 4px;
        font-size: 0.9em;
      }
    </style>
  </head>
  <body>
    <div class="layout">
      <aside class="sidebar">
        <h1>YouTube Bot</h1>
        <p class="mode">Mode: <strong>${MODE}</strong></p>
        <ul class="nav">
          <li><a href="/" ${isActive('dev')}>Dev Panel</a></li>
          <li><a href="/sandbox" ${isActive('sandbox')}>Command Sandbox</a></li>
          <li><a href="/auth" ${isActive('auth')}>Auth / Tokens</a></li>
        </ul>
      </aside>
      <main class="main">
        ${content}
      </main>
    </div>
  </body>
</html>`;
}

module.exports = { renderLayout };
