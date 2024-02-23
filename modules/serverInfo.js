const events = require('events');

class serverInfo {
    constructor(options = {}) {
        /**
         * Stores the state of the controlled server-instance.
         * @typedef  serverState
         * @property {string}   operationPending - 1 of: none, start, stop, mapchange, update, auth, pause.
         * @property {boolean}  serverRunning    - Is the server process running.
         * @property {object}   serverRcon       - rcon-srcds instance for the server.
         * @property {boolean}  authenticated    - Is the rcon instance authenticated with the server.
         */

        /** @type {serverState} */
        this._serverState = {
            'operationPending': 'none',
            'serverRunning': false,
            'serverRcon': undefined,
            'authenticated': false
        }

        // data section
        this._map = '';
        this._mapsAvail = []
        this._mapsDetails = [
            //{ 'name': '',
            //  'official': true/false,
            //  'title': '',
            //  'workshopID': '',
            //  'description': '',
            //  'previewLink': '',
            //  'tags': [{ "tag": "" }] }
        ];
        this._mapFilterType = 'exclude'; // 'include / exclude',
        this._mapFilters = ['ar_', 'dz_', 'gd_', 'lobby_', 'training1']; // [ {string} ]
        this._maxRounds = 0;
        this._pause = false // Is the match paused?
        this._score = {
            'T': 0,
            'C': 0
        };
        this._players = [
            //{ 'name': '',
            //  'steamID': '',
            //  'team': '',
            //  'kills': 0,
            //  'deaths': 0 }
        ];

        // emitter to notify of changes
        this.serverInfoChanged = new events.EventEmitter();
    }

    // getter / setter
    get serverState() {
        return this._serverState;
    }
    set serverState(newVal) {
        this._serverState[expr] = newVal;
    }

    get map() {
        return this._map;
    }
    set map(newMap) {
        this._map = newMap;
        this.serverInfoChanged.emit('change');
    }

    get mapsAvail() {
        return this._mapsAvail;
    }
    set mapsAvail(newMapsAvail) {
        this._mapsAvail = newMapsAvail;
        this.serverInfoChanged.emit('change');
    }
    mapList() {
        if (this._mapFilters.length > 0) {
            return this._mapsAvail.filter((map) => {
                let found = false;
                this._mapFilters.forEach((filter) => {
                    if (map.includes(filter)) {
                        found = true;
                    }
                });
                if (this._mapFilterType === 'include') {
                    return found;
                } else {
                    return !found;
                }
            });
        } else {
            return this._mapsAvail;
        }
    }

    get mapsDetails() {
        return this._mapsDetails;
    }
    set mapsDetails(newMapsDetails) {
        this._mapsDetails = newMapsDetails;
        this.serverInfoChanged.emit('change');
    }
    mapDetails() {
        if (this._mapFilters.length > 0) {
            return this._mapsDetails.filter((map) => {
                let found = false;
                if (map.name) { // sometimes map.name is undefined for some reason.
                    this._mapFilters.forEach((filter) => {
                        if (map.name.includes(filter)) {
                            found = true;
                        }
                    });
                }
                if (this._mapFilterType === 'include') {
                    return found;
                } else {
                    return !found;
                }
            });
        } else {
            return this._mapsDetails;
        }
    }

    // Map Filter Methods
    get mapFilterType() {
        return this._mapFilterType;
    }
    set mapFilterType(type) {
        if (type === 'include' || type === 'exclude') {
            this._mapFilterType = type;
            this.serverInfoChanged.emit('change');
        }
    }
    get mapFilters() {
        return this._mapFilters;
    }
    mapFilterAdd(filter) {
        this._mapFilters.push(filter);
        this.serverInfoChanged.emit('change');
    }
    mapFilterRemove(itemToRemove) {
        if (this._mapFilters.length == 0) {
            return (0);
        }
        if (typeof itemToRemove === 'number' && this._mapFilters.length > parseInt(itemToRemove)) {
            console.log("removing number");
            this._mapFilters.splice(parseInt(itemToRemove), 1);
            this.serverInfoChanged.emit('change');
        } else {
            let newFilters = this._mapFilters.filter((currentItem) => {
                return (currentItem != itemToRemove);
            });
            this._mapFilters = newFilters;
            this.serverInfoChanged.emit('change');
        }
        return (this._mapFilters.length);
    }
    mapFilterReset() {
        this._mapFilterType = 'exclude';
        this._mapFilters = [];
        this.serverInfoChanged.emit('change');
    }

    get maxRounds() {
        return this._maxRounds;
    }
    set maxRounds(newMaxRounds) {
        this._maxRounds = newMaxRounds;
        this.serverInfoChanged.emit('change');
    }

    get score() {
            return this._score;
        }
        // Accepts array with team (T or C) and score.
    set score(newScoreArray) {
        this._score[newScoreArray[1]] = parseInt(newScoreArray[2]);
        this.serverInfoChanged.emit('change');
    }

    get pause() {
        return this._pause;    
    }
    set pause(state) {
        this._pause = state
        this.serverInfoChanged.emit('change');
    }

    get players() {
        return this._players;
    }
    addPlayer(newPlayer) {
        if (this._players.find(x => x.steamID === newPlayer.steamID) != undefined) {
            this._players.find(x => x.steamID === newPlayer.steamID).disconnected = false
        } else {
            newPlayer.team = 'U';
            newPlayer.kills = 0;
            newPlayer.deaths = 0;
            newPlayer.disconnected = false;
            this._players.push(newPlayer);
        }
        this.serverInfoChanged.emit('change');
    }
    assignPlayer(name, steamID, team) {
        if (this._players.find(x => x.steamID === steamID) == undefined ) {
            this.addPlayer({'name': name, 'steamID': steamID });
        }
        let player = this._players.find(x => x.steamID === steamID);
        player.team = team.substr(0, 1);
        this.serverInfoChanged.emit('change');
    }
    removePlayer(steamID) {
        this._players.find(x => x.steamID === steamID).disconnected = true;
        // this._players.splice(this._players.findIndex(x => x.steamID === steamID), 1);
        this.serverInfoChanged.emit('change');
    }
    clearPlayers() {
        this._players = [];
        this.serverInfoChanged.emit('change');
    }
    recordKill(killer, victim) {
        let killPlayer = this._players.find(x => x.steamID === killer);
        if (killPlayer != undefined)
            killPlayer.kills += 1;
        let victimPlayer = this._players.find(x => x.steamID === victim);
        if (victimPlayer != undefined)
            victimPlayer.deaths += 1;
        this.serverInfoChanged.emit('change');
    }

    // Methods
    getAll() {
        return {
            'map': this._map,
            'mapsAvail': this.mapList(),
            'mapsDetails': this.mapDetails(),
            'maxRounds': this._maxRounds,
            'score': this._score,
            'pause': this._pause,
            'players': this._players
        };
    }

    newMatch() {
        this._score.C = 0;
        this._score.T = 0;
        for (let i in this._players) {
            this._players[i].kills = 0;
            this._players[i].deaths = 0;
        }
        this.serverInfoChanged.emit('change');
    }
    reset() {
        // Method to be called on server quit.
        this._map = '';
        this._mapsAvail = [];
        this._mapsDetails = [];
        this._maxRounds = 0;
        this._pause = false;
        this.clearPlayers();
        this.newMatch();
    }
};

module.exports = new serverInfo();