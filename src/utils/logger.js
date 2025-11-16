// src/utils/logger.js
const fs = require('fs');
const path = require('path');
const winston = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');

const { createLogger, format, transports, loggers } = winston;

// --- Config -----------------------------------------------------------------

// Base directory for logs
const LOG_DIR = path.join(__dirname, '..', 'logs');

// Make sure the directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

// Nice timestamp + simple line format
const baseFormat = format.combine(
  format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  format.printf(({ timestamp, level, message, ...meta }) => {
    const metaKeys = Object.keys(meta || {});
    const metaStr =
      metaKeys.length > 0 ? ` ${JSON.stringify(meta, null, 0)}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

// Console format (colorized)
const consoleFormat = format.combine(
  format.colorize(),
  baseFormat
);

// --- Rotating file transports ----------------------------------------------

// all.log → all-YYYY-MM-DD.log
const allFileTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'all-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'info',
  zippedArchive: true,      // gzip old logs
  maxSize: '10m',           // rotate if file exceeds 10MB
  maxFiles: '14d',          // keep 14 days
  tailable: true,
});

// error.log → error-YYYY-MM-DD.log
const errorFileTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'error-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'error',
  zippedArchive: true,
  maxSize: '10m',
  maxFiles: '30d',
  tailable: true,
});

// bot.log → bot-YYYY-MM-DD.log
const botFileTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'bot-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  level: 'info',
  zippedArchive: true,
  maxSize: '10m',
  maxFiles: '14d',
  tailable: true,
});

// exceptions.log → exceptions-YYYY-MM-DD.log
const exceptionsFileTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'exceptions-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '10m',
  maxFiles: '30d',
  tailable: true,
});

// rejections.log → rejections-YYYY-MM-DD.log
const rejectionsFileTransport = new DailyRotateFile({
  dirname: LOG_DIR,
  filename: 'rejections-%DATE%.log',
  datePattern: 'YYYY-MM-DD',
  zippedArchive: true,
  maxSize: '10m',
  maxFiles: '30d',
  tailable: true,
});

// --- Root app logger --------------------------------------------------------

// This is your "default" logger for general app logs
const appLogger = createLogger({
  level: 'info',
  format: baseFormat,
  transports: [
    allFileTransport,
    errorFileTransport,
    new transports.Console({ format: consoleFormat }),
  ],
  exceptionHandlers: [exceptionsFileTransport],
  rejectionHandlers: [rejectionsFileTransport],
  exitOnError: false,
});

// --- Bot logger via winston.loggers ----------------------------------------

// Bot logger: for AI commands, responses, etc.
loggers.add('bot', {
  level: 'info',
  format: baseFormat,
  transports: [
    // Writes bot logs to both all-%DATE%.log AND bot-%DATE%.log
    allFileTransport,
    botFileTransport,
    new transports.Console({ format: consoleFormat }),
  ],
});

// Helper to get loggers
function getLogger(name = 'app') {
  if (name === 'app') return appLogger;
  return loggers.get(name);
}

module.exports = {
  logger: appLogger,
  getLogger,
};
