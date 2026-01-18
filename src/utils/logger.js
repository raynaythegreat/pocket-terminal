/**
 * Simple logger utility with support for different log levels.
 */
const config = require("../config");

const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

class Logger {
  constructor(level = "info") {
    this.level = LOG_LEVELS[level.toLowerCase()] ?? LOG_LEVELS.info;
  }

  format(level, message, ...args) {
    const timestamp = new Date().toISOString();
    const formattedArgs = args.map(arg => 
      arg instanceof Error ? arg.stack : JSON.stringify(arg)
    ).join(" ");
    
    return `[${timestamp}] ${level.toUpperCase()}: ${message} ${formattedArgs}`;
  }

  debug(message, ...args) {
    if (this.level <= LOG_LEVELS.debug) {
      console.debug(this.format("debug", message, ...args));
    }
  }

  info(message, ...args) {
    if (this.level <= LOG_LEVELS.info) {
      console.info(this.format("info", message, ...args));
    }
  }

  warn(message, ...args) {
    if (this.level <= LOG_LEVELS.warn) {
      console.warn(this.format("warn", message, ...args));
    }
  }

  error(message, ...args) {
    if (this.level <= LOG_LEVELS.error) {
      console.error(this.format("error", message, ...args));
    }
  }
}

// Ensure the logger can be created even if config.logging is temporarily undefined during circular imports
const logLevel = (config && config.logging && config.logging.level) ? config.logging.level : "info";
const logger = new Logger(logLevel);

module.exports = { logger, Logger };