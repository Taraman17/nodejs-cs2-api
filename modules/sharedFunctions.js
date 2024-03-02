const https = require('https');
const queue = require('queue');
const rcon = require('./rcon-srcds/rcon.js').default;
const logger = require('./logger.js');
var cfg = require('./configClass.js');
var serverInfo = require('./serverInfo.js');
var controlEmitter = require('./controlEmitter.js');

const rconQ = new queue({ "autostart": true, "timeout": 500, "concurrency": 1 });

/**
 * Authenticate rcon with server
 * @return {Promise<JSON-string>} - Promise object that yields the result of authentication.
 * @fires controlEmitter.exec
 */
function authenticate() {
    if (serverInfo.serverState.operationPending != 'auth') {
        controlEmitter.emit('exec', 'auth', 'start');
        return new Promise((resolve, reject) => {
            if (!serverInfo.serverState.authenticated) {
                logger.verbose("RCON authenticating...");
                // since this API is designed to run on the same machine as the server keeping 
                // default here which is 'localhost'
                let authTimeout = setTimeout(() => {
                    logger.error('Authentication timed out');
                    controlEmitter.emit('exec', 'auth', 'fail');
                    reject({ "authenticated": false });
                }, 60000);
                serverInfo.serverState.serverRcon = new rcon({});
                logger.debug('sending authentication request');
                serverInfo.serverState.serverRcon.authenticate(cfg.rconPass).then(() => {
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
            if (serverInfo.serverState.authenticated) {
                logger.verbose('Already authenticated.');
                resolve({ "authenticated": true });
            } else {
                logger.verbose(`Rcon authentication cancelled due to other operation Pending: ${serverInfo.serverState.operationPending}`);
                reject({ "authenticated": false });
            }
        });
    }

}

/**
 * Get available maps from server and store them in serverInfo
 * @return {Promise<JSON-string>} - Promise object that yields the result of reload.
 */
async function reloadMaplist() {
    return new Promise( async (resolve, reject) => {
        function getWorkshopCollection(id) {
            return new Promise((resolve, reject) => {
                https.get(`https://api.steampowered.com/IPublishedFileService/GetDetails/v1?key=${cfg.apiToken}&publishedfileids[0]=${id}&includechildren=true`, (res) => {
                    let resData = '';
                    res.on('data', (dataChunk) => {
                        resData += dataChunk;
                    });
                    res.on('end', () => {
                        try {
                            let colMaps = []
                            let resJson = JSON.parse(resData);
                            resJson.response.publishedfiledetails[0].children.forEach((colMap) => {
                                colMaps.push(colMap.publishedfileid);
                            })
                            resolve(colMaps);
                        } catch (e) {
                            reject(e);
                        }
                    });
                }).on('error', (error) => {
                    logger.warn(`Steam Workshop Collection request failed: ${error}`);
                    reject(error);
                });
            });
        }

        function getMapDetails(mapIDs, official) {
            return new Promise((resolve, reject) => {
                let idString = '';
                let i = 0;
                mapIDs.forEach( (mapId) => {
                    idString += `&publishedfileids[${i}]=${mapId}`;
                    i++;
                });

                https.get(`https://api.steampowered.com/IPublishedFileService/GetDetails/v1?key=${cfg.apiToken}${idString}&appid=730`, (res) => {
                    let resData = '';
                    let returnDetails = [];
                    res.on('data', (dataChunk) => {
                        resData += dataChunk;
                    });
                    res.on('end', () => {
                        if (res.statusCode != 200) {
                            logger.warn(`getMapDetails api call failed. Status = ${res.statusCode}`);
                            reject('Api call was unsuccessful');
                        } else {
                            try {
                                let resJson = JSON.parse(resData);
                                resJson.response.publishedfiledetails.forEach( details => {
                                    let _mapName = "";
                                    if (details.filename != "") {
                                        let re = /\S+\/(\S+).bsp/;
                                        let matches = details.filename.match(re);
                                        _mapName = matches[1];
                                    }
                                    returnDetails.push({ 
                                        "name": _mapName, 
                                        "official": official, 
                                        "title": details.title, 
                                        "workshopID": details.publishedfileid.toString(), 
                                        "description": details.description, 
                                        "previewLink": details.preview_url, 
                                        "tags": details.tags })
                                });
                                resolve(returnDetails);
                            } catch (e) {
                                logger.warn(`Reading map details failed: ${e}`);
                                reject('Could not read map details from api response');
                            }
                        }
                    });
                }).on('error', (error) => {
                    logger.warn(`Steam Workshop Maps Request failed: ${error}`);
                    reject(error);
                });
                
            });
        }

        function getWorkshopCollectionMapsFromServer() {
            return new Promise((resolve, reject) => {
                executeRcon('ds_workshop_listmaps ').then((response) => {
                    let mapArray = response.split(/\r?\n/);
                    let details = [];
                    mapArray.forEach((value) => {
                        mapdetails.push({
                            "name": value,
                            "official": false,
                            "title": value,
                            "workshopID": "",
                            "description": "",
                            "previewLink": "",
                            "tags": [],
                        });
                    });
                    
                    resolve(details);
                }).catch((err) => {
                    logger.warn(`Could not get workshop collection maps from server: ${err}`);
                    reject(err);
                });
            });
        }



        // Available maps will be built from OfficialMaps.json static file,
        // workshop collection and mapsfrom config.
        let officialMapIds = [];
        let workshopMapIds = [];
        let mapdetails = [];

        let omJson = require('../OfficialMaps.json');

        omJson.forEach( (om) => {
            officialMapIds.push(om.id);
        })

        logger.debug("getting official maps");
        
        try {
            mapdetails = await getMapDetails(officialMapIds, true);
        } catch(error) {
            logger.warn(`Getting official maps details failed: ${error}`);
            logger.warn('Falling back to name and ID only');
            // As fallback use name and id from local file.
            let alternateDetails = [];
            omJson.forEach( (map) => {
                alternateDetails.push( {
                    "name": map.name,
                    "official": true,
                    "title": map.name,
                    "workshopID": map.id,
                    "description": "",
                    "previewLink": "",
                    "tags": [],
                });
            });
            mapdetails = alternateDetails;
        }

        if (cfg.workshopCollection != '') {
            logger.debug("getting collection ids");
            try {
                workshopMapIds = await getWorkshopCollection(cfg.workshopCollection);
            } catch (error) {
                logger.warn(`Getting Workshop map IDs failed: ${error}
Trying to get names from server.`);
                // As a fallback try to get workshop maps from server via rcon command.
                try {
                    mapdetails.push(...await getWorkshopCollectionMapsFromServer());
                } catch (err) {
                    logger.warn(`Loading workshop maps from server failed: ${err}
Workshop maps not available.`);
                }
            }
        }
        workshopMapIds.push(...cfg.workshopMaps);

        if(workshopMapIds.length > 0) {
            logger.debug("getting workshop maps details");
            try {
                mapdetails.push(...await getMapDetails(workshopMapIds, false));
            } catch(error) {
                logger.warn(`Getting Workshop maps details failed: ${error}`);
                // As a fallback try to get workshop maps from server via rcon command.
                try {
                    mapdetails.push(...await getWorkshopCollectionMapsFromServer());
                } catch (err) {
                    logger.warn(`Loading workshop maps from server failed: ${err}
Workshop maps not available.`);
                }
            }
        }
        if (mapdetails.length > 1) {
            mapdetails.sort((a, b) => a.title.localeCompare(b.title));
        }

        serverInfo.mapsDetails = mapdetails;
        // TODO: Check if this is still needed.
        // serverInfo.mapsAvail = maplist;
        if(mapdetails.length > 0) {
            logger.info('Maps reloaded');
            resolve({ "success": true });
        } else {
            logger.warn('Update maps failed: Maplist is empty.');
            reject( {"success": false});
        }
    });
}

/**
 * Checks if a map is available on the server or not
 * @param  {string/int}           map - a filename, title or workshopID
 * @return {boolean}          if the map was found in the details.
 */
function getMap(mapToFind) {
    let returnMap = undefined;
    serverInfo.mapsDetails.forEach( (map) => {
        if (map.workshopID == mapToFind || map.name == mapToFind || map.title == mapToFind) {
            returnMap = map;
        } 
    })
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
        rconQ.push( () => {
            serverInfo.serverState.serverRcon.execute(message).then((answer) => {
                logger.debug(answer);
                resolve(answer);
            }).catch((err) => {
                logger.error(`RCON Error: ${err.message}`);
                reject(err.message);
            });
        });
    });
}

/*------------------------- Helper Functions ----------------------------*/
/**
 * Cuts the bare map-name from the various representations in the servers responses.
 * @param {string} mapstring   - The response of mapname(s) from rcon.
 * @returns {string} mapstring -  The mapname without workshop path or .bsp
 */
function cutMapName(mapstring) {
    if (mapstring.search('workshop') != -1) {
        let re = /(\w+)/g;
        let matches = mapstring.match(re);
        mapstring = matches[2];
    }
    if (mapstring.search(".bsp") != -1) {
        mapstring = mapstring.substring(0, mapstring.length - 4);
    }
    return mapstring;
}

/**
 * Query the server for mp_maxrounds.and store them in serverInfo
 */
function queryMaxRounds() {
    executeRcon('mp_maxrounds').then((answer) => {
        // "mp_maxrounds" = "30" ( def. "0" ) min. 0.000000 game notify replicated
        // - max number of rounds to play before server changes maps
        let rex = /mp_maxrounds = (\d+)/g;
        let matches = rex.exec(answer);
        serverInfo.maxRounds = matches[1];
    }).catch((err) => {
        logger.error('Error getting Maxrounds: ' + err);
    });
}

module.exports = { authenticate, reloadMaplist, getMap, executeRcon, cutMapName, queryMaxRounds };