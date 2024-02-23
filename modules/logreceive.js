const express = require('express');
var router = express.Router();
const { exec } = require('child_process');
var controlEmitter = require('./controlEmitter.js');
const logger = require('./logger.js');
var serverInfo = require('./serverInfo.js');
const sf = require('./sharedFunctions.js');
var cfg = require('./configClass.js');

router.post('/log', (req, res) => {
    const data = req.body;
    var logs = data.split(/\r\n|\r|\n/);

    logs.forEach(line => {
        if (line.length >= 20) {
            // Start authentication, when not authenticated.
            if ((line.indexOf('Log file started') != -1) && !serverInfo.serverState.authenticated) {
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
            } else if (line.indexOf('Loading map ') != -1) {
                // Start of map.
                // L 10/13/2023 - 14:28:38: Loading map "de_anubis"
                let rex = /Loading map \"(\S+)\"/g;
                let matches = rex.exec(line);
                let mapstring = matches[1];
                mapstring = sf.cutMapName(mapstring);
                serverInfo.map = mapstring;
                serverInfo.pause = false;
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
            } else if (line.indexOf('World triggered "Match_Start" on') != -1) {
                // Start of a new match.
                // L 08/13/2020 - 21:49:26: World triggered "Match_Start" on "de_nuke"
                logger.verbose('Detected match start.');
                sf.queryMaxRounds();
                serverInfo.newMatch();
                let rex = /World triggered "Match_Start" on "(.+)"/
                let matches = rex.exec(line)
                serverInfo.map = matches[1];
                if (cfg.script('matchStart') != '') {
                    exec(cfg.script('matchStart'));
                }
            } else if (line.indexOf('World triggered "Round_Start"') != -1) {
                // Start of round.
                // L 08/13/2020 - 21:49:28: World triggered "Round_Start"
                if (cfg.script('roundStart') != '') {
                    exec(cfg.script('roundStart'));
                }
            } else if (/Team \"\S+\" scored/.test(line)) {
                // Team scores at end of round.
                // L 02/10/2019 - 21:31:15: Team "CT" scored "1" with "2" players
                // L 02/10/2019 - 21:31:15: Team "TERRORIST" scored "1" with "2" players
                rex = /Team \"(\S)\S+\" scored \"(\d+)\"/g;
                let matches = rex.exec(line);
                serverInfo.score = matches;
            } else if (line.indexOf('World triggered "Round_End"') != -1) {
                // End of round.
                // L 08/13/2020 - 22:24:22: World triggered "Round_End"
                if (cfg.script('roundEnd') != '') {
                    exec(cfg.script('roundEnd'));
                }
            } else if (line.indexOf("Game Over:") != -1) {
                // End of match.
                // L 08/13/2020 - 22:24:22: Game Over: competitive 131399785 de_nuke score 16:9 after 35 min
                if (cfg.script('matchEnd') != '') {
                    exec(cfg.script('matchEnd'));
                }
            } else if (/\".{1,32}<\d{1,3}><\[\w:\d:\d{1,10}\]>/.test(line)) {
                // Player join or teamchange.
                // 10/12/2023 - 16:06:38: "[Klosser] Taraman<2><[U:1:12610374]><>" entered the game
                // 10/12/2023 - 18:57:47: "[Klosser] Taraman<2><[U:1:12610374]>" switched from team <Unassigned> to <CT>
                // 10/12/2023 - 18:59:25: "[Klosser] Taraman<2><[U:1:12610374]>" switched from team <TERRORIST> to <Spectator>
                // 10/16/2023 - 16:31:59.699 - "[Klosser] Taraman<2><[U:1:12610374]><CT>" disconnected (reason "NETWORK_DISCONNECT_DISCONNECT_BY_USER")
                // "Strapper<6><BOT><TERRORIST>"
                let rex = /\"(.{1,32})<\d{1,3}><\[(\w:\d:\d{1,10})\]></g;
                let matches = rex.exec(line);
                if (line.indexOf('entered the game') != -1) {
                    serverInfo.addPlayer({ 'name': matches[1], 'steamID': matches[2] });
                } else if (line.search(/disconnected \(reason/) != -1) {
                    serverInfo.removePlayer(matches[2]);
                } else if (line.indexOf('switched from team') != -1) {
                    rex = /\"(.{1,32})<\d{1,3}><\[(\w:\d:\d{1,10})\]>\" switched from team <\S{1,10}> to <(\S{1,10})>/g;
                    matches = rex.exec(line);
                    serverInfo.assignPlayer(matches[1], matches[2], matches[3]);
                } else if (line.search(/\[\w:\d:\d{1,10}\]><\w{1,10}>\" \[.{1,5} .{1,5} .{1,5}\] killed \".{1,32}<\d{1,3}><\[\w:\d:\d{1,10}\]/) != -1) {
                    rex = /\[(\w:\d:\d{1,10})\]><\w{1,10}>\" \[.{1,5} .{1,5} .{1,5}\] killed \".{1,32}<\d{1,3}><\[(\w:\d:\d{1,10})\]/
                    matches = rex.exec(line);
                    serverInfo.recordKill(matches[1], matches[2]);
                }
            } else if (line.indexOf('Log file closed') != -1) {
                // end of current log file. (Usually on mapchange or server quit.)
                // L 08/13/2020 - 22:25:00: Log file closed
                logger.verbose('logfile closed!');
                if (cfg.script('logEnd') != '') {
                    exec(cfg.script('logEnd'));
                }
            }
        }
    });

    res.status(200).send("Receiving logs");
});

module.exports = router;