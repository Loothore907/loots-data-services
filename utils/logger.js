// utils/logger.js
const winston = require('winston');
const chalk = require('chalk');
require('dotenv').config();

// Define log levels and colors
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  http: 3,
  verbose: 4,
  debug: 5,
  silly: 6
};

const colors = {
  error: 'red',
  warn: 'yellow',
  info: 'green',
  http: 'magenta',
  verbose: 'cyan',
  debug: 'blue',
  silly: 'gray'
};

// Add colors to Winston
winston.addColors(colors);

// Create format for console output
const consoleFormat = winston.format.combine(
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const levelUpper = level.toUpperCase();
    let formattedMessage = `${timestamp} [${levelUpper}]: ${message}`;
    
    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      formattedMessage += `\n${JSON.stringify(meta, null, 2)}`;
    }
    
    // Apply colors based on level
    switch (level) {
      case 'error':
        return chalk.red(formattedMessage);
      case 'warn':
        return chalk.yellow(formattedMessage);
      case 'info':
        return chalk.green(formattedMessage);
      case 'http':
        return chalk.magenta(formattedMessage);
      case 'verbose':
        return chalk.cyan(formattedMessage);
      case 'debug':
        return chalk.blue(formattedMessage);
      case 'silly':
        return chalk.gray(formattedMessage);
      default:
        return formattedMessage;
    }
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  levels,
  format: winston.format.combine(
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    winston.format.json()
  ),
  transports: [
    // Console transport
    new winston.transports.Console({
      format: consoleFormat
    }),
    // File transport for errors
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    }),
    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
      )
    })
  ]
});

module.exports = logger; 