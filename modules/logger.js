/**
 * @requires winston
 * @requires winston-daily-rotate-file
 * @requires ./config.js
 */

const winston = require('winston');
require('winston-daily-rotate-file');
var cfg = require('./configClass.js');

// Setup the logger.
var logger = winston.createLogger({
    level: cfg.logLevel,
    format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json()
    ),
    transports: [
        new winston.transports.DailyRotateFile({
            filename: `${cfg.logFile}-%DATE%.log`,
            datePattern: 'YYYY-MM-DD',
            maxFiles: `${cfg.logDays}d`
        })
    ]
});
// If level is 'debug', also log to console.
if (cfg.logLevel == 'debug') {
    logger.add(new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

module.exports = logger;