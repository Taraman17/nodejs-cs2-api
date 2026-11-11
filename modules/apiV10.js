/**
 * @requires child_process
 * @requires node-pty
 * @requires express
 * @requires express.Router
 * @requires ./logger.js
 * @requires ./config.js
 * @requires ./serverInfo.js
 * @requires ./controlEmitter.js
 * @requires ./sharedFunctions.js
 */

const { exec } = require("child_process");
const pty = require("node-pty");
const express = require("express");
var router = express.Router();
const logger = require("./logger.js");
var cfg = require("./configClass.js");
var serverInfo = require("./serverInfo.js");
var controlEmitter = require("./controlEmitter.js");
const sf = require("./sharedFunctions.js");
const dockerUp = require("./dockerUp.js");
const reportUpdateProgress = require("./updateProgress.js");

function waitForAuthResult(res, onSuccess, onFailure) {
  let settled = false;
  let timeout;

  const cleanup = () => {
    clearTimeout(timeout);
    controlEmitter.removeListener("exec", handleAuthResult);
    res.removeListener("close", cleanup);
  };

  const finish = (callback) => {
    if (settled || res.headersSent) {
      return;
    }
    settled = true;
    cleanup();
    callback();
  };

  const handleAuthResult = (operation, action) => {
    if (operation !== "auth") {
      return;
    }
    if (action === "end") {
      finish(onSuccess);
    } else if (action === "fail") {
      finish(onFailure);
    }
  };

  controlEmitter.on("exec", handleAuthResult);
  res.once("close", cleanup);
  timeout = setTimeout(() => finish(onFailure), 60000);
}

//--------------------------- V1.0 ----------------------------//
/**
 * @apiDescription Manually Authenticate RCON
 *
 * @api {get} /authenticate
 * @apiVersion 1.0
 * @apiName Authenticate
 * @apiGroup RCON
 *
 * @ApiSuccess {boolean} authneticated
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "authenticated": true/false }
 */
router.get("/authenticate", (req, res) => {
  sf.authenticate()
    .then((data) => {
      res.json(data);
    })
    .catch((data) => {
      res.json(data);
    });
});

/**
 * @apiDescription serverData request
 *
 * @api {get} /info/serverInfo
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
router.get("/info/serverInfo", (req, res) => {
  logger.verbose("Processing Serverinfo request.");
  if (serverInfo.serverState.authenticated) {
    res.json(serverInfo.getAll());
  } else if (!serverInfo.serverState.serverRunning) {
    res.status(503).json({ error: "CS:GO Server not running." });
  } else if (!serverInfo.serverState.authenticated) {
    res.status(503).json({ error: "RCON not authenticated." });
  }
});

/**
 * @apiDescription Query if CS:GO server is running.
 *
 * @api {get} /info/runstatus
 * @apiVersion 1.0
 * @apiName RunStatus
 * @apiGroup Info
 *
 * @apiSuccess {boolean} running
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "running": true/false}
 */
router.get("/info/runstatus", (req, res) => {
  if (
    serverInfo.serverState.operationPending == "start" ||
    serverInfo.serverState.operationPending == "stop"
  ) {
    waitForAuthResult(
      res,
      () => res.json({ running: serverInfo.serverState.serverRunning }),
      () =>
        res.status(503).json({ error: "Could not determine server status." }),
    );
  } else {
    res.json({ running: serverInfo.serverState.serverRunning });
  }
});

/**
 * @apiDescription Query if RCON is authenticated
 *
 * @api {get} /info/rconauthstatus
 * @apiVersion 1.0
 * @apiName RconAuthStatus
 * @apiGroup Info
 *
 * @apiSuccess {boolean} rconauth
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "rconauth": true/false}
 */
router.get("/info/rconauthstatus", (req, res) => {
  if (serverInfo.serverState.operationPending == "auth") {
    waitForAuthResult(
      res,
      () => res.json({ rconauth: serverInfo.serverState.authenticated }),
      () => res.status(503).json({ error: "RCON authentication failed." }),
    );
  } else {
    res.json({ rconauth: serverInfo.serverState.authenticated });
  }
});

/**
 * @apiDescription Get filter info.
 *
 * @api {get} /filter
 * @apiVersion 1.0
 * @apiName Filter Info
 * @apiGroup filter
 *
 * @apiSuccess {json} Filters
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "type": {string}, "filters": {array of strings} }
 */
router.get("/filter", (req, res) => {
  res.json({ type: serverInfo.mapFilterType, filters: serverInfo.mapFilters });
});

/**
 * @apiDescription Reset filter to empty.
 *
 * @api {get} /filter/reset
 * @apiVersion 1.0
 * @apiName Reset Filters
 * @apiGroup filter
 *
 * @apiSuccess {json} filters
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "type": {string}, "filters": {array of strings} }
 */
router.get("/filter/reset", (req, res) => {
  serverInfo.mapFilterReset();
  res.json({ type: serverInfo.mapFilterType, filters: serverInfo.mapFilters });
});

/**
 * @apiDescription Add a Filter
 *
 * @api {post} /filter/add
 * @apiVersion 1.0
 * @apiName Add filter
 * @apiGroup filter
 *
 * @apiParam {string} filter Filter text
 * @apiParamExample {string} filter
 *     'dz_'
 *
 * @apiSuccess {json} Filters
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "type": {string}, "filters": {array of strings} }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 400 Bad Request
 *     { "error": "Submitted filter text not safe." }
 */
router.post("/filter/add", (req, res) => {
  if (!req.query.filter) {
    return res
      .status(400)
      .json({ error: "Required parameter 'filter' is missing" });
  }

  const safe = /^[a-zA-Z0-9-_]*$/;
  if (!safe.test(req.query.filter)) {
    return res.status(400).json({ error: "Submitted filter text not safe." });
  } else {
    serverInfo.mapFilters.push(req.query.filter);
  }
  res.json({ type: serverInfo.mapFilterType, filters: serverInfo.mapFilters });
});

/**
 * @apiDescription Remove a Filter
 *
 * @api {post} /filter/remove
 * @apiVersion 1.0
 * @apiName Remove filter
 * @apiGroup filter
 *
 * @apiParam {string} filter Filter text
 * @apiParamExample {string} filter
 *     'dz_'
 *
 * @apiSuccess {json} Filters
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "type": {string}, "filters": {array of strings} }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 400 Bad Request
 *     { "error": "No filter was removed." }
 */
router.post("/filter/remove", (req, res) => {
  if (!req.query.filter) {
    return res
      .status(400)
      .json({ error: "Required parameter 'filter' is missing" });
  }

  let oldLength = serverInfo.mapFilters.length;
  serverInfo.mapFilterRemove(req.query.filter);
  if (oldLength == serverInfo.mapFilters.length) {
    return res.status(400).json({ error: "No filter was removed." });
  }
  res.json({ type: serverInfo.mapFilterType, filters: serverInfo.mapFilters });
});

/**
 * @apiDescription Set filter type.
 *
 * @api {post} /filter/type
 * @apiVersion 1.0
 * @apiName Set filter type
 * @apiGroup filter
 *
 * @apiParam {string} type Filter type ('include' / 'exclude')
 * @apiParamExample {string} type
 *     "include"
 *
 * @apiSuccess {json} Filters
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "type": {string}, "filters": {array of strings} }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 400 Bad Request
 *     { "error": "Invalid type string." }
 */
router.post("/filter/type", (req, res) => {
  if (!req.query.type) {
    return res
      .status(400)
      .json({ error: "Required parameter 'type' is missing" });
  }

  if (req.query.type === "include" || req.query.type === "exclude") {
    serverInfo.mapFilterType = req.query.type;
  } else {
    return res.status(400).json({ error: "Invalid type string." });
  }
  res.json({ type: serverInfo.mapFilterType, filters: serverInfo.mapFilters });
});

/**
 * @apiDescription Start CS:GO Server
 *
 * @api {get} /control/start
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
router.get("/control/start", (req, res) => {
  var args = req.query;

  if (
    !serverInfo.serverState.serverRunning &&
    serverInfo.serverState.operationPending == "none"
  ) {
    let action = cfg.type == "docker" ? "update" : "start";
    controlEmitter.emit("exec", action, "start");
    logger.verbose("Starting server.");
    let startMap = "de_dust2";
    const safe = /^[a-zA-Z0-9-_]*$/;
    if (!safe.test(args.startmap)) {
      logger.warn(
        `Supplied mapname ${args.startmap} is not safe, using de_dust2`,
      );
    } else {
      startMap = args.startmap;
    }
    let commandLine = "";
    if (cfg.type == "local") {
      commandLine = `${cfg.serverCommandline} +map ${startMap}`;
    } else if (cfg.type == "docker") {
      commandLine = `${cfg.serverCommandline}`;
    } else {
      logger.error(`Unknown server type in config: ${cfg.type}`);
      res
        .status(501)
        .json({ error: `Unknown server type in config: ${cfg.type}` });
      return;
    }
    logger.info(commandLine);
    exec(commandLine, async (error, stdout, stderr) => {
      if (error) {
        // node couldn't execute the command.
        res.status(501).json({ error: error.code });
        logger.error("Error Code: " + error.code);
        logger.error("Signal received: " + error.signal);
        logger.error(stderr);
        serverInfo.serverState.serverRunning = false;
        controlEmitter.emit("exec", "start", "fail");
      } else {
        logger.verbose("Server started");
        if (cfg.type == "docker") {
          try {
            await dockerUp.dockerUpdate();
          } catch (dockerError) {
            logger.error(
              `Docker log stream could not be started: ${dockerError}`,
            );
            serverInfo.serverState.serverRunning = false;
            controlEmitter.emit("exec", "start", "fail");
            if (!res.headersSent) {
              res.status(501).json({ error: "Docker startup failed." });
            }
            return;
          }
        }
        controlEmitter.on("exec", function startCallback(operation, action) {
          if (
            operation == "auth" &&
            action == "end" &&
            serverInfo.serverState.authenticated == true
          ) {
            res.json({ success: true });
            controlEmitter.removeListener("exec", startCallback);
          } else if (
            operation == "auth" &&
            action == "end" &&
            serverInfo.serverState.authenticated == false
          ) {
            res.status(501).json({ error: "RCON Authentication failed." });
            controlEmitter.emit("exec", "start", "fail");
            controlEmitter.removeListener("exec", startCallback);
          }
        });
        serverInfo.serverState.serverRunning = true;
      }
    });
  } else if (serverInfo.serverState.serverRunning) {
    logger.warn("Start triggered with server already running");
    res.status(503).json({ error: "Server already running." });
  } else if (serverInfo.serverState.operationPending != "none") {
    logger.warn(
      `Server Start triggered, while ${serverInfo.serverState.operationPending} pending.`,
    );
    res.status(503).json({
      error: `Another Operation is Pending: ${serverInfo.serverState.operationPending}`,
    });
  }
});

/**
 * @apiDescription Pause round
 *
 * @api {get} /control/pause
 * @apiVersion 1.0
 * @apiName Pause
 * @apiGroup Control
 *
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 503 Service Unavailable
 *     { "error": "Pause not possible" }
 */
router.get("/control/pause", (req, res) => {
  if (
    serverInfo.serverState.serverRunning &&
    serverInfo.serverState.operationPending == "none"
  ) {
    controlEmitter.emit("exec", "pause", "start");
    logger.verbose("Pausing round.");
    sf.executeRcon("mp_pause_match")
      .then((answer) => {
        // L 10/16/2023 - 16:05:44: Match pause is enabled - mp_pause_match
        logger.debug(answer);
        if (answer.indexOf("Match pause is enabled - mp_pause_match") != -1) {
          serverInfo.pause = true;
          controlEmitter.emit("exec", "pause", "end");
          res.json({ success: true });
        } else {
          logger.info(`Pausing failed: ${answer}`);
          controlEmitter.emit("exec", "pause", "end");
          res.json({ success: false });
        }
      })
      .catch((err) => {
        logger.info(`Pausing failed. Rcon error: ${err.message}`);
        controlEmitter.emit("exec", "pause", "end");
        res.status(503).json({ error: `rcon error` });
      });
  } else if (!serverInfo.serverState.serverRunning) {
    logger.warn("Pause triggered, although server not running");
    res.status(503).json({ error: "Server not running." });
  } else if (serverInfo.serverState.operationPending != "none") {
    logger.warn(
      `Pause triggered, while ${serverInfo.serverState.operationPending} pending.`,
    );
    res.status(503).json({
      error: `Another Operation is Pending: ${serverInfo.serverState.operationPending}`,
    });
  }
});

/**
 * @apiDescription Resume round
 *
 * @api {get} /control/unpause
 * @apiVersion 1.0
 * @apiName Unpause
 * @apiGroup Control
 *
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 503 Service Unavailable
 *     { "error": "Unpause not possible" }
 */
router.get("/control/unpause", (req, res) => {
  if (
    serverInfo.serverState.serverRunning &&
    serverInfo.serverState.operationPending == "none"
  ) {
    controlEmitter.emit("exec", "pause", "start");
    logger.verbose("Resuming round.");
    sf.executeRcon("mp_unpause_match")
      .then((answer) => {
        // L 10/16/2023 - 16:06:08: Match pause is disabled - mp_unpause_match
        if (
          answer.indexOf("Match pause is disabled - mp_unpause_match") != -1
        ) {
          serverInfo.pause = false;
          controlEmitter.emit("exec", "pause", "end");
          res.json({ success: true });
        } else {
          logger.info(`Unpausing failed: ${answer}`);
          controlEmitter.emit("exec", "pause", "end");
          res.json({ success: false });
        }
      })
      .catch((err) => {
        logger.info(`Unpausing failed. Rcon error: ${err}`);
        controlEmitter.emit("exec", "pause", "end");
        res.status(503).json({ error: `RCON Error: ${err.toString()}` });
      });
  } else if (!serverInfo.serverState.serverRunning) {
    logger.warn("Unpause triggered, although server not running");
    res.status(503).json({ error: "Server not running." });
  } else if (serverInfo.serverState.operationPending != "none") {
    logger.warn(
      `Unpause triggered, while ${serverInfo.serverState.operationPending} pending.`,
    );
    res.status(503).json({
      error: `Another Operation is Pending: ${serverInfo.serverState.operationPending}`,
    });
  }
});

/**
 * @apiDescription Stop CS:GO Server
 *
 * @api {get} /control/stop
 * @apiVersion 1.0
 * @apiName Stop
 * @apiGroup Control
 *
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 503 Service Unavailable
 *     { "error": "Server not running" }
 */
router.get("/control/stop", (req, res) => {
  if (
    serverInfo.serverState.serverRunning &&
    serverInfo.serverState.operationPending == "none"
  ) {
    controlEmitter.emit("exec", "stop", "start");
    logger.verbose("sending quit.");
    sf.executeRcon("quit")
      .then((answer) => {
        if (answer.indexOf("CHostStateMgr::QueueNewRequest( Quitting") != -1) {
          // CHostStateMgr::QueueNewRequest( Quitting, 8 )
          // TODO: find out if command quit can fail.
          serverInfo.serverState.serverRunning = false;
          serverInfo.serverState.authenticated = false;
          serverInfo.reset();
          if (cfg.type == "docker") {
            exec(
              `docker compose -f ${cfg.dockerfile} down`,
              (error, stdout, stderr) => {
                if (error) {
                  logger.error(`exec error: ${error}, ${stderr}`);
                } else {
                  logger.verbose("Docker container stopped.");
                }
              },
            );
          }
          res.json({ success: true });
        } else {
          res.status(501).json({ error: `RCON response not correct.` });
          logger.warn(
            "Stopping the server failed - rcon command not successful",
          );
        }
        controlEmitter.emit("exec", "stop", "end");
      })
      .catch((err) => {
        logger.error("Stopping server Failed: " + err);
        res.status(501).json({ error: `RCON Error: ${err.toString()}` });
        controlEmitter.emit("exec", "stop", "end");
      });
  } else if (!serverInfo.serverState.serverRunning) {
    logger.warn("Stop triggered, although server not running");
    res.status(503).json({ error: "Server not running." });
  } else if (serverInfo.serverState.operationPending != "none") {
    logger.warn(
      `Stop triggered, while ${serverInfo.serverState.operationPending} pending.`,
    );
    res.status(503).json({
      error: `Another Operation is Pending: ${serverInfo.serverState.operationPending}`,
    });
  }
});

/**
 * @apiDescription Kill CS:GO Server Process in case no RCON connection.
 *
 * @api {get} /control/kill
 * @apiVersion 1.0
 * @apiName Kill
 * @apiGroup Control
 *
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 501 Service Unavailable
 *     { "error": "Could not find csgo server process" }
 */
router.get("/control/kill", (req, res) => {
  let resetState = () => {
    // reset API-State
    serverInfo.serverState.serverRunning = false;
    serverInfo.serverState.authenticated = false;
    serverInfo.serverState.serverRcon = undefined;
  };
  exec("/bin/ps -A |grep cs2", (error, stdout, stderr) => {
    if (error) {
      logger.error(`exec error: ${error}, ${stderr}`);
      res.status(501).json({ error: "Could not find csgo server process" });
    } else if (stdout.match(/cs2/) != null) {
      if (cfg.type == "local") {
        let pid = stdout.split(/\s+/)[1];
        exec(`/bin/kill ${pid}`, (error, stdout, stderr) => {
          if (error) {
            logger.warn(
              `Server process could not be killed: ${error}: ${stderr}`,
            );
            res
              .status(501)
              .json({ error: "Could not kill csgo server process" });
          } else {
            resetState();
            logger.verbose("Server process killed.");
            res.json({ success: true });
          }
        });
      } else if (cfg.type == "docker") {
        exec(
          `docker compose -f ${cfg.dockerfile} down`,
          (error, stdout, stderr) => {
            if (error) {
              logger.error(`exec error: ${error}, ${stderr}`);
            } else {
              logger.verbose("Docker container stopped.");
              resetState();
              res.json({ success: true });
            }
          },
        );
      }
    }
  });
});

/**
 * @apiDescription Update CS:GO Server
 *
 * @api {get} /control/update
 * @apiVersion 1.0
 * @apiName Update
 * @apiGroup Control
 *
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 501 Internal Server Error
 *     { "error": "Update could not be started." }
 */
router.get("/control/update", (req, res) => {
  if (
    !serverInfo.serverState.serverRunning &&
    serverInfo.serverState.operationPending == "none"
  ) {
    controlEmitter.emit("exec", "update", "start");
    let updateSuccess = false;
    logger.verbose("Updating Server.");
    let updateProcess = pty.spawn(cfg.steamCommand, [
      `+runscript ${cfg.updateScript}`,
    ]);

    updateProcess.on("data", (data) => {
      logger.debug(data);
      if (reportUpdateProgress(data)) {
        updateSuccess = true;
      }
    });

    if (updateProcess) {
      if (cfg.webSockets) {
        res.json(`{ "success": true }`);
        updateProcess.once("close", (code) => {
          if (!updateSuccess) {
            logger.warn(`Update exited without success. Exit code: ${code}`);
            controlEmitter.emit("progress", "Update failed!", 100);
            controlEmitter.emit("exec", "update", "fail");
          }
        });
      } else {
        updateProcess.once("close", (code) => {
          if (updateSuccess) {
            res.json({ success: true });
          } else {
            logger.warn(`Update exited without success. Exit code: ${code}`);
            res.status(501).json({ error: "Update was not successful" });
          }
          controlEmitter.emit("exec", "update", "end");
        });
      }
    } else {
      logger.error("Update could not be started.");
      res.status(501).json({ error: "Update could not be started." });
      controlEmitter.emit("exec", "update", "end");
    }
  } else if (serverInfo.serverState.serverRunning) {
    logger.warn("Update triggered, while server running.");
    res.status(503).json({ error: "Server is running - stop before updating" });
  } else if (serverInfo.serverState.operationPending != "none") {
    logger.warn(
      `Update triggered, while ${serverInfo.serverState.operationPending} pending`,
    );
    res.status(503).json({
      error: `Another Operation is Pending: ${serverInfo.serverState.operationPending}`,
    });
  }
});

// change map
/**
 * @apiDescription Change Map
 *
 * @api {get} /control/changemap
 * @apiVersion 1.0
 * @apiName changemap
 * @apiGroup Control
 *
 * @apiParam {string/int} map  name, title or workshopID of a map.
 * @apiParamExample {string} Map-example
 *     cs_italy
 *
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 * @apiError {string} error
 * @apiErrorExample {json}
 *     HTTP/1.1 501 Internal Server Error
 *     { "error": "RCON error: Unable to write to socket" }
 */
router.get("/control/changemap", (req, res) => {
  var args = req.query;
  if (serverInfo.serverState.operationPending == "none") {
    controlEmitter.emit("exec", "mapchange", "start");
    // only try to change map, if it exists on the server.
    let map = sf.getMap(args.map);
    if (map != undefined) {
      let mapchangeCommand = "";
      if (map.official) {
        mapchangeCommand = `map ${map.name}`;
      } else {
        if (map.workshopID != "") {
          mapchangeCommand = `host_workshop_map ${map.workshopID}`;
        } else {
          mapchangeCommand = `ds_workshop_changelevel ${map.name}`;
        }
      }

      sf.executeRcon(mapchangeCommand)
        .then((answer) => {
          // Answer on success (unfortunately only available for official maps):
          // Changelevel to de_nuke
          // changelevel "de_nuke"
          // CHostStateMgr::QueueNewRequest( Changelevel (de_nuke), 5 )
          //
          // Answer on failure:
          // changelevel de_italy:  invalid map name
          if (
            map.official &&
            answer.indexOf(
              `CHostStateMgr::QueueNewRequest( Changelevel (${map.name})`,
            ) == -1
          ) {
            // If the mapchange command fails, return failure immediately
            res.status(501).json({ error: `Mapchange failed: ${answer}` });
            controlEmitter.emit("exec", "mapchange", "fail");
          } else {
            let mapchangeFinished = false;
            let mapchangeTimeout;
            const finishMapchange = (success) => {
              if (mapchangeFinished) {
                return;
              }
              mapchangeFinished = true;
              clearTimeout(mapchangeTimeout);
              controlEmitter.removeListener("exec", mapchangeCompleted);

              if (!cfg.webSockets && success) {
                res.json({ success: true });
              } else if (!success) {
                if (!cfg.webSockets) {
                  res.status(501).json({ error: "Mapchange failed - timeout" });
                }
                controlEmitter.emit("exec", "mapchange", "fail");
              }
            };
            const mapchangeCompleted = (operation, action) => {
              if (operation == "mapchange" && action == "end") {
                finishMapchange(true);
              }
            };

            controlEmitter.on("exec", mapchangeCompleted);
            mapchangeTimeout = setTimeout(() => {
              finishMapchange(false);
            }, 30000);

            if (cfg.webSockets) {
              res.json({ success: true });
            }
          }
        })
        .catch((err) => {
          res.status(501).json({ error: `RCON error: ${err.toString()}` });
          controlEmitter.emit("exec", "mapchange", "fail");
        });
    } else {
      res.status(501).json({ error: `Map ${args.map} not available` });
      controlEmitter.emit("exec", "mapchange", "fail");
    }
  } else {
    logger.warn(
      `Mapchange triggered, while ${serverInfo.serverState.operationPending} pending.`,
    );
    res.status(503).json({
      error: `Another Operation is Pending: ${serverInfo.serverState.operationPending}`,
    });
  }
});

/**
 * @apiDescription Reload availbale maps from server.
 *
 * @api {get} /control/reloadMaplist
 * @apiVersion 1.0
 * @apiName reloadMaplist
 * @apiGroup Control
 *
 * @apiSuccess {boolean} success
 * @apiSuccessExample {json}
 *     HTTP/1.1 200 OK
 *     { "success": true }
 */
router.get("/control/reloadMaplist", (req, res) => {
  sf.reloadMaplist()
    .then((answer) => {
      res.json(answer);
    })
    .catch((err) => {
      res.json(err.message);
    });
});

/**
 * @apiDescription Process rcon requests
 *
 * @api /rcon
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
router.get("/rcon", (req, res) => {
  var message = req.query.message;
  res.set("Content-Type", "text/plain");
  sf.executeRcon(message)
    .then((answer) => {
      res.send(answer);
    })
    .catch((err) => {
      res.status(501).send("Error, check server logs for details.");
      logger.error(err);
    });
});
// ------------------------ END V1.0 ---------------------------- //

module.exports = router;
