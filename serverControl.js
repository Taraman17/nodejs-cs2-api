/**
 * @file CS:GO Dedicated Server Control
 * @author Markus Adrario <mozilla@adrario.de>
 * @version 2.0
 * @requires express
 * @requires express-session
 * @requires express-rate-limit
 * @requires cors
 * @requires passport
 * @requires passport-steam
 * @requires http
 * @requires https
 * @requires ws
 * @requires child_process
 * @requires rcon-srcds
 * @requires ./modules/logger.js
 * @requires ./modules/serverInfo.js
 * @requires ./modules/configClass.js
 * @requires ./modules/sharedFunctions.js
 */

const express = require("express");
const session = require("express-session");
const rateLimit = require("express-rate-limit");
const cors = require("cors");
const passport = require("passport");
const SteamStrategy = require("passport-steam").Strategy;
const BasicStrategy = require("passport-http").BasicStrategy;
const webSocket = require("ws");
const fs = require("fs");
const { exec } = require("child_process");
const logger = require("./modules/logger.js");
const serverInfo = require("./modules/serverInfo.js");
const cfg = require("./modules/configClass.js");
const sf = require("./modules/sharedFunctions.js");

cfg.localIp = require("local-ip")(cfg.iface);
let http;
let httpsCredentials = {};
// if configured for https, we fork here.
if (cfg.useHttps) {
  http = require("https");
  httpsCredentials = {
    key: fs.readFileSync(cfg.httpsPrivateKey),
    cert: fs.readFileSync(cfg.httpsCertificate),
  };
  if (cfg.httpsCa !== "") {
    httpsCredentials.ca = fs.readFileSync(cfg.httpsCa);
  }
} else {
  http = require("http");
}

// check for running Server on Startup
exec("/bin/ps -A", (error, stdout, stderr) => {
  if (error) {
    logger.error(`exec error: ${error}`);
    logger.error(stderr);
    return;
  }
  if (stdout.match(/cs2/) != null) {
    serverInfo.serverState.serverRunning = true;
    logger.verbose("Found running server");
    sf.authenticate()
      .then((data) => {
        logger.verbose(`authentication ${data.authenticated}`);
        sf.executeRcon(
          `logaddress_add_http "http://${cfg.localIp}:${cfg.logPort}/log`
        );
        sf.executeRcon(`host_workshop_collection ${cfg.workshopCollection}`);
      })
      .catch((data) => {
        logger.verbose(`authentication ${data.authenticated}`);
      });
  }
});

// Event Emitters
const controlEmitter = require("./modules/controlEmitter.js");

/**
 * Sets the operationPending variable on events. Gathers Information on RCON authentication.
 * @listens controlEmitter#exec
 */
controlEmitter.on("exec", (operation, action) => {
  serverInfo.serverState.operationPending =
    action === "start" ? operation : "none";
  logger.debug(
    "serverInfo.serverState.operationPending = " +
      serverInfo.serverState.operationPending
  );
  if (operation === "auth" && action === "end") {
    serverInfo.serverState.authenticated = true;
    logger.debug(
      "serverInfo.serverState.authenticated = " +
        serverInfo.serverState.authenticated
    );
    logger.verbose("RCON Authenticate success");
    // Get current and available maps and store them.
    sf.executeRcon("status").then((answer) => {
      const re = /\[1: (\w+) \|/;
      const matches = re.exec(answer);
      const mapstring = matches[1];
      serverInfo.map = sf.cutMapName(mapstring);
    });
    sf.reloadMaplist()
      .then(() => {
        // Be happy and do nothing
      })
      .catch((err) => {
        logger.warn(`Maps could not be loaded: ${err}`);
      });
    sf.queryMaxRounds();
  }
});

/* ----------------- HTTP Server Code ------------------- */
/**
 * Creates an express server to handle the API requests
 */
const app = express();
const apiV10 = require("./modules/apiV10.js");
const limit = rateLimit({
  max: 50, // max requests
  windowMs: 60 * 1000, // 1 Minute
  message: "Too many requests", // message to send
});
app.use(limit);
app.use(
  session({
    secret: cfg.sessionSecret,
    name: `csgo-api-${cfg.host}`,
    cookie: {
      expires: cfg.loginValidity,
      secure: cfg.useHttps,
    },
    resave: true,
    saveUninitialized: true,
  })
);
app.use(
  cors({
    origin: cfg.host,
    credentials: true,
  })
);
app.use(passport.initialize());
app.use(passport.session());
app.use(express.static("public"));

app.disable("x-powered-by");

// --------------------------- Steam authentication ---------------------------- //
// Setup Passport for SteamStrategy
passport.serializeUser((user, done) => {
  done(null, user);
});
passport.deserializeUser((obj, done) => {
  done(null, obj);
});

passport.use(
  new SteamStrategy(
    {
      returnURL: `${cfg.scheme}://${cfg.host}:${cfg.apiPort}/csgoapi/login/return`,
      realm: `${cfg.scheme}://${cfg.host}:${cfg.apiPort}/`,
      profile: false,
    },
    (identifier, profile, done) => {
      process.nextTick(() => {
        // Cut the SteamID64 from the returned User-URI
        const steamID64 = identifier.split("/")[5];
        profile.identifier = steamID64;
        logger.http({
          user: `${steamID64}`,
          message: "logged in",
        });
        return done(null, profile);
      });
    }
  )
);

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    if (cfg.admins.includes(req.user.identifier)) {
      logger.http({
        user: `${req.user.identifier}`,
        message: `${req.method}:${req.url}`,
      });
      return next();
    } else {
      logger.info({
        user: `${req.user.identifier}`,
        message: "User not in Admin list.",
      });
      return res.status(401).send("User not in Admin list.");
    }
  }
  logger.warn({
    user: "unknown",
    message: `Unauthorized Access from ${req.ip}.`,
  });
  return res.status(401).send("Not logged in.");
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
app.get("/csgoapi/login", passport.authenticate("steam"), () => {
  // The request will be redirected to Steam for authentication, so
  // this function will not be called.
});
/**
 * @api {get} /csgoapi/login/return
 * @apiVersion 1.0
 * @apiName Login Return
 * @apiGroup Auth
 *
 * @apiSuccess (302) Redirect to confiured page.
 * @apiError (302) Redirect to /csgoapi/loginStatus
 */
app.get(
  "/csgoapi/login/return",
  passport.authenticate("steam", { failureRedirect: "/csgoapi/loginStatus" }),
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
app.get("/csgoapi/logout", (req, res) => {
  logger.http({
    user: `${req.user.identifier}`,
    message: "logged out",
  });
  req.logout((err) => {
    if (err) {
      logger.warn({
        user: `${req.user.identifier}`,
        message: `logout failed: ${err}`,
      });
    }
    res.redirect(cfg.redirectPage);
  });
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
app.get("/csgoapi/loginStatus", (req, res) => {
  if (req.user && cfg.admins.includes(req.user.identifier)) {
    res.json({ login: true });
  } else {
    res.json({ login: false });
  }
});

app.use("/csgoapi/v1.0/", ensureAuthenticated, apiV10);
// ------------------------ END Steam authentication ---------------------------- //

// ------------------------ Basic authentication ---------------------------- //
if (cfg.httpAuth) {
  passport.use(
    new BasicStrategy(
      { qop: "auth", passReqToCallback: true },
      (req, username, password, done) => {
        if (username === cfg.httpUser.username) {
          if (password === cfg.httpUser.password) {
            logger.http({
              user: username,
              message: `${req.method}:${req.url}`,
            });
            return done(null, cfg.httpUser.username);
          } else {
            logger.warn({
              user: username,
              message: `Unauthorized http Access - wrong Password - from ${req.ip}.`,
            });
            return done(null, false);
          }
        } else {
          logger.warn({
            user: username,
            message: `Unauthorized http Access - unknown user - from ${req.ip}.`,
          });
          return done(null, false);
        }
      }
    )
  );

  app.use(
    "/csgoapi/http/v1.0/",
    passport.authenticate("basic", { session: false }),
    apiV10
  );
}
// --------------------- END Basic authentication -------------------------- //

let server;
if (cfg.useHttps) {
  server = http.createServer(httpsCredentials, app);
} else {
  server = http.createServer(app);
}
server.listen(cfg.apiPort);

// ------------------------------- Log receiver ---------------------------- //
const logreceive = express();
logreceive.use(express.text({ limit: "50mb" }));

let logserver;
if (cfg.useHttps) {
  const loghttp = require("http");
  logserver = loghttp.createServer(logreceive);
} else {
  logserver = http.createServer(logreceive);
}

const logroute = require("./modules/logreceive.js");
logreceive.use("/", logroute);

logserver.listen(cfg.logPort, () => {
  logger.info("Logserver listening!");
});
// ----------------------------- END Log receiver -------------------------- //

/* ----------------- WebSockets Code ------------------- */
if (cfg.webSockets) {
  let wssServer;
  if (cfg.useHttps) {
    wssServer = http.createServer(httpsCredentials);
  } else {
    wssServer = http.createServer();
  }
  const wss = new webSocket.Server({ server: wssServer });

  wssServer.listen(cfg.socketPort, () => {
    const host = cfg.host;
    logger.verbose(host);
  });

  /**
   * Websocket to send data updates to a webClient.
   * @listens ws#connection
   */
  wss.on("connection", (ws) => {
    /**
     * Sends updated serverInfo to clients.
     */
    const sendUpdate = () => {
      ws.send(
        `{ "type": "serverInfo", "payload": ${JSON.stringify(
          serverInfo.getAll()
        )} }`
      );
    };

    /**
     * Listens for messages on Websocket.
     * @listens ws#message
     */
    ws.on("message", (message) => {
      if (message.toString().search("infoRequest") !== -1) {
        sendUpdate();
      }
    });

    /**
     * Listens for changed serverInfo and calls function to forward them.
     * @listens serverInfo.serverInfoChanged#change
     */
    serverInfo.serverInfoChanged.on("change", sendUpdate);

    /**
     * Notifies clients of start or end of a control operation
     * @param {string} operation (start, stop, update, mapchange)
     * @param {string} action (start, end, fail)
     */
    const sendControlNotification = (operation, action) => {
      ws.send(
        `{ "type": "commandstatus", "payload": { "operation": "${operation}", "state": "${action}" } }`
      );
    };

    /**
     * Listens for execution notification of control operations.
     * @listens controlEmitter#exec
     */
    controlEmitter.on("exec", sendControlNotification);

    /**
     * Reports update progress to clients.
     * @param {string} action - Reports, which action is in progress during the update.
     * @param {int} progress - Integer representing the percentage of the action that is completed.
     */
    const reportProgress = (action, progress) => {
      ws.send(
        `{ "type": "progress", "payload": { "step": "${action}", "progress": ${progress} } }`
      );
    };

    /**
     * Listens for progress reporst from update process and sends them to the client.
     * @listens controlEmitter#progress
     */
    controlEmitter.on("progress", reportProgress);

    /**
     * Listens for Websocket to close and removes listeners.
     * @listens ws#close
     */
    ws.on("close", (code, reason) => {
      serverInfo.serverInfoChanged.removeListener("change", sendUpdate);
      controlEmitter.removeListener("exec", sendControlNotification);
      controlEmitter.removeListener("progress", reportProgress);
      logger.info(`websocket closed with code ${code}. Reason: ${reason}`);
    });
  });
}
