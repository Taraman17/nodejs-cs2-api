const events = require('events');

module.exports = class serverInfo {
    constructor (options = {}) {
        // data section
        this._map = '';
        this._mapsAvail = []
        this._mapsDetails = [
            //{ 'name': '',
            //  'title': '',
            //  'description': '',
            //  'previewLink': '',
            //  'tags': [{ "tag": "" }] }
        ];
        this._mapFilterType = 'exclude'; // 'include / exclude',
        this._mapFilters = []; // ['string', /regex/]
        this._maxRounds = 0;
        this._score = {
            'T': 0,
            'C': 0
        };
        this._players = [
            //{ 'name': '',
            //  'steamID': '',
            //  'team': '' }
        ];
        
        // emitter to notify of changes
        this.serverInfoChanged = new events.EventEmitter();
    }

// getter / setter
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
        if (this._mapFilters.length > 0 ) {
            return this._mapsAvail.filter( (map) => {
                let found = false;
                this._mapFilters.forEach( (filter) => {
                    let currentFilter = filter
                    if (filter.constructor.name != "RegExp") {
                      currentFilter = new RegExp(filter)
                    }
                    if (currentFilter.test(map)) {
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
        return this._mapsAvail;
    }
    set mapsDetails(newMapsDetails) {
        this._mapsDetails = newMapsDetails;
        this.serverInfoChanged.emit('change');
    }
    mapDetails() {
        if (this._mapFilters.length > 0 ) {
            return this._mapsDetails.filter( (map) => {
                let found = false;
                this._mapFilters.forEach( (filter) => {
                    let currentFilter = filter
                    if (filter.constructor.name != "RegExp") {
                      currentFilter = new RegExp(filter)
                    }
                    if (currentFilter.test(map.name)) {
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
            return this._mapsDetails;
        }
    }

    get mapFilterType() {
        return this._mapFilterType;
    }
    set mapFilterType(type) {
        // only set if a valid string is given.
        if ((type === 'include' || type === 'exclude')) {
            this._mapFilterType = type;
        }
    }
    get mapFilters() {
        return this._mapFilters;
    }
    mapFilterAdd(filter) {
        this._mapFilters.push(filter)
    }
    mapFilterRemove(itemToRemove) {
        if (this._mapFilters.length == 0) {
            return;
        }
        if (typeof filter === number) {
            this._mapFilters.splice(filter, 1);
        } else {
            let newFilters = this._mapFilters.filter( (currentItem) => {
                return (currentItem != itemToRemove);
            });
            this._mapFilters = newFilters;
        }
    }
    mapFilterReset() {
        this._mapFilterType = 'exclude';
        this._mapFilters = [];
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

    get players() {
        return this._players;
    }
    addPlayer(newPlayer) {
        newPlayer.team = 'U';
        this._players.push(newPlayer);
        this.serverInfoChanged.emit('change');
    }
    assignPlayer(steamID, team) {
        for (let i=0; i < this._players.length; i++) {
            if (this._players[i].steamID == steamID) {
                this._players[i].team = team.substr(0,1);
                i = this._players.length;
            }
        }
        this.serverInfoChanged.emit('change');
    }
    removePlayer(steamID) {
        for (let i=0; i < this._players.length; i++) {
            if (this._players[i].steamID == steamID) {
                this._players.splice(i, 1);
                i = this._players.length;
            }
        }
        this.serverInfoChanged.emit('change');
    }
    clearPlayers() {
        this._players = [];
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
            'players': this._players
        };
    }

    newMatch() {
        this._score.C = 0;
        this._score.T = 0;
        this.serverInfoChanged.emit('change');
    }
};