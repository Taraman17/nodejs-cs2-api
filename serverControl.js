/**
 * @file CS:GO Dedicated Server Control
 * @author Markus Adrario <mozilla@adrario.de>
 * @version 1.0
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
 * @requires child_process
 * @requires ./modules/logger.js
 * @requires ./modules/serverInfo.js
 * @requires ./modules/configClass.js
 * @requires ./modules/sharedFunctions.js
 */

const logReceiver = require('srcds-log-receiver');
const express = require('express');
const session = require('express-session');
const rateLimit = require('express-rate-limit');
const cors = require('cors');
const passport = require('passport');
const SteamStrategy = require('passport-steam').Strategy;
const BasicStrategy = require('passport-http').BasicStrategy;
const webSocket = require('ws');
const url = require('url');
const fs = require('fs');
const events = require('events');
const { exec } = require('child_process');
const logger = require('./modules/logger.js');
var serverInfo = require('./modules/serverInfo.js');
var cfg = require('./modules/configClass.js');
const sf = require('./modules/sharedFunctions.js');

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

// check for running Server on Startup
exec('/bin/ps -a', (error, stdout, stderr) => {
    if (error) {
        logger.error(`exec error: ${error}`);
        return;
    }
    if (stdout.match(/srcds_linux/) != null) {
        serverInfo.serverState.serverRunning = true;
        logger.verbose('Found running server');
        sf.authenticate().then((data) => {
            logger.verbose(`authentication ${data.authenticated}`);
        }).catch((data) => {
            logger.verbose(`authentication ${data.authenticated}`);
        });
    }
});

// Event Emitters
var controlEmitter = require('./modules/controlEmitter.js');

/**
 * Sets the operationPending variable on events. Gathers Information on RCON authentication.
 * @listens controlEmitter#exec
 */
controlEmitter.on('exec', (operation, action) => {
    serverInfo.serverState.operationPending = (action == 'start') ? operation : 'none';
    logger.debug('serverInfo.serverState.operationPending = ' + serverInfo.serverState.operationPending);
    if (operation == 'auth' && action == 'end') {
        serverInfo.serverState.authenticated = true;
        logger.debug('serverInfo.serverState.authenticated = ' + serverInfo.serverState.authenticated);
        logger.verbose("RCON Authenticate success");
        queryMaxRounds();
        // Get current and available maps and store them.
        sf.executeRcon('host_map').then((answer) => {
            let re = /map" = "(\S+)"/;
            let matches = re.exec(answer);
            let mapstring = matches[1];
            serverInfo.map = sf.cutMapName(mapstring);
        });
        sf.reloadMaplist().then((answer) => {
            if (answer == '{ "success": false }') {
                logger.warn("Maps could not be loaded");
            }
        });
    }
});

/*----------------- HTTP Server Code -------------------*/
/**
 * Creates an express server to handle the API requests
 */
const app = express();
var apiV10 = require('./modules/apiV10.js');
const limit = rateLimit({
    max: 50, // max requests
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

//--------------------------- Steam authentication ----------------------------//
// Setup Passport for SteamStrategy
passport.serializeUser((user, done) => {
    done(null, user);
});
passport.deserializeUser((obj, done) => {
    done(null, obj);
});

passport.use(
    new SteamStrategy({
            returnURL: `${cfg.scheme}://${cfg.host}:${cfg.apiPort}/csgoapi/login/return`,
            realm: `${cfg.scheme}://${cfg.host}:${cfg.apiPort}/`,
            profile: false
        },
        (identifier, profile, done) => {
            process.nextTick(function() {

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
                'message': `${req.method}:${req.url}`
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
    logger.warn({
        'user': 'unknown',
        'message': `Unauthorized Access from ${req.ip}.`
    });
    return res.status(401).send('Not logged in.');
}

/**
 * @api {get} /csgoapi/login
 * @apiVersion 1.0
 * @apiName Login
 * @apiGroup Auth
 *
 * @apiSuccess (302) Redirect to confiured page.
 * @apiError (302) Redirect to /csgoapi/loginStatus
 */
app.get('/csgoapi/login',
    passport.authenticate('steam', { failureRedirect: '/csgoapi/loginStatus' }),
    (req, res) => {
        res.redirect(cfg.redirectPage);
    }
);
/**
 * @api {get} /csgoapi/login/return
 * @apiVersion 1.0
 * @apiName Login Return
 * @apiGroup Auth
 *
 * @apiSuccess (302) Redirect to confiured page.
 * @apiError (302) Redirect to /csgoapi/loginStatus
 */
app.get('/csgoapi/login/return',
    passport.authenticate('steam', { failureRedirect: '/csgoapi/loginStatus' }),
    (req, res) => {
        res.redirect(cfg.redirectPage);
    }
);
/**
 * @api {get} /csgoapi/logout
 * @apiVersion 1.0
 * @apiName Logout
 * @apiGroup Auth
 *
 * @apiSuccess (302) Redirect to configured page.
 */
app.get('/csgoapi/logout', (req, res) => {
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
 * @api {get} /csgoapi/loginStatus
 * @apiVersion 1.0
 * @apiName LoginStatus
 * @apiGroup Auth
 *
 * @apiSuccess {Boolean} login
 * @apiSuccessExample {json} login
 *     HTTP/1.1 200 OK
 *     { "login": true/false }
 */
app.get('/csgoapi/loginStatus', (req, res) => {
    if (req.user && cfg.admins.includes(req.user.identifier)) {
        res.json({ "login": true });
    } else {
        res.json({ "login": false });
    }
});

app.use('/csgoapi/v1.0/', ensureAuthenticated, apiV10);
//------------------------ END Steam authentication ----------------------------//

//------------------------ Basic authentication ----------------------------//
if (cfg.httpAuth) {
    passport.use(new BasicStrategy({ qop: 'auth', passReqToCallback: true },
        (req, username, password, done) => {
            if (username == cfg.httpUser.username) {
                if (password == cfg.httpUser.password) {
                    logger.http({
                        "user": username,
                        "message": `${req.method}:${req.url}`
                    });
                    return done(null, cfg.httpUser.username);
                } else {
                    logger.warn({
                        'user': username,
                        'message': `Unauthorized http Access - wrong Password - from ${req.ip}.`
                    });
                    return done(null, false);
                }
            } else {
                logger.warn({
                    'user': username,
                    'message': `Unauthorized http Access - unknown user - from ${req.ip}.`
                });
                return done(null, false);
            }
        }
    ));

    app.use('/csgoapi/http/v1.0/', passport.authenticate('basic', { session: false }), apiV10);
}
//--------------------- END Basic authentication --------------------------//

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
            if (message.toString().search('infoRequest') != -1) {
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

        if (cfg.useHttps) {
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
        if ((data.message.indexOf('Log file started') != -1) && !serverInfo.serverState.authenticated) {
            // Start of logfile
            // L 08/13/2020 - 21:48:49: Log file started (file "logs/L000_000_000_000_27015_202008132148_000.log") (game "/home/user/csgo_ds/csgo") (version "7929")
            logger.verbose('start authenticating RCON');
            // Since authentication is a vital step for the API to work, we start it automatically
            // once the server runs.
            sf.authenticate().then((data) => {
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
            mapstring = sf.cutMapName(mapstring);
            serverInfo.map = mapstring;
            // since 'started map' is also reported on server-start, only emit on mapchange.
            if (serverInfo.serverState.operationPending == 'mapchange') {
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
                serverInfo.addPlayer({ 'name': matches[1], 'steamID': matches[2] });
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
    sf.executeRcon('mp_maxrounds').then((answer) => {
        // "mp_maxrounds" = "30" ( def. "0" ) min. 0.000000 game notify replicated
        // - max number of rounds to play before server changes maps
        let rex = /\"mp_maxrounds\" = \"(\d+)\"/g;
        let matches = rex.exec(answer);
        serverInfo.maxRounds = matches[1];
    }).catch((err) => {
        logger.error('Error getting Maxrounds: ' + err);
    });
}