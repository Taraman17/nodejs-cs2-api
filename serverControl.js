/**
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

const rcon = require('rcon-srcds').default;
const logReceiver = require('srcds-log-receiver');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const webSocket = require('ws');
const url = require('url');
const https = require('https');
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
 * @typedef  nodejsapiState
 * @property {string}  operationPending -  1 of: none, start, stop, mapchange, update, auth.
 * @property {boolean}  serverRunning    - Is the server process running.
 * @property {object}   serverRcon       - rcon-srcds instance for the server.
 * @property {boolean}  authenticated    - Is the rcon instance authenticated with the server.
 */
 
/** @type {nodejsapiState} */
var nodejsapiState = {
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
        logger.error(`exec error: ${error}`);
        return;
    }
    if (stdout.match(/srcds_linux/) != null) {
        nodejsapiState.serverRunning = true;
        logger.verbose('Found running server');
        authenticate().then((data) => {
            logger.verbose(`authentication ${data.authenticated}`);
        }).catch((data) => {
            logger.verbose(`authentication ${data.authenticated}`);
        });
    }
});

/**
 * Get available maps from server and store them in serverInfo
 * @return {Promise<JSON-string>} - Promise object that yields the result of reload.
 */
function reloadMaplist() {
    return new Promise((resolve, reject) => {

        function _sendApiRequest(_mapName, mapId) {
            return new Promise ((resolve, reject) => {
                let workshopInfo = '';

                const options = {
                    hostname: 'api.steampowered.com',
                    path: '/ISteamRemoteStorage/GetPublishedFileDetails/v1/',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
                };
                var steamApiRequest = https.request(options, (res) => {
                    let resData = '';
                    res.on('data', (dataChunk) => {
                        resData += dataChunk;
                    });
                    res.on('end', () => {
                        try {
                            resJSON = JSON.parse(resData);
                            let previewLink = resJSON.response.publishedfiledetails[0].preview_url;
                            let title = resJSON.response.publishedfiledetails[0].title;
                            let description = resJSON.response.publishedfiledetails[0].description;
                            let tags = resJSON.response.publishedfiledetails[0].tags;
                            resolve({ "name": _mapName, "title": title, "description": description, "previewLink": previewLink, "tags": tags });
                        }
                        catch (e) {
                            reject({ "name": _mapName, "title": "", "description": "", "previewLink": "", "tags": "" });
                        }
                    });
                });

                steamApiRequest.on('error', error => {
                    logger.warn(`steamApiRequest not successful: ${error}`);
                    reject({ "name": _mapName, "title": "", "description": "", "previewLink": "", "tags": "" });
                });

                steamApiRequest.write(`itemcount=1&publishedfileids%5B0%5D=${mapId}`);
                steamApiRequest.end();
            });
        }

        executeRcon('maps *').then((answer) => {
            const officialMaps = require('./OfficialMaps.json');
            let re = /\(fs\) (\S+).bsp/g;
            let maplist = [];
            let mapdetails = [];
            let mapsArray = getMatches(answer, re, 1);
            let promises = [];
            mapsArray.forEach((mapString) => {
                let mapName = cutMapName(mapString);
                maplist.push(mapName);
                if (mapString.includes('workshop/')) {
                    let mapIdRegex = /workshop\/(\d+)\//;
                    let workshopId = mapString.match(mapIdRegex)[1];
                    promises.push(_sendApiRequest(mapName, workshopId));
                } else {
                    let workshopId = officialMaps[mapName];
                    if (workshopId != undefined) {
                        promises.push(_sendApiRequest(mapName, workshopId));
                    } else {
                        mapdetails.push({ "name": mapName, "title": "", "description": "", "previewLink": "", "tags": "" });
                    }
                }
            });
            Promise.allSettled(promises).then( (results) => {
                results.forEach((result) => {
                    mapdetails.push(result.value)
                })

                mapdetails.sort((a, b) => a.name.localeCompare(b.name));
                maplist.sort();
                // Only return, if list has at least one item.
                if (maplist.length > 0) {
                    logger.debug("Saving Maplist to ServerInfo");
                    serverInfo.mapsAvail = maplist;
                    serverInfo.mapsDetails = mapdetails;
                    resolve({ "success": true });
                } else {
                    resolve({ "success": false });
                }
            });
        }).catch((err) => {
            resolve({ "success": false });
        });
    });
}

// Event Emitters
/**
 * Emits information on control operations.
 */
var controlEmitter = new events.EventEmitter();
/**
 * Control execution event. Tells the start and end of control routines.
 * @event controlEmitter#exec
 * @property {string} operation (start, stop, update, mapchange)
 * @property {string} action (start, end, fail)
 */
/**
 * Tracks progress of control routines.
 * @event controlEmitter#progress
 * @property {string} step - descripbes which step of an operation is reported.
 * @property {int} progress - the percentage of the step that is completed.
 */

/**
 * Sets the operationPending variable on events. Gathers Information on RCON authentication.
 * @listens controlEmitter#exec
 */
controlEmitter.on('exec', (operation, action) => {
    nodejsapiState.operationPending = (action == 'start') ? operation : 'none';
    logger.debug('nodejsapiState.operationPending = ' + nodejsapiState.operationPending);
    if (operation == 'auth' && action == 'end') {
        nodejsapiState.authenticated = true;
        logger.debug('nodejsapiState.authenticated = ' + nodejsapiState.authenticated);
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
            if (answer == '{ "success": false }') {
                logger.warn("Maps could not be loaded");
            }
        });
    }
});

/**
 * Authenticate rcon with server
 * @return {Promise<JSON-string>} - Promise object that yields the result of authentication.
 * @fires controlEmitter.exec
 */
function authenticate() {
    if (nodejsapiState.operationPending != 'auth') {
        controlEmitter.emit('exec', 'auth', 'start');
        return new Promise((resolve, reject) => {
            if (!nodejsapiState.authenticated) {
                logger.verbose("RCON authenticating...");
                // since this API is designed to run on the same machine as the server keeping 
                // default here which is 'localhost'
                let authTimeout = setTimeout( () => {
                    logger.error('Authentication timed out');
                    controlEmitter.emit('exec', 'auth', 'fail');
                    reject({ "authenticated": false });
                }, 60000);
                nodejsapiState.serverRcon = new rcon({});
                logger.debug('sending authentication request');
                nodejsapiState.serverRcon.authenticate(cfg.rconPass).then(() => {
                    logger.debug('received authentication');
                    controlEmitter.emit('exec', 'auth', 'end');
                    clearTimeout(authTimeout);
                    resolve({ "authenticated": true });
                }).catch((err) => {
                    if (err == 'Already authenticated') {
                        logger.verbose('Already authenticated.');
                        controlEmitter.emit('exec', 'auth', 'end');
                        clearTimeout(authTimeout);
                        resolve({ "authenticated": true });
                    } else {
                        logger.error("authentication error: " + err);
                        controlEmitter.emit('exec', 'auth', 'fail');
                        clearTimeout(authTimeout);
                        reject({ "authenticated": false });
                    }
                });

            } else {
                logger.info('Already authenticated.');
                controlEmitter.emit('exec', 'auth', 'end');
                resolve({ "authenticated": true });
            }
        });
    } else {
        return new Promise((resolve, reject) => {
            if (nodejsapiState.authenticated) {
                logger.verbose('Already authenticated.');
                resolve({ "authenticated": true });
            } else {
                logger.verbose(`Rcon authentication cancelled due to other operation Pending: ${nodejsapiState.operationPending}`);
                reject({ "authenticated": false });
            }
        });
    }
    
}

/**
 * Executes a rcon command
 * @param   {string}           message - The rcon command to execute
 * @return {Promise<string>}          - Promise Object that contains the rcon response or an error message.
 */
function executeRcon (message) {
    logger.debug(`Executing rcon: ${message}`);
    return new Promise((resolve, reject) => {
        nodejsapiState.serverRcon.execute(message).then((answer) => {
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
    max: 50,// max requests
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
    if (args.action == "start" && !nodejsapiState.serverRunning && nodejsapiState.operationPending == 'none') {
        nodejsapiState.operationPending = 'start';
        logger.verbose('Starting server.');
        let startMap =  "de_dust2";
        const safe = /^[a-zA-Z0-9-_]*$/;
        if (!safe.test(args.startmap)) {
            logger.warn(`Supplied mapname ${args.startmap} is not safe, using de_dust2`);
        } else {
            startMap = args.startmap;
        }
        let commandLine = `${cfg.serverCommandline} +map ${startMap}`;
        var serverProcess = exec(commandLine, (error, stdout, stderr) => {
            if (error) {
                // node couldn't execute the command.
                res.writeHeader(200, {"Content-Type": "application/json"});
                res.write('{ "success": false }');
                res.end();
                logger.error('Error Code: '+error.code);
                logger.error('Signal received: '+error.signal);
                logger.error(stderr);
                nodejsapiState.serverRunning = false;
                nodejsapiState.operationPending = 'none';
            } else {
                logger.verbose('screen started');
                controlEmitter.on('exec', function callback (operation, action) {
                    if (operation == 'auth' && action == 'end') {
                        res.writeHeader(200, {"Content-Type": "application/json"});
                        res.write('{ "success": true }');
                        res.end();
                        controlEmitter.removeListener('exec', callback);
                    }
                });
                nodejsapiState.serverRunning = true;
                nodejsapiState.operationPending = 'none';
            }
        });

    // Stop Server
    } else if (args.action == "stop" && nodejsapiState.serverRunning && nodejsapiState.operationPending == 'none') {
        nodejsapiState.operationPending = 'stop';
        logger.verbose("sending quit.");
        executeRcon('quit').then((answer) => {
            nodejsapiState.serverRunning = false;
            nodejsapiState.authenticated = false;
            res.writeHeader(200, {"Content-Type": "application/json"});
            res.write(`{ "success": ${!nodejsapiState.serverRunning} }`);
            res.end();
            nodejsapiState.operationPending = 'none';
        }).catch((err) => {
            logger.error('Stopping server Failed: ' + err);
            res.writeHeader(200, {"Content-Type": "application/json"});
            res.write(`{ "success": ${!nodejsapiState.serverRunning} }`);
            res.end();
            nodejsapiState.operationPending = 'none';
        });

    //Update Server
    } else if (args.action == "update" && !nodejsapiState.serverRunning && nodejsapiState.operationPending == 'none') {
        nodejsapiState.operationPending = 'update';
        let updateSuccess = false;
        logger.verbose('Updating Server.');
        let updateProcess = pty.spawn(cfg.updateCommand, cfg.updateArguments);

        updateProcess.on('data', (data) => {
            logger.debug(data);
            if (data.indexOf('Checking for available updates') != -1) {
                controlEmitter.emit('progress', 'Checking Steam client updates', 0);
            } else if (data.indexOf('Verifying installation') != -1) {
                controlEmitter.emit('progress', 'Verifying client installation', 0);
            } else if (data.indexOf('Logging in user') != -1) {
                controlEmitter.emit('progress', 'Logging in steam user', 0);
            } else if (data.indexOf('Logged in OK') != -1) {
                controlEmitter.emit('progress', 'Login OK', 100);
            } else if(data.indexOf('Update state (0x') != -1) {
                let rex = /Update state \(0x\d+\) (.+), progress: (\d{1,3})\.\d{2}/;
                let matches = rex.exec(data);
                controlEmitter.emit('progress', matches[1], matches[2]);
            } else if (data.indexOf('Downloaaction update (') != -1) {
                let rex = /\[(.+)] Downloaaction update/;
                let matches = rex.exec(data);
                controlEmitter.emit('progress', 'Updating Steam client', matches[1].slice(0, -1));
            } else if (data.indexOf('Success!') != -1) {
                controlEmitter.emit('progress', 'Update Successful!', 100);
                logger.verbose('update succeeded');
                updateSuccess = true;
                nodejsapiState.operationPending = 'none';
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
            nodejsapiState.operationPending = 'none';
        } else {
            updateProcess.once('close', (code) => {
                res.writeHeader(200, {"Content-Type": "application/json"});
                res.write(`{ "success": ${updateSuccess} }`);
                res.end();
                updateProcess.removeAllListeners();
                nodejsapiState.operationPending = 'none';
            });
        }

    // Send Status
    } else if (args.action == "status") {
        res.writeHeader(200, {"Content-Type": "application/json"});
        res.write(`{ "running": ${nodejsapiState.serverRunning && nodejsapiState.authenticated} }`);
        res.end();

    //change map
    } else if (args.action == "changemap" && !nodejsapiState.operationPending == 'none') {
        nodejsapiState.operationPending = 'mapchange';
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
                        nodejsapiState.operationPending = 'none';
                    };
                    mapChangeEmitter.once('result', sendCompleted);

                    // A mapchange should not take longer than 30 sec.
                    let mapchangeTimeout = setTimeout( () => {
                        mapChangeEmitter.emit('result', 'timeout');
                        res.write(`{ "success": false }`);
                        res.end();
                        nodejsapiState.operationPending = 'none';
                    }, 30000);
                } else {
                    res.write(`{ "success": true }`);
                    res.end();
                    // If the mapchange is successful, cancel the timeout.
                    var removeTimeout = (result) => {
                        clearTimeout(mapchangeTimeout);
                        nodejsapiState.operationPending = 'none';
                    };
                    mapChangeEmitter.once('result', removeTimeout);

                    // A mapchange should not take longer than 30 sec.
                    let mapchangeTimeout = setTimeout( () => {
                        mapChangeEmitter.emit('result', 'timeout');
                        nodejsapiState.operationPending = 'none';
                    }, 30000);
                }
            }).catch((err) => {
                res.write(`{ "success": false }`);
                res.end();
                nodejsapiState.operationPending = 'none';
            });
        } else {
            res.write(`{ "success": false }`);
            res.end();
            nodejsapiState.operationPending = 'none';
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
            res.json(answer);
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
    if (nodejsapiState.authenticated) {
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
 * @apiDescription Return the status of login to client.
 *
 * @api {get} /csgoapi/v1.0/loginStatus
 * @apiVersion 1.0
 * @apiName LoginStatus
 * @apiGroup Auth
 *
 * @apiSuccess {Boolean} login
 * @apiSuccessExample {json} login
 *     HTTP/1.1 200 OK
 *     { "login": true/false }
 */
app.get('/csgoapi/v1.0/loginStatus', (req, res) => {
    if(req.user && cfg.admins.includes(req.user.identifier)) {
        res.json({ "login": true });
    } else {
        res.json({ "login": false });
    }
});

/**
 * @apiDescription Manually Authenticate RCON
 *
 * @api {get} /csgoapi/v1.0/authenticate
 * @apiVersion 1.0
 * @apiName Authenticate
 * @apiGroup RCON
 *
 * @ApiSuccess {boolean} authneticated
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "authenticated": true/false }
 */
app.get('/csgoapi/v1.0/authenticate', ensureAuthenticated, (req, res) => {
    authenticate().then((data) => {
        res.json(data);
    }).catch((data) => {
        res.json(data);
    });
});

/**
 * @apiDescription serverData request
 *
 * @api {get} /csgoapi/v1.0/info/serverInfo
 * @apiVersion 1.0
 * @apiName serverInfo
 * @apiGroup Info
 *
 * @apiSuccess {json} serverInfo object (see './serverInfo.js' for example)
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 503 Service Unavailable
 *     { "error": "RCON not authenticated" }
 */
app.get('/csgoapi/v1.0/info/serverInfo', ensureAuthenticated, (req, res) => {
    logger.verbose('Processing Serverinfo request.');
    if (nodejsapiState.authenticated) {
        res.json(serverInfo.getAll());
    } else if (!nodejsapiState.serverRunning) {
        res.status(503).json({ "error": "CS:GO Server not running." });
    } else if (!nodejsapiState.authenticated) {
        res.status(503).json({ "error": "RCON not authenticated." });
    }
});

/**
 * @apiDescription Query if CS:GO server is running.
 *
 * @api {get} /csgoapi/v1.0/info/runstatus
 * @apiVersion 1.0
 * @apiName RunStatus
 * @apiGroup Info
 *
 * @apiSuccess {boolean} running
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "running": true/false}
 */
app.get('/csgoapi/v1.0/info/runstatus', ensureAuthenticated, (req, res) => {
    if (nodejsapiState.operationPending == 'start' || nodejsapiState.operationPending == 'stop') {
    let sendResponse = (type, action) => {
            if (type == 'auth' && action == 'end') {
                res.json({ "running": nodejsapiState.serverRunning });
                controlEmitter.removeListener('exec', sendResponse);
            }
        }
        controlEmitter.on('exec', sendResponse)
    } else {
        res.json({ "running": nodejsapiState.serverRunning });
    }
});

/**
 * @apiDescription Query if RCON is authenticated
 *
 * @api {get} /csgoapi/v1.0/info/rconauthstatus
 * @apiVersion 1.0
 * @apiName RconAuthStatus
 * @apiGroup Info
 *
 * @apiSuccess {boolean} rconauth
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "rconauth": true/false}
 */
app.get('/csgoapi/v1.0/info/rconauthstatus', ensureAuthenticated, (req, res) => {
    if (nodejsapiState.operationPending == 'auth') {
        let sendResponse = (type, action) => {
            if (type == 'auth' && action == 'end') {
                res.json({ "rconauth": nodejsapiState.authenticated });
                controlEmitter.removeListener('exec', sendResponse);
            }
        }
        controlEmitter.on('exec', sendResponse)
    } else {
        res.json({ "rconauth": nodejsapiState.authenticated });
    }
});

/**
 * @apiDescription Get filter info.
 *
 */
app.get('/csgoapi/v1.0/filter', ensureAuthenticated, (req, res) => {
    res.json({ "type": serverInfo.mapFilterType, "filters": serverInfo.mapFilters });
});

/**
 * @apiDescription Reset filter.
 *
 */
app.get('/csgoapi/v1.0/filter/reset', ensureAuthenticated, (req, res) => {
    serverInfo.mapFilterReset();
    res.json({ "success": true });
});

/**
 * @apiDescription Add filter.
 *
 */
app.post('/csgoapi/v1.0/filter/add', ensureAuthenticated, (req, res) => {
    serverInfo.mapFilterAdd(req.query.filter);
    res.json({ "success": true });
});

/**
 * @apiDescription Start CS:GO Server
 *
 * @api {get} /csgoapi/v1.0/control/start
 * @apiVersion 1.0
 * @apiName Start
 * @apiGroup Control
 *
 * @apiParam {string} mapname filename of the map without extension (.bsp)
 * @apiParamExample {string} Map-example
 *     cs_italy
 *
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 503 Service Unavailable
 *     { "error": "Server already running" }
 */
app.get('/csgoapi/v1.0/control/start', ensureAuthenticated, (req, res) => {
    var args = req.query;

    if (!nodejsapiState.serverRunning && nodejsapiState.operationPending == 'none') {
        controlEmitter.emit('exec', 'start', 'start');
        logger.verbose('Starting server.');
        let startMap = 'de_dust2';
        const safe = /^[a-zA-Z0-9-_]*$/;
        if (!safe.test(args.startmap)) {
            logger.warn(`Supplied mapname ${args.startmap} is not safe, using de_dust2`);
        } else {
            startMap = args.startmap;
        }
        let commandLine = `${cfg.serverCommandline} +map ${startMap}`;
        let serverProcess = exec(commandLine, (error, stdout, stderr) => {
            if (error) {
                // node couldn't execute the command.
                res.status(501).json({ "error": error.code });
                logger.error('Error Code: '+error.code);
                logger.error('Signal received: '+error.signal);
                logger.error(stderr);
                nodejsapiState.serverRunning = false;
                controlEmitter.emit('exec', 'start', 'fail');
            } else {
                logger.verbose('screen started');
                controlEmitter.on('exec', function startCallback (operation, action) {
                    if (operation == 'auth' && action == 'end' && nodejsapiState.authenticated == true) {
                        controlEmitter.emit('exec', 'start', 'end');
                        res.json({ "success": true });
                        controlEmitter.removeListener('exec', startCallback);
                    } else if (operation == 'auth' && action == 'end' && nodejsapiState.authenticated == false) {
                        res.status(501).json({ "error": "RCON Authentication failed." });
                        controlEmitter.emit('exec', 'start', 'fail');
                        controlEmitter.removeListener('exec', startCallback);
                    }
                });
                nodejsapiState.serverRunning = true;
            }
        });
    } else if (nodejsapiState.serverRunning) {
        logger.warn('Start triggered with server already running');
        res.status(503).json({ "error": "Server already running." });
    } else if (nodejsapiState.operationPending != 'none') {
        logger.warn(`Server Start triggered, while ${nodejsapiState.operationPending} pending.`);
        res.status(503).json({ "error": `Another Operation is Pending: ${nodejsapiState.operationPending}` });
    }
});

/**
 * @apiDescription Stop CS:GO Server
 *
 * @api {get} /csgoapi/v1.0/control/stop
 * @apiVersion 1.0
 * @apiName Stop
 * @apiGroup Control
 
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 503 Service Unavailable
 *     { "error": "Server not running" }
 */
app.get('/csgoapi/v1.0/control/stop', ensureAuthenticated, (req, res) => {
    if (nodejsapiState.serverRunning && nodejsapiState.operationPending == 'none') {
        controlEmitter.emit('exec', 'stop', 'start');
        logger.verbose("sending quit.");
        executeRcon('quit').then((answer) => {
            nodejsapiState.serverRunning = false;
            nodejsapiState.authenticated = false;
            res.json({ "success": true });
            controlEmitter.emit('exec', 'stop', 'end');
        }).catch((err) => {
            logger.error('Stopping server Failed: ' + err);
            res.status(501).json({ "error": `RCON Error: ${err.toString()}` });
            controlEmitter.emit('exec', 'stop', 'end');
        });
    } else if (!nodejsapiState.serverRunning) {
        logger.warn('Stop triggered, although server not running');
        res.status(503).json({ "error": "Server not running." });
    } else if (nodejsapiState.operationPending != 'none') {
        logger.warn(`Stop triggered, while ${nodejsapiState.operationPending} pending.`);
        res.status(503).json({ "error": `Another Operation is Pending: ${nodejsapiState.operationPending}` });
    }
});

/**
 * @apiDescription Kill CS:GO Server Process in case no RCON connection.
 *
 * @api {get} /csgoapi/v1.0/control/kill
 * @apiVersion 1.0
 * @apiName Kill
 * @apiGroup Control
 
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 501 Service Unavailable
 *     { "error": "Could not find csgo server process" }
 */
 app.get('/csgoapi/v1.0/control/kill', ensureAuthenticated, (req, res) => {
    exec('/bin/ps -a |grep srcds_linux', (error, stdout, stderr) => {
        if (error) {
            logger.error(`exec error: ${error}`);
            res.status(501).json({ "error": "Could not find csgo server process" });
        } else if (stdout.match(/srcds_linux/) != null) {
            let pid = stdout.split(/\s+/)[1];
            exec(`/bin/kill ${pid}`, (error, stdout, stderr) => {
                if (error) {
                    res.status(501).json({ "error": "Could not kill csgo server process" });
                } else {
                    // reset API-State
                    nodejsapiState.serverRunning = false;
                    nodejsapiState.authenticated = false;
                    nodejsapiState.serverRcon = undefined;
                    logger.verbose('Server process killed.')
                    res.json({ "success": true });
                }
            });
        }
    });
});

/**
 * @apiDescription Update CS:GO Server
 *
 * @api {get} /csgoapi/v1.0/control/update
 * @apiVersion 1.0
 * @apiName Update
 * @apiGroup Control
 
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 501 Internal Server Error
 *     { "error": "Update could not be started." }
 */
app.get('/csgoapi/v1.0/control/update', ensureAuthenticated, (req, res) => {
    if (!nodejsapiState.serverRunning && nodejsapiState.operationPending == 'none') {
        controlEmitter.emit('exec', 'update', 'start');
        let updateSuccess = false;
        logger.verbose('Updating Server.');
        let updateProcess = pty.spawn(cfg.updateCommand, cfg.updateArguments);

        updateProcess.on('data', (data) => {
            logger.debug(data);
            if (data.indexOf('Checking for available updates') != -1) {
                controlEmitter.emit('progress', 'Checking Steam client updates', 0);
            } else if (data.indexOf('Verifying installation') != -1) {
                controlEmitter.emit('progress', 'Verifying client installation', 0);
            } else if (data.indexOf('Logging in user') != -1) {
                controlEmitter.emit('progress', 'Logging in steam user', 0);
            } else if (data.indexOf('Logged in OK') != -1) {
                controlEmitter.emit('progress', 'Login OK', 100);
            } else if(data.indexOf('Update state (0x') != -1) {
                let rex = /Update state \(0x\d+\) (.+), progress: (\d{1,3})\.\d{2}/;
                let matches = rex.exec(data);
                controlEmitter.emit('progress', matches[1], matches[2]);
            } else if (data.indexOf('Downloaaction update (') != -1) {
                let rex = /\[(.+)] Downloaaction update/;
                let matches = rex.exec(data);
                controlEmitter.emit('progress', 'Updating Steam client', matches[1].slice(0, -1));
            } else if (data.indexOf('Success!') != -1) {
                controlEmitter.emit('progress', 'Update successful!', 100);
                logger.verbose('Update succeeded');
                updateSuccess = true;
                controlEmitter.emit('exec', 'update', 'end');
            }
        });

        if (updateProcess) {
            if (cfg.webSockets) {
                res.json(`{ "success": true }`);
                updateProcess.once('close', (code) => {
                    if (!updateSuccess) {
                        logger.warn('Update exited without success.');
                        controlEmitter.emit('progress', 'Update failed!', 100);
                        controlEmitter.emit('exec', 'update', 'end');
                    }
                });
            } else {
                updateProcess.once('close', (code) => {
                    if (updateSuccess) {
                        res.json({ "success": true });
                    } else {
                        logger.warn('Update exited without success.');
                        res.status(501).json({ "error": "Update was not successful" });
                    }
                    controlEmitter.emit('exec', 'update', 'end');
                });
            }
        } else {
            logger.error('Update could not be started.');
            res.status(501).json({ "error": "Update could not be started." });
            controlEmitter.emit('exec', 'update', 'end');
        }
    } else if (nodejsapiState.serverRunning) {
        logger.warn('Update triggered, while server running.');
        res.status(503).json({ "error": "Server is running - stop before updating" });
    } else if (nodejsapiState.operationPending != 'none') {
        logger.warn(`Update triggered, while ${nodejsapiState.operationPending} pending`);
        res.status(503).json({ "error": `Another Operation is Pending: ${nodejsapiState.operationPending}` });
    }
});

//change map
/**
 * @apiDescription Change Map
 *
 * @api {get} /csgoapi/v1.0/control/changemap
 * @apiVersion 1.0
 * @apiName changemap
 * @apiGroup Control
 
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 501 Internal Server Error
 *     { "error": "RCON error: Unable to write to socket" }
 */
app.get('/csgoapi/v1.0/control/changemap', ensureAuthenticated, (req, res) => {
    var args = req.query;
    if (nodejsapiState.operationPending == 'none') {
        controlEmitter.emit('exec', 'mapchange', 'start');
        // only try to change map, if it exists on the server.
        if (serverInfo.mapsAvail.includes(args.map)) {
            executeRcon(`map ${args.map}`).then((answer) => {
                if (!cfg.webSockets) {
                    // If the mapchange completed, send success and cancel timeout.
                    let sendCompleted = (operation, action) => {
                        if (operation == 'mapchange' && action == 'end') {
                            res.json({ "success": true });
                            clearTimeout(mapchangeTimeout);
                        }
                    };
                    controlEmitter.once('exec', sendCompleted);

                    // Failure of a mapchange is unfortunately not logged by the server,
                    // so we use a timeout after 30 sec.
                    let mapchangeTimeout = setTimeout( () => {
                        res.status(501).json({ "error": "Mapchange failed - timeout" });
                        controlEmitter.emit('exec', 'mapchange', 'fail');
                    }, 30000);
                } else {
                    res.json({ "success": true });
                    // If the mapchange is successful, cancel the timeout.
                    let removeTimeout = (operation, action) => {
                        if (operation == 'mapchange' && action == 'end') {
                            clearTimeout(mapchangeTimeout);
                        }
                    };
                    controlEmitter.once('exec', removeTimeout);

                    // Failure of a mapchange is unfortunately not logged by the server,
                    // so we use a timeout after 30 sec.
                    let mapchangeTimeout = setTimeout( () => {
                        controlEmitter.emit('exec', 'mapchange', 'fail');
                    }, 30000);
                }
            }).catch((err) => {
                res.status(501).json({ "error": `RCON error: ${err.toString()}`});
                controlEmitter.emit('exec', 'mapchange', 'fail');
            });
        } else {
            res.status(501).json({ "error": `Map ${args.map} not available` });
            controlEmitter.emit('exec', 'mapchange', 'fail');
        }
    } else {
        logger.warn(`Mapchange triggered, while ${nodejsapiState.operationPending} pending.`);
        res.status(503).json({ "error": `Another Operation is Pending: ${nodejsapiState.operationPending}` });
    }
});

/**
 * @apiDescription Reload availbale maps from server.
 *
 * @api {get} /csgoapi/v1.0/control/reloadmaplist
 * @apiVersion 1.0
 * @apiName reloadmaplist
 * @apiGroup Control

 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 */
app.get('/csgoapi/v1.0/control/reloadmaplist', ensureAuthenticated, (req, res) => {
    reloadMaplist().then( (answer) => {
        res.json(answer);
    });
});

/**
 * @apiDescription Process rcon requests
 *
 * @api /csgoapi/v1.0/rcon
 * @apiVersion 1.0
 * @apiName Rcon
 * @apiGroup Rcon
 *
 * @apiParam {string} message RCON Command to execute.
 * @apiParamExample {string}
 *     'mp_limitteams 0'
 *
 * @apiSuccess {string} answer Servers answer string to RCON request
 * @apiSuccessExample {string}
 *     "mp_maxrounds" = "30" ( def. "0" ) min. 0.000000 game notify replicated          - max number of rounds to play before server changes maps
 *     L 11/06/2020 - 19:05:14: rcon from "127.0.0.1:54598": command "mp_maxrounds"
 * @apiError {string} errortext
 * @apiErrorExample {string}
 *     'Error, check server logs for details.'
 */
app.get('/csgoapi/v1.0/rcon', ensureAuthenticated, (req, res) => {
    var message = req.query.message;
    res.set('Content-Type', 'text/plain');
    executeRcon(message).then((answer) => {
        res.send(answer);
    }).catch( (err) => {
        res.status(501).send('Error, check server logs for details.');
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
            if (message.search('infoRequest') != -1) {
                sendUpdate();
            }
        });

        /**
         * Listens for changed serverInfo and calls function to forward them.
         * @listens serverInfo.serverInfoChanged#change
         */
        serverInfo.serverInfoChanged.on('change', sendUpdate);

        /**
         * Notifies clients of start or end of a control operation
         * @param {string} operation (start, stop, update, mapchange)
         * @param {string} action (start, end, fail)
         */
        var sendControlNotification = (operation, action) => {
            ws.send(`{ "type": "commandstatus", "payload": { "operation": "${operation}", "state": "${action}" } }`);
            // For backward compatibility, this is still sent, will be deleted with version 1.0
            if (operation == 'mapchange' && action != 'start') {
                ws.send(`{ "type": "mapchange", "payload": { "success": ${(action == 'end')} } }`);
            }
        }
        /**
         * Listens for execution notification of control operations.
         * @listens controlEmitter#exec
         */
        controlEmitter.on('exec', sendControlNotification);

        /** 
         * Reports update progress to clients.
         * @param {string} action - Reports, which action is in progress during the update.
         * @param {int} progress - Integer representing the percentage of the action that is completed.
         */
        var reportProgress = (action, progress) => {
            ws.send(`{ "type": "progress", "payload": { "step": "${action}", "progress": ${progress} } }`);
        }
        /**
         * Listens for progress reporst from update process and sends them to the client.
         * @listens controlEmitter#progress
         */
        controlEmitter.on('progress', reportProgress);

        /**
         * Listens for Websocket to close and removes listeners.
         * @listens ws#close
         */
        ws.on('close', (code, reason) => {
            serverInfo.serverInfoChanged.removeListener('change', sendUpdate);
            controlEmitter.removeListener('exec', sendControlNotification);
            controlEmitter.removeListener('progress', reportProgress);
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
 * @emits controlEmitter#exec
 */
receiver.on('data', (data) => {
    if (data.isValid) {
        // Start authentication, when not authenticated.
        if ((data.message.indexOf('Log file started') != -1) && !nodejsapiState.authenticated) {
            // Start of logfile
            // L 08/13/2020 - 21:48:49: Log file started (file "logs/L000_000_000_000_27015_202008132148_000.log") (game "/home/user/csgo_ds/csgo") (version "7929")
            logger.verbose('start authenticating RCON');
            // Since authentication is a vital step for the API to work, we start it automatically
            // once the server runs.
            authenticate().then((data) => {
                logger.verbose(`authentication ${data.authenticated}`);
            }).catch((data) => {
                logger.verbose(`authentication ${data.authenticated}`);
            });
            if (cfg.script('logStart') != '') {
                exec(cfg.script('logStart'));
            }
        } else if (data.message.indexOf('Started map') != -1) {
            // Start of map.
            // 'L 12/29/2005 - 13:33:49: Started map "cs_italy" (CRC "1940414799")
            let rex = /Started map \"(\S+)\"/g;
            let matches = rex.exec(data.message);
            let mapstring = matches[1];
            mapstring = cutMapName(mapstring);
            serverInfo.map = mapstring;
            // since 'started map' is also reported on server-start, only emit on mapchange.
            if (nodejsapiState.operationPending == 'mapchange') {
                controlEmitter.emit('exec', 'mapchange', 'end');
            }
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
            if (data.message.indexOf('entered the game') != -1) {
                serverInfo.addPlayer( {'name': matches[1], 'steamID': matches[2]} );
            } else if (data.message.search(/disconnected \(reason/) != -1) {
                serverInfo.removePlayer(matches[2]);
            } else if (data.message.indexOf('switched from team') != -1) {
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
receiver.on('invalid', (invalidMessage) => {
    logger.verbose('Got some completely unparseable gargbase: ' + invalidMessage);
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
        logger.error('Error getting Maxrounds: ' + err);
    });
}

/**
 * Extracts all matches for a regex.
 * @param {string} string - String to search.
 * @param {regex} regex   - Regex to execute on the string.
 * @param {integer} index - Optional index which capturing group should be retreived.
 * @returns {string[]} matches - Array holaction the found matches.
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
