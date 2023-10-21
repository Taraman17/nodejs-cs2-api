/**
 * Config class for CSGO Server API
 */
class config {
    constructor() {
        this._userOptions = require('../config.js');

        this._screenCommand = `${this._userOptions.screen} -L -Logfile ${this._userOptions.screenLog} -dmS ${this._userOptions.screenName}`;
        this._csgoCommand = `${this._userOptions.csgoDir}game/bin/linuxsteamrt64/cs2 -dedicated`;
        this._serverTokenCommand = `+sv_setsteamaccount ${this._userOptions.serverToken}`;
        this._localIp = '';
    }
    get _csgoArgs() {
        return `-console -usercon -ip 0.0.0.0 +sv_logfile 1 -serverlogging +logaddress_add_http "http://${this._localIp}:${this.logPort}/log" ${this._userOptions.csgoOptionalArgs}`;
    }

    get rconPass() {
        return this._userOptions.rconPass;
    }

    get admins() {
        return this._userOptions.admins;
    }

    get redirectPage() {
        if (this._userOptions.redirectPage) {
            return this._userOptions.redirectPage;
        } else {
            return ('/gameserver.htm');
        }
    }

    get loginValidity() {
        return this._userOptions.loginValidity * 60000;
    }

    get httpAuth() {
        return this._userOptions.httpAuth;
    }
    get httpUser() {
        return this._userOptions.httpUser;
    }

    get iface() {
        return this._userOptions.iface;
    }

    get localIp() {
        return this._localIp;
    }
    set localIp(ip) {
        this._localIp = ip;
    }
    get host() {
        if (this._userOptions.host != '') {
            return this._userOptions.host;
        } else {
            return this._localIp
        }
    }

    get apiPort() {
        return this._userOptions.apiPort;
    }
    get socketPort() {
        return this._userOptions.socketPort;
    }
    get logPort() {
        return this._userOptions.logPort;
    }

    get serverCommandline() {
        let command = `${this._screenCommand} ${this._csgoCommand} ${this._csgoArgs}`;
        if (this._csgoToken != '') {
            command = `${command} ${this._serverTokenCommand}`;
        }
        return command;
    }
    get steamCommand() {
        return this._userOptions.steamExe
    }
    get updateScript() {
        if (this._userOptions.updateScript != ''){
            return this._userOptions.updateScript;
        } else {
            return `${this._userOptions.csgoDir}update_cs2.txt`;
        }
    }

    get webSockets() {
        return this._userOptions.webSockets;
    }
    get useHttps() {
        return this._userOptions.useHttps;
    }
    get scheme() {
        return (this._userOptions.useHttps ? 'https' : 'http');
    }
    get httpsCertificate() {
        return this._userOptions.httpsCertificate;
    }
    get httpsPrivateKey() {
        return this._userOptions.httpsPrivateKey;
    }
    get httpsCa() {
        return this._userOptions.httpsCa;
    }

    get corsOrigin() {
        return this._userOptions.corsOrigin;
    }
    get sessionSecret() {
        return this._userOptions.sessionSecret;
    }

    script(type) {
        return this._userOptions[`${type}Script`];
    }

    get logFile() {
        return this._userOptions.logFile;
    }
    get logLevel() {
        return this._userOptions.logLevel;
    }
    get logDays() {
        return this._userOptions.logDays;
    }
};

module.exports = new config();