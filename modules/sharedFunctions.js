const https = require('https');
const rcon = require('./rcon-srcds/rcon.js').default;
const logger = require('./logger.js');
var cfg = require('./configClass.js');
var serverInfo = require('./serverInfo.js');
var controlEmitter = require('./controlEmitter.js');

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
function reloadMaplist() {
    return new Promise((resolve, reject) => {

        function _sendApiRequest(_mapName, mapId) {
            return new Promise((resolve, reject) => {
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
                            let workshopID = resJSON.response.publishedfiledetails[0].publishedfileid;
                            let description = resJSON.response.publishedfiledetails[0].description;
                            let tags = resJSON.response.publishedfiledetails[0].tags;
                            resolve({ "name": _mapName, "title": title, "workshopID": workshopID, "description": description, "previewLink": previewLink, "tags": tags });
                        } catch (e) {
                            reject({ "name": _mapName, "title": "", "workshopID": "", "description": "", "previewLink": "", "tags": "" });
                        }
                    });
                });

                steamApiRequest.on('error', error => {
                    logger.warn(`steamApiRequest not successful: ${error}`);
                    reject({ "name": _mapName, "title": "", "workshopID": "", "description": "", "previewLink": "", "tags": "" });
                });

                steamApiRequest.write(`itemcount=1&publishedfileids%5B0%5D=${mapId}`);
                steamApiRequest.end();
            });
        }

        executeRcon('maps *').then((answer) => {
            const officialMaps = require('../OfficialMaps.json');
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
                        mapdetails.push({ "name": mapName, "title": "", "workshopID": "", "description": "", "previewLink": "", "tags": "" });
                    }
                }
            });
            Promise.allSettled(promises).then((results) => {
                results.forEach((result) => {
                    mapdetails.push(result.value)
                })

                mapdetails.sort((a, b) => a.name.localeCompare(b.name));
                maplist.sort();
                // Only return, if list has at least one item.
                if (maplist.length > 0) {
                    logger.debug('Saving Maplist to ServerInfo');
                    serverInfo.mapsAvail = maplist;
                    serverInfo.mapsDetails = mapdetails;
                    resolve({ "success": true });
                } else {
                    reject({ "success": false });
                }
            });
        }).catch((err) => {
            reject({ "success": false });
        });
    });
}

/**
 * Executes a rcon command
 * @param  {string}           message - The rcon command to execute
 * @return {Promise<string>}          - Promise Object that contains the rcon response or an error message.
 */
function executeRcon(message) {
    logger.debug(`Executing rcon: ${message}`);
    return new Promise((resolve, reject) => {
        serverInfo.serverState.serverRcon.execute(message).then((answer) => {
            resolve(answer);
        }).catch((err) => {
            logger.error(`RCON Error: ${err.message}`);
            reject(err.message);
        });
    });
}

/*------------------------- Helper Functions ----------------------------*/
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
        mapstring = mapstring.substring(0, mapstring.length - 4);
    }
    return mapstring;
}

module.exports = { authenticate, reloadMaplist, executeRcon, cutMapName };