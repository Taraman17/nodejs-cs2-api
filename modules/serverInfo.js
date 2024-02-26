const events = require('events');
const logger = require('./logger');

class serverInfo {
    #serverState;

    #map = '';
    #mapsAvail = [];
    #mapsDetails = [
        //{ 'name': '',
        //  'official': true/false,
        //  'title': '',
        //  'workshopID': '',
        //  'description': '',
        //  'previewLink': '',
        //  'tags': [{ "tag": "" }] }
    ];
    #mapFilterType;
    #mapFilters;
    #maxRounds = 0
    #pause = false;

    #players = [
        //{ 'name': '',
        //  'steamID': '',
        //  'team': '',
        //  'kills': 0,
        //  'deaths': 0 }
    ];
    #score;

    constructor() {
        /**
         * Stores the state of the controlled server-instance.
         * @typedef  serverState
         * @property {string}   operationPending - 1 of: none, start, stop, mapchange, update, auth, pause.
         * @property {boolean}  serverRunning    - Is the server process running.
         * @property {object}   serverRcon       - rcon-srcds instance for the server.
         * @property {boolean}  authenticated    - Is the rcon instance authenticated with the server.
         */

        /** @type {serverState} */
        this.#serverState = {
            'operationPending': 'none',
            'serverRunning': false,
            'serverRcon': undefined,
            'authenticated': false
        }

        // data section
        this.#mapFilterType = 'exclude'; // 'include / exclude',
        this.#mapFilters = ['ar_', 'dz_', 'gd_', 'lobby_', 'training1']; // [ {string} ]
        this.#score = {
            'T': 0,
            'C': 0
        };

        // emitter to notify of changes
        this.serverInfoChanged = new events.EventEmitter();
    }

    // getter / setter
    get serverState() {
        return this.#serverState;
    }
    set serverState(newVal) {
        this.#serverState = newVal;
    }

    get map() {
        return this.#map;
    }
    set map(newMap) {
        this.#map = newMap;
        this.serverInfoChanged.emit('change');
    }

    get mapsAvail() {
        return this.#mapsAvail;
    }
    set mapsAvail(newMapsAvail) {
        this.#mapsAvail = newMapsAvail;
        this.serverInfoChanged.emit('change');
    }
    mapList() {
        if (this.#mapFilters.length > 0) {
            return this.#mapsAvail.filter((map) => {
                let found = false;
                this.#mapFilters.forEach((filter) => {
                    if (map.includes(filter)) {
                        found = true;
                    }
                });
                if (this.#mapFilterType === 'include') {
                    return found;
                } else {
                    return !found;
                }
            });
        } else {
            return this.#mapsAvail;
        }
    }

    get mapsDetails() {
        return this.#mapsDetails;
    }
    set mapsDetails(newMapsDetails) {
        this.#mapsDetails = newMapsDetails;
        this.serverInfoChanged.emit('change');
    }
    mapDetails() {
        if (this.#mapFilters.length > 0) {
            return this.#mapsDetails.filter((map) => {
                let found = false;
                if (map.name) { // sometimes map.name is undefined for some reason.
                    this.#mapFilters.forEach((filter) => {
                        if (map.name.includes(filter)) {
                            found = true;
                        }
                    });
                }
                if (this.#mapFilterType === 'include') {
                    return found;
                } else {
                    return !found;
                }
            });
        } else {
            return this.#mapsDetails;
        }
    }

    // Map Filter Methods
    get mapFilterType() {
        return this.#mapFilterType;
    }
    set mapFilterType(type) {
        if (type === 'include' || type === 'exclude') {
            this.#mapFilterType = type;
            this.serverInfoChanged.emit('change');
        }
    }
    get mapFilters() {
        return this.#mapFilters;
    }
    mapFilterAdd(filter) {
        this.#mapFilters.push(filter);
        this.serverInfoChanged.emit('change');
    }
    mapFilterRemove(itemToRemove) {
        if (this.#mapFilters.length == 0) {
            return (0);
        }
        if (typeof itemToRemove === 'number' && this.#mapFilters.length > parseInt(itemToRemove)) {
            console.log("removing number");
            this.#mapFilters.splice(parseInt(itemToRemove), 1);
            this.serverInfoChanged.emit('change');
        } else {
            let newFilters = this.#mapFilters.filter((currentItem) => {
                return (currentItem != itemToRemove);
            });
            this.#mapFilters = newFilters;
            this.serverInfoChanged.emit('change');
        }
        return (this.#mapFilters.length);
    }
    mapFilterReset() {
        this.#mapFilterType = 'exclude';
        this.#mapFilters = [];
        this.serverInfoChanged.emit('change');
    }

    get maxRounds() {
        return this.#maxRounds;
    }
    set maxRounds(newMaxRounds) {
        if (!Number.isNaN(newMaxRounds)) {
            this.#maxRounds = newMaxRounds;
            this.serverInfoChanged.emit('change');
        } else {
            logger.warn('maxRounds must be a number.');
        }
    }

    get score() {
            return this.#score;
        }
        // Accepts array with team (T or C) and score.
    set score(newScoreArray) {
        this.#score[newScoreArray[1]] = parseInt(newScoreArray[2]);
        this.serverInfoChanged.emit('change');
    }

    get pause() {
        return this.#pause;    
    }
    set pause(state) {
        if (typeof(state) == 'boolean') {
            this.#pause = state
            this.serverInfoChanged.emit('change');
        } else {
            logger.warn('Invalid pause state - must be of type Boolean');
        }
    }

    get players() {
        return this.#players;
    }
    addPlayer(newPlayer) {
        if (this.#players.find(x => x.steamID === newPlayer.steamID) != undefined) {
            this.#players.find(x => x.steamID === newPlayer.steamID).disconnected = false
        } else {
            newPlayer.team = 'U';
            newPlayer.kills = 0;
            newPlayer.deaths = 0;
            newPlayer.disconnected = false;
            this.#players.push(newPlayer);
        }
        this.serverInfoChanged.emit('change');
    }
    assignPlayer(name, steamID, team) {
        if (this.#players.find(x => x.steamID === steamID) == undefined ) {
            this.addPlayer({'name': name, 'steamID': steamID });
        }
        let player = this.#players.find(x => x.steamID === steamID);
        player.team = team.substr(0, 1);
        this.serverInfoChanged.emit('change');
    }
    removePlayer(steamID) {
        this.#players.find(x => x.steamID === steamID).disconnected = true;
        // this.#players.splice(this.#players.findIndex(x => x.steamID === steamID), 1);
        this.serverInfoChanged.emit('change');
    }
    clearPlayers() {
        this.#players = [];
        this.serverInfoChanged.emit('change');
    }
    recordKill(killer, victim) {
        let killPlayer = this.#players.find(x => x.steamID === killer);
        if (killPlayer != undefined)
            killPlayer.kills += 1;
        let victimPlayer = this.#players.find(x => x.steamID === victim);
        if (victimPlayer != undefined)
            victimPlayer.deaths += 1;
        this.serverInfoChanged.emit('change');
    }

    // Methods
    getAll() {
        return {
            'map': this.#map,
            'mapsAvail': this.mapList(),
            'mapsDetails': this.mapDetails(),
            'maxRounds': this.#maxRounds,
            'score': this.#score,
            'pause': this.#pause,
            'players': this.#players
        };
    }

    newMatch() {
        this.#score.C = 0;
        this.#score.T = 0;
        for (let i in this.#players) {
            this.#players[i].kills = 0;
            this.#players[i].deaths = 0;
        }
        this.serverInfoChanged.emit('change');
    }
    reset() {
        // Method to be called on server quit.
        this.#map = '';
        this.#mapsAvail = [];
        this.#mapsDetails = [];
        this.#maxRounds = 0;
        this.#pause = false;
        this.clearPlayers();
        this.newMatch();
    }
}

module.exports = new serverInfo();