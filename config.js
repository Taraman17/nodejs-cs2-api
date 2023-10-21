var config = {
    // Network interface over which the server is communicating. We set this and not the 
    // IP-address, in case the server is using DHCP in a LAN and not a static address.
    "iface": "eth0",
    // The server-root of your installation () - with slash at the end.
    "csgoDir": "/home/<your_user>/cs2_ds/",
    // Well, the rcon password...
    "rconPass": "YourRconPass",
    // Array of SteamID64 of Users who are allowed to control the server. For info on SteamID64 see:
    // https://steamcommunity.com/discussions/forum/1/364039785160857002/
    "admins": [],
    // The path to screen.
    "screen": "/usr/bin/screen",
    
    /* Optional settings */
    // Anything you want your server command line to have additional to:
    // -console -usercon -ip 0.0.0.0 +sv_logfile 1 -serverlogging +logaddress_add_http "http://${this._localIp}:${this.logPort}/log"
    "csgoOptionalArgs": "",
    // steam serverToken for public access. To get one see https://steamcommunity.com/dev/managegameservers
    "serverToken": "",
    // If you want to use a different name / location for the update script (absolute path).
    "updateScript": "",
    // Time in minutes, after which a new login is needed.
    "loginValidity": 300,
    // Use http authentication [true/false]
    "httpAuth": false,
    // User for digest Authentication.
    "httpUser": { "username": "", "password": "" },
    // Port, the webserver for API calls listens on.
    "apiPort": 8090,
    // Set to true if you use Websockets for status updates.
    // this is the standard and support for running without websockets will be removed in the future.
    "webSockets": true,
    // Port, the websocket is listening on.
    "socketPort": 8091,
    // Port the Logreceiver listens on.
    "logPort": 8092,
    // https settings
    "useHttps": false,
    // Hostname the certificates are valid for (e.g.: yourdomain.org).
    "host": "",
    // If you use https, add the path to the certificate files here.
    "httpsCertificate": "",
    "httpsPrivateKey": "",
    // Optional: In case your CA is not trusted by default (e.g. letsencrypt), you can add 
    // the CA-Cert here.
    "httpsCa": "",
    // Change this to any string of your liking to make it harder for attackers to profile your cookies.
    "sessionSecret": "nodejs-csgo-api",
    // The Page the client is redirected to after login if you are using a seperate webserver.
    "redirectPage": "",
    // The name screen will give the process (no spaces allowed).
    "screenName": "cs2Server",
    // The screen Logfile where the console output of screen and the server will be logged.
    // New logs are appended, so you may need to delete or rotate this log periodically.
    "screenLog": "screen.log",
    // Path to steamcmd, can stay like this if installed via package manager.
    "steamExe": "steamcmd",
    // Scripts to run on various events. Use absolute path.
    "logStartScript": "",
    "mapStartScript": "",
    "matchStartScript": "",
    "roundStartScript": "",
    "roundEndScript": "",
    "matchEndScript": "",
    //"mapEndScript": "", // For the moment I have no definite way to sense the end of map.
    "logEndScript": "",
    // Logfile for API
    "logFile": "./logs/csgoapi",
    // logLevel for API-Logfiles. In case "debug" is set, logs will also be written to console.
    "logLevel": "http",
    // how many Days should logfiles be kept?
    "logDays": "14"
};

module.exports = config;