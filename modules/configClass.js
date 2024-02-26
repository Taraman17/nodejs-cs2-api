/**
 * Config class for CSGO Server API
 */
class config {
    #userOptions = require('../config.js');
    #screenCommand;
    #csgoCommand;
    #serverTokenCommand;
    #localIp;

    constructor() {
        this.#screenCommand = `${this.#userOptions.screen} -L -Logfile ${this.#userOptions.screenLog} -dmS ${this.#userOptions.screenName}`;
        this.#csgoCommand = `${this.#userOptions.csgoDir}game/bin/linuxsteamrt64/cs2 -dedicated`;
        this.#serverTokenCommand = `+sv_setsteamaccount ${this.#userOptions.serverToken}`;
        this.#localIp = '';
    }
    get #csgoArgs() {
        return `-console -usercon -ip 0.0.0.0 +sv_logfile 1 -serverlogging +logaddress_add_http "http://${this.#localIp}:${this.#userOptions.logPort}/log" ${this.#userOptions.csgoOptionalArgs}`;
    }

    get apiToken() {
        return this.#userOptions.apiToken;
    }
    get rconPass() {
        return this.#userOptions.rconPass;
    }

    get admins() {
        return this.#userOptions.admins;
    }

    get workshopCollection() {
        return this.#userOptions.workshopCollection;
    }
    set workshopCollection(id) {
        this.#userOptions.workshopCollection = id;
    }
    get workshopMaps() {
        return this.#userOptions.workshopMaps;
    }
    set workshopMaps(maps) {
        this.#userOptions.workshopMaps = maps;
    }

    get redirectPage() {
        if (this.#userOptions.redirectPage) {
            return this.#userOptions.redirectPage;
        } else {
            return ('/gameserver.htm');
        }
    }

    get loginValidity() {
        return this.#userOptions.loginValidity * 60000;
    }

    get httpAuth() {
        return this.#userOptions.httpAuth;
    }
    get httpUser() {
        return this.#userOptions.httpUser;
    }

    get iface() {
        return this.#userOptions.iface;
    }

    get localIp() {
        return this.#localIp;
    }
    set localIp(ip) {
        this.#localIp = ip;
    }
    get host() {
        if (this.#userOptions.host != '' && this.#userOptions.useHttps) {
            return this.#userOptions.host;
        } else {
            return this.#localIp
        }
    }

    get apiPort() {
        return this.#userOptions.apiPort;
    }
    get socketPort() {
        return this.#userOptions.socketPort;
    }
    get logPort() {
        return this.#userOptions.logPort;
    }

    get serverCommandline() {
        let command = `${this.#screenCommand} ${this.#csgoCommand} ${this.#csgoArgs}`;
        if (this._csgoToken != '') {
            command = `${command} ${this.#serverTokenCommand}`;
        }
        return command;
    }
    get steamCommand() {
        return this.#userOptions.steamExe
    }
    get updateScript() {
        if (this.#userOptions.updateScript != ''){
            return this.#userOptions.updateScript;
        } else {
            return `${this.#userOptions.csgoDir}update_cs2.txt`;
        }
    }

    get webSockets() {
        return this.#userOptions.webSockets;
    }
    get useHttps() {
        return this.#userOptions.useHttps;
    }
    get scheme() {
        return (this.#userOptions.useHttps ? 'https' : 'http');
    }
    get httpsCertificate() {
        return this.#userOptions.httpsCertificate;
    }
    get httpsPrivateKey() {
        return this.#userOptions.httpsPrivateKey;
    }
    get httpsCa() {
        return this.#userOptions.httpsCa;
    }

    get corsOrigin() {
        return this.#userOptions.corsOrigin;
    }
    get sessionSecret() {
        return this.#userOptions.sessionSecret;
    }

    script(type) {
        return this.#userOptions[`${type}Script`];
    }

    get logFile() {
        return this.#userOptions.logFile;
    }
    get logLevel() {
        return this.#userOptions.logLevel;
    }
    get logDays() {
        return this.#userOptions.logDays;
    }
}

module.exports = new config();