/**
 * @file CS:GO Dedicated Server Control
 * @author Markus Adrario <mozilla@adrario.de>
 * @version 0.4
 * @requires rcon-srcds
 * @requires srcds-log-receiver
 * @requires http
 * @requires ws
 * @requires url
 * @requires events
 * @requires node-pty
 * @requires child_process
 * @requires ./serverInfo.js
 * @requires ./config.js
 */

const rcon = require('rcon-srcds');
const logReceiver = require('srcds-log-receiver');
const webSocket = require('ws')
const url = require('url');
const fs = require('fs');
const events = require('events');
const pty = require('node-pty');
const { exec, spawn } = require('child_process');
const si = require('./serverInfo.js');
const config = require('./config.js');

/**
 * Stores the state of the controlled server-instance.
 * @property {boolean}  operationPending - Is a control operation pending.
 * @property {boolean}  serverRunning    - Is the server process running.
 * @property {object}   serverRcon       - rcon-srcds instance for the server.
 * @property {boolean}  authenticated    - Is the rcon instance authenticated with the server.
 */
var state = {
    'operationPending': false,
    'serverRunning': false,
    'serverRcon': undefined,
    'authenticated': false
}
var serverInfo = new si();
var cfg = new config();
var localIP = require('local-ip')(cfg.iface);
var http = undefined;
var httpOptions = {};
// if configured for https, we fork here.
if (cfg.useHttps) {
    http = require('https');
    httpOptions = { 
        key: fs.readFileSync(cfg.httpsPrivateKey),
        cert: fs.readFileSync(cfg.httpsCertificate),
    };
    if (cfg.httpsCa != '') {
        httpOptions.ca = fs.readFileSync(cfg.httpsCa)
    }
} else {
    http = require('http');
}

// check for running Server on Startup
exec('/bin/ps -a', (error, stdout, stderr) => {
    if (error) {
      console.error(`exec error: ${error}`);
      return;
    }
    if (stdout.match(/srcds_linux/) != null) {
      state.serverRunning = true;
      authenticate();
    }
});


// EventEmitter
var mapChangeEmitter = new events.EventEmitter();
/**
 * Mapchange completed event.
 * @event mapChangeEmitter#completed
 */

var updateEmitter = new events.EventEmitter();
/**
 * Update Progress
 * @event updateEmitter#progress
 * @type {string}
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
    console.log("...success");
    queryMaxRounds();
    // Get current and available maps and store them.
    executeRcon('host_map').then((answer) => {
        let re = /map" = "(\S+)"/;
        let matches = re.exec(answer);
        let mapstring = matches[1];
        serverInfo.map = cutMapName(mapstring);
    });
    executeRcon('maps *').then((answer) => {
        let re = /\(fs\) (\S+).bsp/g;
        let maplist = [];
        let mapsArray = getMatches(answer, re, 1);
        mapsArray.forEach((mapString) => {
            maplist.push(cutMapName(mapString));
        });
        maplist.sort();
        serverInfo.mapsAvail = maplist;
    });
});


/**
 * Authenticate rcon with server
 * @returns {Promise<JSON-string>}- Promise object that yields the result of authentication.
 * @emits authEmitter.authenticated
 */
function authenticate() {
    return new Promise((resolve, reject) => {
        if (!state.operationPending) {
            console.log("authenticating...");
            if (!state.authenticated) {
                state.operationPending = true;
                state.serverRcon = new rcon();
                state.serverRcon.authenticate(cfg.rconPass).then(() => {
                    authEmitter.emit('authenticated');
                    resolve(`{ "authenticated": true }`);
                }).catch((err) => {
                    console.log("authentication error: " + err);
                    reject(`{ "authenticated": false }`);
                    console.log("...failed");
                });
                state.operationPending = false;

            } else {
                authEmitter.emit('authenticated');
                resolve(`{ "authenticated": true }`);
            }
        }
    });
}

/**
 * Executes a rcon command
 * @param   {string}           message - The rcon command to execute
 * @returns {Promise<string>}          - Promise Object that contains the rcon response or an error message.
 */
function executeRcon (message) {
    console.log(`Executing rcon: ${message}`);
    return new Promise((resolve, reject) => {
        state.serverRcon.execute(message).then((answer) => {
            resolve(answer);
        }).catch((err) => {
            console.log(`rcon Error: ${err}`);
            reject(err.message);
        });
    });
}


/*----------------- HTTP Server Code -------------------*/
/**
 * Creates a http server to communicate with a webInteraface.
 */
http.createServer(httpOptions, (req, res) => {
    var myUrl = url.parse(req.url, true);

    // Process "control" messages.
    if (myUrl.pathname == "/control") {
        var args = myUrl.query;
        res.setHeader("Access-Control-Allow-Origin", "*");

        // Start Server
        if (args.action == "start" && !state.serverRunning && !state.operationPending) {
            state.operationPending = true;
            console.log('starting server.');
            let startMap = args.startmap || "de_dust2";
            let commandLine = `${cfg.serverCommandline} +map ${startMap}`;
            var serverProcess = exec(commandLine, function(error, stdout, stderr) {
                if (error) {
                    // node couldn't execute the command.
                    res.writeHeader(200, {"Content-Type": "application/json"});
                    res.write('{ "success": false }');
                    res.end();
                    console.log('Error Code: '+error.code);
                    console.log('Signal received: '+error.signal);
                    console.log(stderr);
                    state.serverRunning = false;
                    state.operationPending = false;
                } else {
                    console.log('screen started');
                    authEmitter.once('authenticated', () => {
                        res.writeHeader(200, {"Content-Type": "application/json"});
                        res.write(`{ "success": true }`);
                        res.end();
                    });
                    state.serverRunning = true;
                    state.operationPending = false;
                }
            });

        // Stop Server
        } else if (args.action == "stop" && !state.operationPending) {
            state.operationPending = true;
            console.log("sending quit.");
            executeRcon('quit').then((answer) => {
                state.serverRunning = false;
                state.authenticated = false;
                res.writeHeader(200, {"Content-Type": "application/json"});
                res.write(`{ "success": ${!state.serverRunning} }`);
                res.end();
                state.operationPending = false;
            }).catch((err) => {
                console.log('Stopping server Failed: ' + err);
                res.writeHeader(200, {"Content-Type": "application/json"});
                res.write(`{ "success": ${!state.serverRunning} }`);
                res.end();
                state.operationPending = false;
            });

        //Update Server
        } else if (args.action == "update" && !state.updating && !state.running && !state.operationPending) {
            state.operationPending = true;
            let updateSuccess = false;
            console.log('Updating Server.');
            let updateProcess = pty.spawn(cfg.updateCommand, cfg.updateArguments);
            updateProcess.on('data', (data) => {
                console.log(data);
                if (data.indexOf('Update state (0x') != -1) {
                    let rex = /Update state \(0x\d+\) (.+), progress: (\d{1,2})\.\d{2}/;
                    let matches = rex.exec(data);
                    updateEmitter.emit('progress', matches[1], matches[2]);
                } else if (data.indexOf('Success!') != -1) {
                    console.log('update succeeded');
                    updateSuccess = true;
                    state.operationPending = false;
                }
            });
            updateProcess.once('close', (code) => {
                res.writeHeader(200, {"Content-Type": "application/json"});
                res.write(`{ "success": ${updateSuccess} }`);
                res.end();
                updateProcess.removeAllListeners();
                state.operationPending = false;
            });

        // Send Status
        } else if (args.action == "status") {
            res.writeHeader(200, {"Content-Type": "application/json"});
            res.write(`{ "running": ${state.serverRunning && state.authenticated} }`);
            res.end();

        //change map
        } else if (args.action == "changemap" && !state.operationPending) {
            state.operationPending = true;
            res.setHeader("Access-Control-Allow-Origin", "*");
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
                            state.operationPending = false;
                        };
                        mapChangeEmitter.once('result', sendCompleted);

                        // A mapchange should not take longer than 30 sec.
                        let mapchangeTimeout = setTimeout( () => {
                            mapChangeEmitter.emit('result', 'timeout');
                            res.write(`{ "success": false }`);
                            res.end();
                            state.operationPending = false;
                        }, 30000);
                    } else {
                        res.write(`{ "success": true }`);
                        res.end();
                        // If the mapchange is successful, cancel the timeout.
                        var removeTimeout = (result) => {
                            clearTimeout(mapchangeTimeout);
                            state.operationPending = false;
                        };
                        mapChangeEmitter.once('result', removeTimeout);

                        // A mapchange should not take longer than 30 sec.
                        let mapchangeTimeout = setTimeout( () => {
                            mapChangeEmitter.emit('result', 'timeout');
                            state.operationPending = false;
                        }, 30000);
                    }
                }).catch((err) => {
                    res.write(`{ "success": false }`);
                    res.end();
                    state.operationPending = false;
                });
            } else {
                res.write(`{ "success": false }`);
                res.end();
                state.operationPending = false;
            }

        // DEPRECATED - will be removed in future release, do not use.
        // follow mapchange
        } else if (args.action == "mapstart") {
            mapChangeEmitter.once('result', (result) => {
                res.writeHeader(200, {"Content-Type": "application/json"});
                res.write(`{ "completed": ${result == 'success'} }`);
                res.end();
            });
        }

    // Process "authenticate" message.
    } else if (myUrl.pathname == "/authenticate") {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.writeHeader(200, {"Content-Type": "application/json"});
        authenticate().then((data) => {
            res.write(data);
            res.end();
        }).catch((err) => {
            res.write(data);
            res.end();
        });

    // Process rcon requests
    } else if (myUrl.pathname == "/rcon") {
        var message = myUrl.query.message;
        executeRcon(message).then((answer) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.writeHeader(200, { 'Content-Type': 'text/plain' });
            res.write(answer);
            res.end();
        }).catch( (err) => {
            res.setHeader("Access-Control-Allow-Origin", "*");
            res.writeHeader(200, { 'Content-Type': 'text/plain' });
            res.write("Error: " + err);
            res.end();
        });

    // Process serverData request
    } else if (myUrl.pathname == "/serverInfo") {
        console.log('Processing Serverinfo request.');
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.writeHeader(200, {"Content-Type": "application/json"});
        if (state.authenticated) {
            res.write(JSON.stringify(serverInfo.getAll()));
            res.end();
        } else {
            res.write('{ "error": true }');
            res.end();
        }
    } else {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.writeHeader(200, { 'Content-Type': 'text/plain' });
        res.write('command ignored');
    }
}).listen(8090);

/*----------------- WebSockets Code -------------------*/
const wssServer = http.createServer(httpOptions);
const wss = new webSocket.Server({ server: wssServer });

/**
 * Websocket to send data updates to a webClient.
 */
wss.on('connection', (ws) => {
    // Helper function to send ServerInfo to client.
    /**
     * Sends updated serverInfo to clients.
     */
    var sendUpdate = () => {
        ws.send(`{ "type": "serverInfo", "payload": ${JSON.stringify(serverInfo.getAll())} }`);
    }

    // React to requests.
    /**
     * Listens for messages on Websocket.
     * @listens ws#message
     */
    ws.on('message', (message) => {
        if (message.search("infoRequest") != -1) {
            sendUpdate();
            //ws.send(`{ "type": "serverInfo", "payload": ${JSON.stringify(serverInfo.getAll())} }`);
        }
    });

    /**
     * Listens for changed serverInfo and calls function to forward them.
     * @listens serverInfo.serverInfoChanged#change
     */
    serverInfo.serverInfoChanged.on('change', sendUpdate);

    // Report update progress to clients.
    var reportProgress = (action, progress) => {
        ws.send(`{ "type": "updateProgress", "payload": { "step": "${action}", "progress": ${progress} } }`);
    }
    /**
     * Listens for progress reporst from update process and sends them to the client.
     * @listens updateEmitter#progress
     */
    updateEmitter.on('progress', reportProgress);

    // Send info on completed mapchange.
    var sendMapchangeComplete = (result) => {
        ws.send(`{ "type": "mapchange", "payload": { "success": ${result == 'success'} } }`);
        state.operationPending = false;
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

wssServer.listen(8091, () => {
    let host = '';
    if (cfg.host != '') {
        host = cfg.host;
        console.log(cfg.host);
    } else {
        host = localIP;
        console.log(localIP);
    }

    if(cfg.useHttps) {
        const ws = new webSocket(`wss://${host}:${wssServer.address().port}`);
    } else {
        const ws = new webSocket(`ws://${host}:${wssServer.address().port}`);
    }
});

/*----------------- log receiving code --------------------*/
// Since we only control locally installed servers and server logging is not working on
// 'localhost', we use the ip-address of the interface configured.
console.log("local IP is: " + localIP);
var logOptions = {
    address: localIP
};

/**
 * Receives logs from the Gameserver
 * @emits receiver#data
 */
var receiver = new logReceiver.LogReceiver(logOptions);
/**
 * React to authenticated message from server.
 * @listens receiver#data
 */
receiver.on('data', (data) => {
    if (data.isValid) {
        // Start authentication, when not authenticated.
        if ((data.message.indexOf("Log file started") != -1) && !state.authenticated) {
            // Start of logfile
            // L 08/13/2020 - 21:48:49: Log file started (file "logs/L000_000_000_000_27015_202008132148_000.log") (game "/home/user/csgo_ds/csgo") (version "7929")
            console.log("start authenticating");
            authenticate();
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
            console.log(`Started map: ${mapstring}`);
            serverInfo.clearPlayers();
            serverInfo.newMatch();
            if (cfg.script('mapStart') != '') {
                exec(cfg.script('mapStart'));
            }
        } else if (data.message.indexOf('World triggered "Match_Start" on') != -1) {
            // Start of a new match.
            // L 08/13/2020 - 21:49:26: World triggered "Match_Start" on "de_nuke"
            console.log('detected match start.');
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
            if (cfg.script('logEnd') != '') {
                exec(cfg.script('logEnd'));
            }
        }
    }
});
receiver.on('invalid', function(invalidMessage) {
    console.log("Got some completely unparseable gargbase: " + invalidMessage);
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
        console.log("Error getting Maxrounds: " + err);
    });
}

/**
 * Extracts all matches for a regex.
 * @param {string} string - String to search.
 * @param {regex} regex   - Regex to execute on the string.
 * @param {integer} index - Optional index which capturing group should be retreived.
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
