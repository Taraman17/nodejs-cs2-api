const https = require("https");
const Rcon = require("./rcon-srcds/rcon.js").default;
const logger = require("./logger.js");
const cfg = require("./configClass.js");
const serverInfo = require("./serverInfo.js");
const controlEmitter = require("./controlEmitter.js");
const { default: Queue } = require("queue");

const rconQ = new Queue({ autostart: true, timeout: 500, concurrency: 1 });
const steamRequestTimeout = 10000;
let authenticationPromise;

/**
 * Authenticate rcon with server
 * @return {Promise<JSON-string>} - Promise object that yields the result of authentication.
 * @fires controlEmitter.exec
 */
function authenticate() {
  if (serverInfo.serverState.authenticated) {
    logger.info("Already authenticated.");
    return Promise.resolve({ authenticated: true });
  }

  if (authenticationPromise) {
    return authenticationPromise;
  }

  if (serverInfo.serverState.operationPending === "auth") {
    logger.verbose(
      `Rcon authentication cancelled due to other operation Pending: ${serverInfo.serverState.operationPending}`
    );
    return Promise.reject({ authenticated: false });
  }

  controlEmitter.emit("exec", "auth", "start");
  logger.verbose("RCON authenticating...");
  const rcon = new Rcon({});
  serverInfo.serverState.serverRcon = rcon;

  authenticationPromise = new Promise((resolve, reject) => {
    let settled = false;
    let authTimeout;

    const disconnect = () => {
      if (rcon.connection) {
        Promise.resolve(rcon.disconnect()).catch((error) => {
          logger.debug(`RCON disconnect after authentication timeout failed: ${error}`);
        });
      }
    };

    const finish = (success) => {
      if (settled) {
        if (success) {
          disconnect();
        }
        return;
      }
      settled = true;
      clearTimeout(authTimeout);
      authenticationPromise = undefined;

      if (success) {
        logger.debug("received authentication");
        controlEmitter.emit("exec", "auth", "end");
        resolve({ authenticated: true });
      } else {
        serverInfo.serverState.authenticated = false;
        controlEmitter.emit("exec", "auth", "fail");
        reject({ authenticated: false });
      }
    };

    authTimeout = setTimeout(() => {
      logger.error("Authentication timed out");
      disconnect();
      finish(false);
    }, 60000);

    logger.debug("sending authentication request");
    rcon.authenticate(cfg.rconPass).then(
      () => finish(true),
      (error) => {
        logger.error("authentication error: " + error);
        finish(false);
      },
    );
  });

  return authenticationPromise;
}

/**
 * Get available maps from server and store them in serverInfo
 * @return {Promise<JSON-string>} - Promise object that yields the result of reload.
 */
async function reloadMaplist() {
  return new Promise((resolve, reject) => {
    (async () => {
    function getWorkshopCollection(id) {
      return new Promise((resolve, reject) => {
        const request = https
          .get(
            `https://api.steampowered.com/IPublishedFileService/GetDetails/v1?key=${cfg.apiToken}&publishedfileids[0]=${id}&includechildren=true`,
            (res) => {
              let resData = "";
              res.on("data", (dataChunk) => {
                resData += dataChunk;
              });
              res.on("end", () => {
                try {
                  const colMaps = [];
                  const resJson = JSON.parse(resData);
                  resJson.response.publishedfiledetails[0].children.forEach(
                    (colMap) => {
                      colMaps.push(colMap.publishedfileid);
                    }
                  );
                  resolve(colMaps);
                } catch (e) {
                  reject(e);
                }
              });
            }
          );
        request.setTimeout(steamRequestTimeout, () => {
          request.destroy(
            new Error(`Steam Workshop Collection request timed out after ${steamRequestTimeout} ms`),
          );
        });
        request.on("error", (error) => {
            logger.warn(`Steam Workshop Collection request failed: ${error}`);
            reject(error);
        });
      });
    }

    function getMapDetails(mapIDs, official) {
      return new Promise((resolve, reject) => {
        const omJson = require("../OfficialMaps.json");
        let idString = "";
        let i = 0;
        mapIDs.forEach((mapId) => {
          idString += `&publishedfileids[${i}]=${mapId}`;
          i++;
        });

        const request = https
          .get(
            `https://api.steampowered.com/IPublishedFileService/GetDetails/v1?key=${cfg.apiToken}${idString}&appid=730`,
            (res) => {
              let resData = "";
              const returnDetails = [];
              res.on("data", (dataChunk) => {
                resData += dataChunk;
              });
              res.on("end", () => {
                if (res.statusCode !== 200) {
                  logger.warn(
                    `getMapDetails api call failed. Status = ${res.statusCode}`
                  );
                  reject("Api call was unsuccessful");
                } else {
                  try {
                    const resJson = JSON.parse(resData);
                    resJson.response.publishedfiledetails.forEach((details) => {
                      if (details.result === 1) {
                        let _mapName = "";
                        if (details.filename !== "") {
                          const re = /\S+\/(\S+).bsp/;
                          const matches = details.filename.match(re);
                          _mapName = matches[1];
                        } else if (details.filename === "" && official) {
                          _mapName = omJson.find((map) => map.id == details.publishedfileid).name;
                        }
                        returnDetails.push({
                          name: _mapName,
                          official,
                          title: details.title,
                          workshopID: details.publishedfileid.toString(),
                          description: details.description,
                          previewLink: details.preview_url,
                          tags: details.tags,
                        });
                      } else {
                        logger.warn(
                          `No details for map ${details.publishedfileid.toString()}. Query Result: ${details.result.toString()}`
                        );
                      }
                    });
                    resolve(returnDetails);
                  } catch (e) {
                    logger.warn(`Reading map details failed: ${e}`);
                    reject("Could not read map details from api response");
                  }
                }
              });
            }
          );
        request.setTimeout(steamRequestTimeout, () => {
          request.destroy(
            new Error(`Steam Workshop Maps request timed out after ${steamRequestTimeout} ms`),
          );
        });
        request.on("error", (error) => {
            logger.warn(`Steam Workshop Maps Request failed: ${error}`);
            reject(error);
        });
      });
    }

    function getWorkshopCollectionMapsFromServer() {
      return new Promise((resolve, reject) => {
        executeRcon("ds_workshop_listmaps ")
          .then((response) => {
            const mapArray = response.split(/\r?\n/);
            let details = [];
            mapArray.forEach((value) => {
              details.push({
                name: value,
                official: false,
                title: value,
                workshopID: "",
                description: "",
                previewLink: "",
                tags: [],
              });
            });

            resolve(details);
          })
          .catch((err) => {
            logger.warn(
              `Could not get workshop collection maps from server: ${err}`
            );
            reject(err);
          });
      });
    }

    // Available maps will be built from OfficialMaps.json static file,
    // workshop collection and mapsfrom config.
    const officialMapIds = [];
    let workshopMapIds = [];
    let mapdetails = [];

    const omJson = require("../OfficialMaps.json");

    omJson.forEach((om) => {
      officialMapIds.push(om.id);
    });

    logger.debug("getting official maps");

    try {
      mapdetails = await getMapDetails(officialMapIds, true);
    } catch (error) {
      logger.warn(`Getting official maps details failed: ${error}`);
      logger.warn("Falling back to name and ID only");
      // As fallback use name and id from local file.
      const alternateDetails = [];
      omJson.forEach((map) => {
        alternateDetails.push({
          name: map.name,
          official: true,
          title: map.name,
          workshopID: map.id,
          description: "",
          previewLink: "",
          tags: [],
        });
      });
      mapdetails = alternateDetails;
    }

    if (cfg.workshopCollection !== "") {
      logger.debug("getting collection ids");
      try {
        workshopMapIds = await getWorkshopCollection(cfg.workshopCollection);
      } catch (error) {
        logger.warn(`Getting Workshop map IDs failed: ${error}
Trying to get names from server.`);
        // As a fallback try to get workshop maps from server via rcon command.
        try {
          mapdetails.push(...(await getWorkshopCollectionMapsFromServer()));
        } catch (err) {
          logger.warn(`Loading workshop maps from server failed: ${err}
Workshop maps not available.`);
        }
      }
    }
    workshopMapIds.push(...cfg.workshopMaps);

    if (workshopMapIds.length > 0) {
      logger.debug("getting workshop maps details");
      try {
        mapdetails.push(...(await getMapDetails(workshopMapIds, false)));
      } catch (error) {
        logger.warn(`Getting Workshop maps details from web failed: ${error}`);
        // As a fallback try to get workshop maps from server via rcon command.
        try {
          mapdetails.push(...(await getWorkshopCollectionMapsFromServer()));
        } catch (err) {
          logger.warn(`Loading workshop maps from server failed: ${err}
Workshop maps not available.`);
        }
      }
      if (mapdetails.length === 0) {
        logger.warn("No workshop map details available.");
      }
    }
    if (mapdetails.length > 1) {
      mapdetails.sort((a, b) => a.title.localeCompare(b.title));
    }

    serverInfo.mapsDetails = mapdetails;
    // TODO: Check if this is still needed.
    // serverInfo.mapsAvail = maplist;
    if (mapdetails.length > 0) {
      logger.info("Maps reloaded");
      resolve({ success: true });
    } else {
      logger.warn("Update maps failed: Maplist is empty.");
      reject({ success: false });
    }
    })().then(resolve, reject);
  });
}

/**
 * Checks if a map is available on the server or not
 * @param  {string/int}           map - a filename, title or workshopID
 * @return {boolean}          if the map was found in the details.
 */
function getMap(mapToFind) {
  let returnMap;
  serverInfo.mapsDetails.forEach((map) => {
    if (
      map.workshopID === mapToFind ||
      map.name === mapToFind ||
      map.title === mapToFind
    ) {
      returnMap = map;
    }
  });
  return returnMap;
}

/**
 * Executes a rcon command
 * @param  {string}           message - The rcon command to execute
 * @return {Promise<string>}          - Promise Object that contains the rcon response or an error message.
 */
function executeRcon(message) {
  logger.debug(`Executing rcon: ${message}`);
  return new Promise((resolve, reject) => {
    // To ensure proper reception of answers, we need to send requests one after another.
    rconQ.push(() => {
      serverInfo.serverState.serverRcon
        .execute(message)
        .then((answer) => {
          logger.debug(answer);
          resolve(answer);
        })
        .catch((err) => {
          logger.error(`RCON Error: ${err.message}`);
          reject(err.message);
        });
    });
  });
}

/* ------------------------- Helper Functions ---------------------------- */
/**
 * Cuts the bare map-name from the various representations in the servers responses.
 * @param {string} mapstring   - The response of mapname(s) from rcon.
 * @returns {string} mapstring -  The mapname without workshop path or .bsp
 */
function cutMapName(mapstring) {
  if (mapstring.search("workshop") !== -1) {
    const re = /(\w+)/g;
    const matches = mapstring.match(re);
    mapstring = matches[2];
  }
  if (mapstring.search(".bsp") !== -1) {
    mapstring = mapstring.substring(0, mapstring.length - 4);
  }
  return mapstring;
}

/**
 * Query the server for mp_maxrounds.and store them in serverInfo
 */
function queryMaxRounds() {
  executeRcon("mp_maxrounds")
    .then((answer) => {
      // "mp_maxrounds" = "30" ( def. "0" ) min. 0.000000 game notify replicated
      // - max number of rounds to play before server changes maps
      const rex = /mp_maxrounds = (\d+)/g;
      const matches = rex.exec(answer);
      serverInfo.maxRounds = matches[1];
    })
    .catch((err) => {
      logger.error("Error getting Maxrounds: " + err);
    });
}

module.exports = {
  authenticate,
  reloadMaplist,
  getMap,
  executeRcon,
  cutMapName,
  queryMaxRounds,
};
