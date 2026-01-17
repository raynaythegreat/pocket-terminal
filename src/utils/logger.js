/**
 * Centralized logging utility for Pocket Terminal.
 * Provides consistent logging across all modules.
 */

const config = require("../config");

const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
};

const colors = {
  error: "\x1b[31m", // red
  warn: "\x1b[33m",  // yellow
  info: "\x1b[36m",  // cyan
  debug: "\x1b[37m", // white
  reset: "\x1b[0m",
};

class Logger {
  constructor(level = "info") {
    this.level = levels[level] || levels.info;
  }

  shouldLog(level) {
    return levels[level] <= this.level;
  }

  formatMessage(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const prefix = config.logging.format === "pretty" 
      ? `${colors[level]}[${level.toUpperCase()}]${colors.reset} ${timestamp}`
      : JSON.stringify({
          level,
          timestamp,
          message,
          args: args.length > 0 ? args : undefined,
        });
    
    return `${prefix} ${message}`;
  }

  error(message, ...args) {
    if (this.shouldLog("error")) {
      console.error(this.formatMessage("error", message, ...args));
    }
  }

  warn(message, ...args) {
    if (this.shouldLog("warn")) {
      console.warn(this.formatMessage("warn", message, ...args));
    }
  }

  info(message, ...args) {
    if (this.shouldLog("info")) {
      console.log(this.formatMessage("info", message, ...args));
    }
  }

  debug(message, ...args) {
    if (this.shouldLog("debug")) {
      console.log(this.formatMessage("debug", message, ...args));
    }
  }
}

// Create singleton logger instance
const logger = new Logger(config.logging.level);

module.exports = { logger, Logger };