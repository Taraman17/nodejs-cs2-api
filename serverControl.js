0/**
 * @file CS:GO Dedicated Server Control
 * @author Markus Adrario <mozilla@adrario.de>
 * @version 0.8
 * @requires rcon-srcds
 * @requires srcds-log-receiver
 * @requires express
 * @requires express-session
 * @requires express-rate-limit
 * @requires cors
 * @requires passport
 * @requires passport-steam
 * @requires http
 * @requires https
 * @requires ws
 * @requires url
 * @requires events
 * @requires node-pty
 * @requires child_process
 * @requires winston
 * @requires winston-daily-rotate-file
 * @requires ./serverInfo.js
 * @requires ./config.js
 */

const rcon = require('rcon-srcds');
const logReceiver = require('srcds-log-receiver');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const webSocket = require('ws');
const url = require('url');
const fs = require('fs');
const events = require('events');
const pty = require('node-pty');
const { exec, spawn } = require('child_process');
const winston = require('winston');
require('winston-daily-rotate-file');
const si = require('./serverInfo.js');
const config = require('./config.js');

/**
 * Stores the state of the controlled server-instance.
 * @typedef  state
 * @property {string}  operationPending -  1 of: none, start, stop, mapchange, update, auth.
 * @property {boolean}  serverRunning    - Is the server process running.
 * @property {object}   serverRcon       - rcon-srcds instance for the server.
 * @property {boolean}  authenticated    - Is the rcon instance authenticated with the server.
 */
 
/** @type {state} */
var state = {
    'operationPending': 'none',
    'serverRunning': false,
    'serverRcon': undefined,
    'authenticated': false
}

var serverInfo = new si();
var cfg = new config();
var localIP = require('local-ip')(cfg.iface);
var http = undefined;
var httpsCredentials = {};
// if configured for https, we fork here.
if (cfg.useHttps) {
    http = require('https');
    httpsCredentials = { 
        key: fs.readFileSync(cfg.httpsPrivateKey),
        cert: fs.readFileSync(cfg.httpsCertificate),
    };
    if (cfg.httpsCa != '') {
        httpsCredentials.ca = fs.readFileSync(cfg.httpsCa)
    }
} else {
    http = require('http');
}

// Setup the logger.
const logger = winston.createLogger({
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
    logger.add (new winston.transports.Console({
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    }));
}

// check for running Server on Startup
exec('/bin/ps -a', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return;
    }
    if (stdout.match(/srcds_linux/) != null) {
      state.serverRunning = true;
      logger.verbose('Found running server');
      authenticate().then((data) => {
          logger.verbose(`authentication ${data}`);
      }).catch((data) => {
          logger.verbose(`authentication ${data}`);
      });
    }
});

/**
 * Get available maps from server and store them in serverInfo
 * @return {Promise<JSON-string>} - Promise object that yields the result of reload.
 */
function reloadMaplist() {
    return new Promise((resolve, reject) => {
        executeRcon('maps *').then((answer) => {
            let re = /\(fs\) (\S+).bsp/g;
            let maplist = [];
            let mapsArray = getMatches(answer, re, 1);
            mapsArray.forEach((mapString) => {
                maplist.push(cutMapName(mapString));
            });
            maplist.sort();
            // Only return, if list has at least one item.
            if (maplist.length > 0) {
                serverInfo.mapsAvail = maplist;
                resolve(`{ "sucess": true }`);
            } else {
                resolve(`{ "sucess": false }`);
            }
        }).catch((err) => {
            resolve(`{ "sucess": false }`);
        });
    });
}

// Event Emitters
/**
 * Emits an event if mapchange is finished
 */
var mapChangeEmitter = new events.EventEmitter();
/**
 * Mapchange completed event.
 * @event mapChangeEmitter#result
 * @type {string} 'success' or another string yielding the reason for failure.
 */

/**
 * Emits an event reporting progress of the Server update.
 */
var updateEmitter = new events.EventEmitter();
/**
 * Update Progress with step and percentage
 * @event updateEmitter#progress
 * @type {string} - Reports, which action is in progress during the update.
 * @type {int} - Integer representing the percentage of the action that is completed.
 */

/**
 * Emits an event if rcon authentication is finished
 */
var authEmitter = new events.EventEmitter();
/**
 * Authenticated event.
 * @event authEmitter#authenticated
 */

/**
 * React to authenticated message from server.
 * @listens authEmitter#authenticated
 */
authEmitter.on('authenticated', () => {
    state.authenticated = true;
    logger.verbose("RCON Authenticate success");
    queryMaxRounds();
    // Get current and available maps and store them.
    executeRcon('host_map').then((answer) => {
        let re = /map" = "(\S+)"/;
        let matches = re.exec(answer);
        let mapstring = matches[1];
        serverInfo.map = cutMapName(mapstring);
    });
    reloadMaplist().then((answer) => {
        if (answer == '{ "sucess": false }') {
            logger.warn("Maps could not be loaded");
        }
    });
});


/**
 * Authenticate rcon with server
 * @return {Promise<JSON-string>} - Promise object that yields the result of authentication.
 * @fires authEmitter.authenticated
 */
function authenticate() {
    return new Promise((resolve, reject) => {
        if (state.operationPending == 'none') {
            if (!state.authenticated) {
                state.operationPending = 'auth';
                logger.verbose("RCON authenticating...");
                // since this API is designed to run on the same machine as the server keeping 
                // default here which is 'localhost'
                state.serverRcon = new rcon();
                logger.debug('sending authentication request');
                state.serverRcon.authenticate(cfg.rconPass).then(() => {
                    logger.debug('received authentication');
                    authEmitter.emit('authenticated');
                    resolve(`{ "authenticated": true }`);
                    state.operationPending = 'none';
                }).catch((err) => {
                    if (err == 'Already authenticated') {
                        logger.info(err);
                        authEmitter.emit('authenticated');
                        resolve(`{ "authenticated": true }`);
                    } else {
                        logger.error("authentication error: " + err);
                        reject(`{ "authenticated": false }`);
                    }
                    state.operationPending = 'none';
                });

            } else {
                authEmitter.emit('authenticated');
                resolve(`{ "authenticated": true }`);
            }
        } else {
            if (state.authenticated) {
                authEmitter.emit('authenticated');
                resolve(`{ "authenticated": true }`);
            }
        }
        reject(`{ "authenticated": false }`);
    });
}

/**
 * Executes a rcon command
 * @param   {string}           message - The rcon command to execute
 * @return {Promise<string>}          - Promise Object that contains the rcon response or an error message.
 */
function executeRcon (message) {
    logger.debug(`Executing rcon: ${message}`);
    return new Promise((resolve, reject) => {
        state.serverRcon.execute(message).then((answer) => {
            resolve(answer);
        }).catch((err) => {
            logger.error(`RCON Error: ${err}`);
            reject(err.message);
        });
    });
}


/*----------------- HTTP Server Code -------------------*/
// Setup Passport for SteamStrategy
passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((obj, done) => {
    done(null, obj);
});

passport.use(
    new SteamStrategy({
        returnURL: `${cfg.scheme}://${cfg.host}:${cfg.apiPort}/login/return`,
        realm: `${cfg.scheme}://${cfg.host}:${cfg.apiPort}/`,
        profile: false
    },
    (identifier, profile, done) => {
        process.nextTick(function () {

          // Cut the SteamID64 from the returned User-URI
          let steamID64 = identifier.split('/')[5];
          profile.identifier = steamID64;
          logger.http({
              'user': `${steamID64}`,
              'message': 'logged in'
          });
          return done(null, profile);
        });
    }
));
function ensureAuthenticated(req, res, next) {
    if (req.isAuthenticated()) {
        if (cfg.admins.includes(req.user.identifier)) {
            logger.http({
                'user': `${req.user.identifier}`,
                'message':`${req.method}:${req.url}`
            });
            return next();
        } else {
            logger.info({
                'user': `${req.user.identifier}`,
                'message': 'User not in Admin list.'
            });
            return res.status(401).send('User not in Admin list.');
        }
    }
    logger.info({
        'user': 'unknown',
        'message': `Unauthorized Access from ${req.ip}.`
    });
    return res.status(401).send('Not logged in.');
}

/**
 * Creates an express server to handle the API requests
 */
const app = express();
const limit = rateLimit({
    max: 20,// max requests
    windowMs: 60 * 1000, // 1 Minute
    message: 'Too many requests' // message to send
});
app.use(limit);
app.use(session({
    secret: cfg.sessionSecret,
    name: `csgo-api-${cfg.host}`,
    cookie: {
        expires: cfg.loginValidity,
        secure: cfg.useHttps
    },
    resave: true,
    saveUninitialized: true
}));
app.use(cors({
    origin: cfg.corsOrigin,
    credentials: true
}));
app.use(passport.initialize());
app.use(passport.session());

app.disable('x-powered-by');

//-------------------    Version 0.X --------------------------//
// Handle authentication.
app.get('/login',
    passport.authenticate('steam', { failureRedirect: '/loginStatus' }),
    (req, res) => {
        res.redirect(cfg.redirectPage);
    }
);
app.get('/login/return',
    passport.authenticate('steam', { failureRedirect: '/loginStatus' }),
    (req, res) => {
        res.redirect(cfg.redirectPage);
    }
);
app.get('/logout', (req, res) => {
    logger.http({
          'user': `${steamID64}`,
          'message': 'logged out'
      });
    req.logout();
    res.redirect(cfg.redirectPage);
});

// Return the current login status
app.get("/loginStatus", (req, res) => {
    res.writeHeader(200, {"Content-Type": "application/json"});
    if(req.user && cfg.admins.includes(req.user.identifier)) {
        res.write('{ "login": true }');
    } else {
        res.write('{ "login": false }');
    }
    res.end();
});

// Process "control" messages.
app.get("/control", ensureAuthenticated, (req, res) => {
    var args = req.query;

    // Start Server
    if (args.action == "start" && !state.serverRunning && state.operationPending == 'none') {
        state.operationPending = 'start';
        logger.verbose('Starting server.');
        let startMap =  "de_dust2";
        const safe = /^[a-zA-Z0-9-_]*$/;
        if (!safe.test(args.startmap)) {
            logger.warn(`Supplied mapname ${args.startmap} is not safe, using de_dust2`);
        } else {
            startMap = args.startmap;
        }
        let commandLine = `${cfg.serverCommandline} +map ${startMap}`;
        var serverProcess = exec(commandLine, function(error, stdout, stderr) {
            if (error) {
                // node couldn't execute the command.
                res.writeHeader(200, {"Content-Type": "application/json"});
                res.write('{ "success": false }');
                res.end();
                logger.error('Error Code: '+error.code);
                logger.error('Signal received: '+error.signal);
                logger.error(stderr);
                state.serverRunning = false;
                state.operationPending = 'none';
            } else {
                logger.verbose('screen started');
                authEmitter.once('authenticated', () => {
                    res.writeHeader(200, {"Content-Type": "application/json"});
                    res.write('{ "success": true }');
                    res.end();
                });
                state.serverRunning = true;
                state.operationPending = 'none';
            }
        });

    // Stop Server
    } else if (args.action == "stop" && state.serverRunning && state.operationPending == 'none') {
        state.operationPending = 'stop';
        logger.verbose("sending quit.");
        executeRcon('quit').then((answer) => {
            state.serverRunning = false;
            state.authenticated = false;
            res.writeHeader(200, {"Content-Type": "application/json"});
            res.write(`{ "success": ${!state.serverRunning} }`);
            res.end();
            state.operationPending = 'none';
        }).catch((err) => {
            logger.error('Stopping server Failed: ' + err);
            res.writeHeader(200, {"Content-Type": "application/json"});
            res.write(`{ "success": ${!state.serverRunning} }`);
            res.end();
            state.operationPending = 'none';
        });

    //Update Server
    } else if (args.action == "update" && !state.serverRunning && state.operationPending == 'none') {
        state.operationPending = 'update';
        let updateSuccess = false;
        logger.verbose('Updating Server.');
        let updateProcess = pty.spawn(cfg.updateCommand, cfg.updateArguments);

        updateProcess.on('data', (data) => {
            logger.debug(data);
            if (data.indexOf('Checking for available updates') != -1) {
                updateEmitter.emit('progress', 'Checking Steam client updates', 0);
            } else if (data.indexOf('Verifying installation') != -1) {
                updateEmitter.emit('progress', 'Verifying client installation', 0);
            } else if (data.indexOf('Logging in user') != -1) {
                updateEmitter.emit('progress', 'Logging in steam user', 0);
            } else if (data.indexOf('Logged in OK') != -1) {
                updateEmitter.emit('progress', 'Login OK', 100);
            } else if(data.indexOf('Update state (0x') != -1) {
                let rex = /Update state \(0x\d+\) (.+), progress: (\d{1,3})\.\d{2}/;
                let matches = rex.exec(data);
                updateEmitter.emit('progress', matches[1], matches[2]);
            } else if (data.indexOf('Downloading update (') != -1) {
                let rex = /\[(.+)] Downloading update/;
                let matches = rex.exec(data);
                updateEmitter.emit('progress', 'Updating Steam client', matches[1].slice(0, -1));
            } else if (data.indexOf('Success!') != -1) {
                updateEmitter.emit('progress', 'Update Successful!', 100);
                logger.verbose('update succeeded');
                updateSuccess = true;
                state.operationPending = 'none';
            }
        });

        if (cfg.webSockets) {
            res.writeHeader(200, {"Content-Type": "application/json"});
            if (updateProcess) {
                res.write(`{ "success": true }`);
            } else {
                res.write(`{ "success": false }`);
            }
            res.end();
            updateProcess.removeAllListeners();
            state.operationPending = 'none';
        } else {
            updateProcess.once('close', (code) => {
                res.writeHeader(200, {"Content-Type": "application/json"});
                res.write(`{ "success": ${updateSuccess} }`);
                res.end();
                updateProcess.removeAllListeners();
                state.operationPending = 'none';
            });
        }

    // Send Status
    } else if (args.action == "status") {
        res.writeHeader(200, {"Content-Type": "application/json"});
        res.write(`{ "running": ${state.serverRunning && state.authenticated} }`);
        res.end();

    //change map
    } else if (args.action == "changemap" && !state.operationPending == 'none') {
        state.operationPending = 'mapchange';
        res.writeHeader(200, { 'Content-Type': 'application/json' });
        // only try to change map, if it exists on the server.
        if (serverInfo.mapsAvail.includes(args.map)) {
            executeRcon(`map ${args.map}`).then((answer) => {
                if (!cfg.webSockets) {
                    // If the mapchange completed event is fired, send success and cancel timeout.
                    var sendCompleted = (result) => {
                        res.write(`{ "success": ${result == 'success'} }`);
                        res.end();
                        clearTimeout(mapchangeTimeout);
                        state.operationPending = 'none';
                    };
                    mapChangeEmitter.once('result', sendCompleted);

                    // A mapchange should not take longer than 30 sec.
                    let mapchangeTimeout = setTimeout( () => {
                        mapChangeEmitter.emit('result', 'timeout');
                        res.write(`{ "success": false }`);
                        res.end();
                        state.operationPending = 'none';
                    }, 30000);
                } else {
                    res.write(`{ "success": true }`);
                    res.end();
                    // If the mapchange is successful, cancel the timeout.
                    var removeTimeout = (result) => {
                        clearTimeout(mapchangeTimeout);
                        state.operationPending = 'none';
                    };
                    mapChangeEmitter.once('result', removeTimeout);

                    // A mapchange should not take longer than 30 sec.
                    let mapchangeTimeout = setTimeout( () => {
                        mapChangeEmitter.emit('result', 'timeout');
                        state.operationPending = 'none';
                    }, 30000);
                }
            }).catch((err) => {
                res.write(`{ "success": false }`);
                res.end();
                state.operationPending = 'none';
            });
        } else {
            res.write(`{ "success": false }`);
            res.end();
            state.operationPending = 'none';
        }

    // DEPRECATED - will be removed in future release, do not use.
    // follow mapchange
    } else if (args.action == "mapstart") {
        mapChangeEmitter.once('result', (result) => {
            res.writeHeader(200, {"Content-Type": "application/json"});
            res.write(`{ "completed": ${result == 'success'} }`);
            res.end();
        });

    // Update Maps available on server
    } else if (args.action == "reloadmaplist") {
        reloadMaplist().then( (answer) => {
            res.writeHeader(200, { 'Content-Type': 'application/json' });
            res.write(answer);
            res.end();
        });
    }
});

// Process "authenticate" message.
app.get("/authenticate", ensureAuthenticated, (req, res) => {
    res.writeHeader(200, {"Content-Type": "application/json"});
    authenticate().then((data) => {
        res.write(data);
        res.end();
    }).catch((data) => {
        res.write(data);
        res.end();
    });
});

// Process rcon requests
app.get("/rcon", ensureAuthenticated, (req, res) => {
    var message = req.query.message;
    executeRcon(message).then((answer) => {
        res.writeHeader(200, { 'Content-Type': 'text/plain' });
        res.write(answer);
        res.end();
    }).catch( (err) => {
        res.writeHeader(200, { 'Content-Type': 'text/plain' });
        res.write("Error, check logs for details");
        res.end();
        logger.error(err);
    });
});

// Process serverData request
app.get("/serverInfo", ensureAuthenticated, (req, res) => {
    logger.verbose('Processing Serverinfo request.');
    res.writeHeader(200, {"Content-Type": "application/json"});
    if (state.authenticated) {
        res.write(JSON.stringify(serverInfo.getAll()));
        res.end();
    } else {
        res.write('{ "error": true }');
        res.end();
    }
});
//------------------------ END V0.X ----------------------------//

//--------------------------- V1.0 ----------------------------//
/**
 * @api {get} /csgoapi/v1.0/login
 * @apiVersion 1.0
 * @apiName Login
 * @apiGroup Auth
 *
 * @apiSuccess (302) Redirect to confiured page.
 * @apiError (302) Redirect to /csgoapi/v1.0/loginStatus
 */
app.get('/csgoapi/v1.0/login',
    passport.authenticate('steam', { failureRedirect: '/csgoapi/v1.0/loginStatus' }),
    (req, res) => {
        res.redirect(cfg.redirectPage);
    }
);
/**
 * @api {get} /csgoapi/v1.0/login/return
 * @apiVersion 1.0
 * @apiName Login Return
 * @apiGroup Auth
 *
 * @apiSuccess (302) Redirect to confiured page.
 * @apiError (302) Redirect to /csgoapi/v1.0/loginStatus
 */
app.get('/csgoapi/v1.0/login/return',
    passport.authenticate('steam', { failureRedirect: '/csgoapi/v1.0/loginStatus' }),
    (req, res) => {
        res.redirect(cfg.redirectPage);
    }
);
/**
 * @api {get} /csgoapi/v1.0/logout
 * @apiVersion 1.0
 * @apiName Logout
 * @apiGroup Auth
 *
 * @apiSuccess (302) Redirect to confiured page.
 */
app.get('/csgoapi/v1.0/logout', (req, res) => {
    logger.http({
          'user': `${steamID64}`,
          'message': 'logged out'
      });
    req.logout();
    res.redirect(cfg.redirectPage);
});

/**
 * @api {get} /csgoapi/v1.0/loginStatus
 * @apiVersion 1.0
 * @apiName LoginStatus
 * @apiGroup Auth
 *
 * @apiSuccess {Boolean} login
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     {
 *        "login": true/false
 *     }
 */
app.get("/csgoapi/v1.0/loginStatus", (req, res) => {
    if(req.user && cfg.admins.includes(req.user.identifier)) {
        res.json({ "login": true });
    } else {
        res.json({ "login": false });
    }
});

// Manually Authenticate RCON
app.get("/csgoapi/v1.0/authenticate", ensureAuthenticated, (req, res) => {
    authenticate().then((data) => {
        res.json(data);
    }).catch((data) => {
        res.write(data);
    });
});

// serverData request
app.get("/csgoapi/v1.0/serverInfo", ensureAuthenticated, (req, res) => {
    logger.verbose('Processing Serverinfo request.');
    if (state.authenticated) {
        res.json(serverInfo.getAll());
    } else if (!state.authenticated) {
        res.status(503).json({ "error": "RCON not authenticated." });
    } else if (!state.running) {
        res.status(503).json({ "error": "CS:GO Server not running." });
    }
});

// Start Server
app.get("/csgoapi/v1.0/control/start", ensureAuthenticated, (req, res) => {
    var args = req.query;

    if (!state.serverRunning && state.operationPending == 'none') {
        state.operationPending = 'start';
        logger.verbose('Starting server.');
        let startMap = "de_dust2";
        const safe = /^[a-zA-Z0-9-_]*$/;
        if (!safe.test(args.startmap)) {
            logger.warn(`Supplied mapname ${args.startmap} is not safe, using de_dust2`);
        } else {
            startMap = args.startmap;
        }
        let commandLine = `${cfg.serverCommandline} +map ${startMap}`;
        var serverProcess = exec(commandLine, function(error, stdout, stderr) {
            if (error) {
                // node couldn't execute the command.
                res.status(501).json({ "error": error.code });
                logger.error('Error Code: '+error.code);
                logger.error('Signal received: '+error.signal);
                logger.error(stderr);
                state.serverRunning = false;
                state.operationPending = 'none';
            } else {
                logger.verbose('screen started');
                authEmitter.once('authenticated', () => {
                    res.json({ "success": true });
                });
                state.serverRunning = true;
                state.operationPending = 'none';
            }
        });
    } else if (state.serverRunning) {
        res.status(503).json({ "error": "Server already running." });
    } else if (state.operationPending != 'none') {
        res.status(503).json({ "error": `Another Operation is pending: ${state.operationPending}` });
    }
});

// Stop Server
app.get("/csgoapi/v1.0/control/stop", ensureAuthenticated, (req, res) => {
    if (state.serverRunning && state.operationPending == 'none') {
        state.operationPending = 'stop';
        logger.verbose("sending quit.");
        executeRcon('quit').then((answer) => {
            if (!state.serverRunning) {
                state.serverRunning = false;
                state.authenticated = false;
                res.json({ "success": true });
            } else {
                state.operationPending = 'none';
                res.status(501).json({ "error": "Server still running." });
            }
        }).catch((err) => {
            if (!state.serverRunning) {
                state.serverRunning = false;
                state.authenticated = false;
                res.json({ "success": true });
            } else {
                logger.error('Stopping server Failed: ' + err);
                res.status(501).json({ "error": `RCON Error: ${err.toString()}` });
                state.operationPending = 'none';
            }
        });
    } else if (!state.serverRunning) {
        res.status(501).json({ "error": "Server not running." });
    } else if (state.operationPending != 'none') {
        res.status(503).json({ "error": `Another Operation is pending: ${state.operationPending}` });
    }
});

//Update Server
app.get("/csgoapi/v1.0/control/update", ensureAuthenticated, (req, res) => {
    if (!state.serverRunning && state.operationPending == 'none') {
        state.operationPending = 'update';
        let updateSuccess = false;
        logger.verbose('Updating Server.');
        let updateProcess = pty.spawn(cfg.updateCommand, cfg.updateArguments);

        updateProcess.on('data', (data) => {
            logger.debug(data);
            if (data.indexOf('Checking for available updates') != -1) {
                updateEmitter.emit('progress', 'Checking Steam client updates', 0);
            } else if (data.indexOf('Verifying installation') != -1) {
                updateEmitter.emit('progress', 'Verifying client installation', 0);
            } else if (data.indexOf('Logging in user') != -1) {
                updateEmitter.emit('progress', 'Logging in steam user', 0);
            } else if (data.indexOf('Logged in OK') != -1) {
                updateEmitter.emit('progress', 'Login OK', 100);
            } else if(data.indexOf('Update state (0x') != -1) {
                let rex = /Update state \(0x\d+\) (.+), progress: (\d{1,3})\.\d{2}/;
                let matches = rex.exec(data);
                updateEmitter.emit('progress', matches[1], matches[2]);
            } else if (data.indexOf('Downloading update (') != -1) {
                let rex = /\[(.+)] Downloading update/;
                let matches = rex.exec(data);
                updateEmitter.emit('progress', 'Updating Steam client', matches[1].slice(0, -1));
            } else if (data.indexOf('Success!') != -1) {
                updateEmitter.emit('progress', 'Update Successful!', 100);
                logger.verbose('update succeeded');
                updateSuccess = true;
                state.operationPending = 'none';
            }
        });

        if (cfg.webSockets) {
            if (updateProcess) {
                res.json(`{ "success": true }`);
            } else {
                res.status(501).json({ "error": "Update could not be started" });
            }
            updateProcess.removeAllListeners();
            state.operationPending = 'none';
        } else {
            updateProcess.once('close', (code) => {
                if (updateSuccess) {
                    res.json({ "success": true });
                } else {
                    res.status(501).json({ "error": "Update was not successful" });
                }
                updateProcess.removeAllListeners();
                state.operationPending = 'none';
            });
        }
    } else if (state.operationPending != 'none') {
        res.status(503).json({ "error": `Another Operation is pending: ${state.operationPending}` });
    } else if (state.serverRunning) {
        res.status(503).json({ "error": "Server is running - stop before updating" });
    }
});

// Send Status
app.get("/csgoapi/v1.0/control/status", ensureAuthenticated, (req, res) => {
    res.json({ "running": (state.serverRunning && state.authenticated) });
});


//change map
app.get("/csgoapi/v1.0/control/changemap", ensureAuthenticated, (req, res) => {
    var args = req.query;
    if (!state.operationPending) {
        state.operationPending = 'mapchange';
        // only try to change map, if it exists on the server.
        if (serverInfo.mapsAvail.includes(args.map)) {
            executeRcon(`map ${args.map}`).then((answer) => {
                if (!cfg.webSockets) {
                    // If the mapchange completed event is fired, send success and cancel timeout.
                    var sendCompleted = (result) => {
                        res.json({ "success": (result == 'success') });
                        clearTimeout(mapchangeTimeout);
                        state.operationPending = 'none';
                    };
                    mapChangeEmitter.once('result', sendCompleted);

                    // A mapchange should not take longer than 30 sec.
                    let mapchangeTimeout = setTimeout( () => {
                        mapChangeEmitter.emit('result', 'timeout');
                        res.status(501).json({ "error": "Mapchange failed - timeout" });
                        state.operationPending = 'none';
                    }, 30000);
                } else {
                    res.json({ "success": true });
                    // If the mapchange is successful, cancel the timeout.
                    var removeTimeout = (result) => {
                        clearTimeout(mapchangeTimeout);
                        state.operationPending = 'none';
                    };
                    mapChangeEmitter.once('result', removeTimeout);

                    // A mapchange should not take longer than 30 sec.
                    let mapchangeTimeout = setTimeout( () => {
                        mapChangeEmitter.emit('result', 'timeout');
                        state.operationPending = 'none';
                    }, 30000);
                }
            }).catch((err) => {
                res.status(501).json({ "error": `RCON error: ${err.toString()}`});
                state.operationPending = 'none';
            });
        } else {
            res.status(501).json({ "error": `Map ${args.map} not available` });
            state.operationPending = 'none';
        }
    }
});

// TODO: Check JSON returned by function
// Update Maps available on server
app.get("/csgoapi/v1.0/control/reloadmaplist", ensureAuthenticated, (req, res) => {
    reloadMaplist().then( (answer) => {
        res.json(answer);
    });
});

// Process rcon requests
app.get("/csgoapi/v1.0/rcon", ensureAuthenticated, (req, res) => {
    var message = req.query.message;
    res.set('Content-Type', 'text/plain');
    executeRcon(message).then((answer) => {
        res.send(answer);
    }).catch( (err) => {
        res.status(501).send("Error, check server logs for details.");
        logger.error(err);
    });
});
//------------------------ END V1.0 ----------------------------//

if (cfg.useHttps) {
    var server = http.createServer(httpsCredentials, app);
} else {
    var server = http.createServer(app);
}

server.listen(cfg.apiPort);

/*----------------- WebSockets Code -------------------*/
if (cfg.webSockets) {
    const wssServer = http.createServer(httpsCredentials);
    const wss = new webSocket.Server({ server: wssServer });

    /**
     * Websocket to send data updates to a webClient.
     * @listens ws#connection
     */
    wss.on('connection', (ws) => {
        /**
         * Sends updated serverInfo to clients.
         */
        var sendUpdate = () => {
            ws.send(`{ "type": "serverInfo", "payload": ${JSON.stringify(serverInfo.getAll())} }`);
        }

        /**
         * Listens for messages on Websocket.
         * @listens ws#message
         */
        ws.on('message', (message) => {
            if (message.search("infoRequest") != -1) {
                sendUpdate();
            }
        });

        /**
         * Listens for changed serverInfo and calls function to forward them.
         * @listens serverInfo.serverInfoChanged#change
         */
        serverInfo.serverInfoChanged.on('change', sendUpdate);

        /** 
         * Reports update progress to clients.
         * @param {string} action - Reports, which action is in progress during the update.
         * @param {int} progress - Integer representing the percentage of the action that is completed.
         */
        var reportProgress = (action, progress) => {
            ws.send(`{ "type": "updateProgress", "payload": { "step": "${action}", "progress": ${progress} } }`);
        }
        /**
         * Listens for progress reporst from update process and sends them to the client.
         * @listens updateEmitter#progress
         */
        updateEmitter.on('progress', reportProgress);

        /** 
         * Sends info on completed mapchange.
         * @param {string} result  - 'sucess' if mapchange was successful.
         */
        var sendMapchangeComplete = (result) => {
            ws.send(`{ "type": "mapchange", "payload": { "success": ${result == 'success'} } }`);
            state.operationPending = 'none';
        }
        /**
         * Listens for completion of a mapchange.
         * @listens mapChangeEmitter#completed
         */
         mapChangeEmitter.on('result', sendMapchangeComplete);

        /**
         * Listens for Websocket to close and removes listeners.
         * @listens ws#close
         */
        ws.on('close', (code, reason) => {
            serverInfo.serverInfoChanged.removeListener('change', sendUpdate);
            updateEmitter.removeListener('progress', reportProgress);
            mapChangeEmitter.removeListener('result', sendMapchangeComplete);
        });
    });

    wssServer.listen(cfg.socketPort, () => {
        let host = '';
        if (cfg.host != '') {
            host = cfg.host;
            logger.verbose(cfg.host);
        } else {
            host = localIP;
            logger.verbose(localIP);
        }

        if(cfg.useHttps) {
            const ws = new webSocket(`wss://${host}:${wssServer.address().port}`);
        } else {
            const ws = new webSocket(`ws://${host}:${wssServer.address().port}`);
        }
    });
}

/*----------------- log receiving code --------------------*/
// Since we only control locally installed servers and server logging is not working on
// 'localhost', we use the ip-address of the interface configured.
logger.verbose("local IP is: " + localIP);
var logOptions = {
    address: localIP
};

/**
 * Receives logs from the Gameserver
 * @emits receiver#data
 */
var receiver = new logReceiver.LogReceiver(logOptions);
/**
 * Listens for logs sent by the CS:GO-Server
 * @listens receiver#data
 * @emits mapChangeEmitter#result
 */
receiver.on('data', (data) => {
    if (data.isValid) {
        // Start authentication, when not authenticated.
        if ((data.message.indexOf("Log file started") != -1) && !state.authenticated) {
            // Start of logfile
            // L 08/13/2020 - 21:48:49: Log file started (file "logs/L000_000_000_000_27015_202008132148_000.log") (game "/home/user/csgo_ds/csgo") (version "7929")
            logger.verbose('start authenticating RCON');
            authenticate().then((data) => {
                logger.verbose(`authentication ${data}`);
            }).catch((data) => {
                logger.verbose(`authentication ${data}`);
            });
            if (cfg.script('logStart') != '') {
                exec(cfg.script('logStart'));
            }
        } else if (data.message.indexOf("Started map") != -1) {
            // Start of map.
            // 'L 12/29/2005 - 13:33:49: Started map "cs_italy" (CRC "1940414799")
            let rex = /Started map \"(\S+)\"/g;
            let matches = rex.exec(data.message);
            let mapstring = matches[1];
            mapstring = cutMapName(mapstring);
            serverInfo.map = mapstring;
            mapChangeEmitter.emit('result', 'success');
            logger.verbose(`Started map: ${mapstring}`);
            serverInfo.clearPlayers();
            serverInfo.newMatch();
            if (cfg.script('mapStart') != '') {
                exec(cfg.script('mapStart'));
            }
        } else if (data.message.indexOf('World triggered "Match_Start" on') != -1) {
            // Start of a new match.
            // L 08/13/2020 - 21:49:26: World triggered "Match_Start" on "de_nuke"
            logger.verbose('Detected match start.');
            queryMaxRounds();
            serverInfo.newMatch();
            if (cfg.script('matchStart') != '') {
                exec(cfg.script('matchStart'));
            }
        } else if (data.message.indexOf('World triggered "Round_Start"') != -1) {
            // Start of round.
            // L 08/13/2020 - 21:49:28: World triggered "Round_Start"
            if (cfg.script('roundStart') != '') {
                exec(cfg.script('roundStart'));
            }
        } else if (/Team \"\S+\" scored/.test(data.message)) {
            // Team scores at end of round.
            // L 02/10/2019 - 21:31:15: Team "CT" scored "1" with "2" players
            // L 02/10/2019 - 21:31:15: Team "TERRORIST" scored "1" with "2" players
            rex = /Team \"(\S)\S+\" scored \"(\d+)\"/g;
            let matches = rex.exec(data.message);
            serverInfo.score = matches;
        } else if (data.message.indexOf('World triggered "Round_End"') != -1) {
            // End of round.
            // L 08/13/2020 - 22:24:22: World triggered "Round_End"
            if (cfg.script('roundEnd') != '') {
                exec(cfg.script('roundEnd'));
            }
        } else if (data.message.indexOf("Game Over:") != -1) {
            // End of match.
            // L 08/13/2020 - 22:24:22: Game Over: competitive 131399785 de_nuke score 16:9 after 35 min
            if (cfg.script('matchEnd') != '') {
                exec(cfg.script('matchEnd'));
            }
        } else if (/".+<\d+><STEAM_\d:\d:\d+>/.test(data.message)) {
            // Player join or teamchange.
            // L 05/11/2020 - 22:19:11: "Dummy<10><STEAM_0:0:0000000><>" entered the game
            // L 05/11/2020 - 22:19:13: "Dummy<11><STEAM_0:0:0000000>" switched from team <Unassigned> to <CT>
            // L 06/03/2020 - 14:37:36: "Dummy<3><STEAM_0:0:0000000>" switched from team <TERRORIST> to <Spectator>
            // L 05/11/2020 - 22:50:47: "Dummy<11><STEAM_0:0:0000000><Unassigned>" disconnected (reason "Disconnect")
            let rex = /"(.+)<\d+><(STEAM_\d+:\d+:\d+)>/g;
            let matches = rex.exec(data.message);
            if (data.message.indexOf("entered the game") != -1) {
                serverInfo.addPlayer( {'name': matches[1], 'steamID': matches[2]} );
            } else if (data.message.search(/disconnected \(reason/) != -1) {
                serverInfo.removePlayer(matches[2]);
            } else if (data.message.indexOf("switched from team") != -1) {
                rex = /<(STEAM_\d+:\d+:\d+)>.*switched from team <\S+> to <(\S+)>/g;
                matches = rex.exec(data.message);
                serverInfo.assignPlayer(matches[1], matches[2]);
            }
        } else if (data.message.indexOf('Log file closed') != -1) {
            // end of current log file. (Usually on mapchange or server quit.)
            // L 08/13/2020 - 22:25:00: Log file closed
            logger.verbose('logfile closed!');
            if (cfg.script('logEnd') != '') {
                exec(cfg.script('logEnd'));
            }
        }
    }
});
receiver.on('invalid', function(invalidMessage) {
    logger.verbose("Got some completely unparseable gargbase: " + invalidMessage);
});

/*------------------------- Helper Functions ----------------------------*/
/**
 * Query the server for mp_maxrounds.and store them in serverInfo
 */
function queryMaxRounds() {
    executeRcon('mp_maxrounds').then((answer) => {
        // "mp_maxrounds" = "30" ( def. "0" ) min. 0.000000 game notify replicated
        // - max number of rounds to play before server changes maps
        let rex = /\"mp_maxrounds\" = \"(\d+)\"/g;
        let matches = rex.exec(answer);
        serverInfo.maxRounds = matches[1];
    }).catch((err) => {
        logger.error("Error getting Maxrounds: " + err);
    });
}

/**
 * Extracts all matches for a regex.
 * @param {string} string - String to search.
 * @param {regex} regex   - Regex to execute on the string.
 * @param {integer} index - Optional index which capturing group should be retreived.
 * @returns {string[]} matches - Array holding the found matches.
 */
function getMatches(string, regex, index) {
    index || (index = 1); // default to the first capturing group
    var matches = [];
    var match;
    while (match = regex.exec(string)) {
        matches.push(match[index]);
    }
    return matches;
}

/**
 * Cuts the bare map-name from the various representations in the servers responses.
 * @param {string} mapstring   - The response of mapname(s) from rcon.
 * @returns {string} mapstring -  The mapname without workshop path or .bsp
 */
function cutMapName(mapstring) {
    if (mapstring.search('workshop') != -1) {
        re = /(\w+)/g;
        matches = mapstring.match(re);
        mapstring = matches[2];
    }
    if (mapstring.search(".bsp") != -1) {
        mapstring = mapstring.substr(0, mapstring.length - 4);
    }
    return mapstring;
}
