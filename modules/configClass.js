/**
 * Config class for CSGO Server API
 */
class config {
    constructor() {
        this._userOptions = require('../config.js');

        this.screenCommand = `${this._userOptions.screen} -L -Logfile ${this._userOptions.screenLog} -dmS ${this._userOptions.screenName}`;
        this.csgoCommand = `${this._userOptions.csgoDir}/cs2 -dedicated`;
        this.csgoArgs = `-console -usercon +sv_setsteamaccount ${this._userOptions.serverToken} ${this._userOptions.csgoOptionalArgs}`;
    }

    get rconPass() {
        return this._userOptions.rconPass;
    }

    get admins() {
        return this._userOptions.admins;
    }

    get redirectPage() {
        return this._userOptions.redirectPage;
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

    get host() {
        return this._userOptions.host;
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
        return `${this.screenCommand} ${this.csgoCommand} ${this.csgoArgs}`;
    }
    get updateCommand() {
        return this._userOptions.steamExe
    }
    get updateScript() {
        return this._userOptions.updateScript;
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