/**
 * Config class for CSGO Server API
 */
module.exports = class config {
    constructor () {
        this._userOptions = {
            // Network interface over which the server is communicating. We set this and not the 
            // IP-address, in case the server is using DHCP in a LAN and not a static address.
            'iface': 'eth0',
            // Hostname of the machine, this script runs on (e.g.: yourdomain.org).
            // Leave empty if you use the IP of iface.
            'host': '',
            // steam serverToken. To get one see https://steamcommunity.com/dev/managegameservers
            'serverToken': '<token>',
            // Well, the rcon password...
            'rconPass': 'YourRconPass',
            // SteamID64 of Users who are allowed to control the server. For info on SteamID64 see:
            // https://steamcommunity.com/discussions/forum/1/364039785160857002/
            'admins': [],
            // The Page the client is redirected to after login - see README for more info.
            'redirectPage': '/loginStatus',
            // Time in minutes, after which a new login is needed.
            'loginValidity': 300,
            // Port, the webserver for API calls listens on.
            'apiPort': 8090,
            // Set to true if you use Websockets for status updates.
            'webSockets': false,
            // Port, the websocket is listening on.
            'socketPort': 8091,
            // https settings
            'useHttps': false,
            // Optional: If you use https, add the path to the certificate files here.
            'httpsCertificate': '',
            'httpsPrivateKey': '',
            // Optional: In case your CA is not trusted by default (e.g. letsencrypt), you can add 
            // the CA-Cert here.
            'httpsCa': '',
            // CORS origin setting. '*' is not allowed since login credentials are sent with requests.
            // For possible values see:
            // https://expressjs.com/en/resources/middleware/cors.html#configuration-options
            'corsOrigin': 'localhost',
            // Change this to any string of your liking to make it harder for attackers to profile your cookies.
            'sessionSecret': 'nodejs-csgo-api',
            // The folder, where your srcds_run is located.
            'csgoDir': '/home/csgo/csgo_ds',
            // Anything you want your server command line to have additional to:
            //   -game csgo -console -usercon +sv_setsteamaccount
            'csgoOptionalArgs': '-insecure +sv_lan 1 +sv_pure 0 -ip 0.0.0.0 +mapgroup mg_all',
            // The path to screen.
            'screen': '/usr/bin/screen',
            // The name screen will give the process (no spaces allowed).
            'screenName': 'csgoServer',
            // The screen Logfile where the console output of screen and the server will be logged.
            // New logs are appended, so you may need to delete or rotate this log periodically.
            'screenLog': '/home/csgo/screen.log',
            // Path to steamcmd, can stay like this if installed via package manager.
            'steamExe': 'steamcmd',
            // Steam Account to update the server with steamcmd.
            'steamAccount': '<username> <password>',
            // Script to pass into steamcmd to update.
            // See https://steamcommunity.com/discussions/forum/1/492379159713970561/ for more info.
            'updateScript': '/home/csgo/update_csgo.txt',
            // Scripts to run on various events. Use absolute path.
            'logStartScript': '',
            'mapStartScript': '',
            'matchStartScript': '',
            'roundStartScript': '',
            'roundEndScript': '',
            'matchEndScript': '',
            //'mapEndScript': '', // For the moment I have no definite way to sense the end of map.
            'logEndScript': '',
            // Logfile for API
            'logFile': '/var/log/csgo-api/log.txt',
            // logLevel for API-Logfiles
            'logLevel': 'info'
        };

        this.screenCommand = `${this._userOptions.screen} -L -Logfile ${this._userOptions.screenLog} -dmS ${this._userOptions.screenName}`;
        this.csgoCommand = `${this._userOptions.csgoDir}/srcds_run`;
        this.csgoArgs = `-game csgo -console -usercon +sv_setsteamaccount ${this._userOptions.serverToken} ${this._userOptions.csgoOptionalArgs}`;
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

    get iface() {
        return this._userOptions.iface;
    }

    get host() {
        return this._userOptions.host;
    }

    get apiPort(){
        return this._userOptions.apiPort;
    }
    get socketPort(){
        return this._userOptions.socketPort;
    }

    get serverCommandline() {
        return `${this.screenCommand} ${this.csgoCommand} ${this.csgoArgs}`;
    }
    get updateCommand() {
        return this._userOptions.steamExe
    }
    get updateArguments() {
        return [`+login ${this._userOptions.steamAccount}`,
                `+runscript ${this._userOptions.updateScript}`];
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
};
