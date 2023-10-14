# CS2 Server Control with a Nodejs-powered web-API (LINUX only)

## Disclaimer
The use of this software is at your own risk.
It exposes control of your server and shell functions to the internet. Although I did everything to secure the API, any bugs may lead to security breaches on your server.
I strongly adivise to use secure connections to prevent possible man-in-the-middle attacks.

## CS2 Beta Info
This is the intial beta release for CS2. It has the following changes to previous functionality
- Maplist loading is still bugged in CS2 Server - therefore working with a static Maplist. Also this has to be loaded with the "relaodMaplist" endpoint.
- Still working with the old CS_GO map-pictures, since the new ones are not yet available in the workshop
- Went back to the original rcon-srcds library instead of my patched one, since the new server seems to behave more standard-like.
- API calls are unchanged.

## Prerequisites
- steam CLI
- CS2 dedicated server
- NodeJS 14.X or higher

## Install
Download the nodejs-csgo-api-vX.X.zip and unpack.

**OR**
download the script files to and install the dependencies for nodejs
```console
npm install
```

## Configuration
The CS:GO Server must be configured to send logs to the local IP (not 127.0.0.1): on port 8092 (or the one you specified in config.js)
```
log on
sv_logecho 1
mp_logfile 1
mp_logdetail 3
mp_logmessages 1
logaddress_add_http "http://xxx.xxx.xxx.xxx:8092"
```
- Edit the settings in config.js. Most of them are explained in the sourcecode.
- The API uses steam authentication which returns a Steam ID as URL (https://steamcommunity.com/openid/id/{steamid}). The last part is the SteamID64, which can be calculated from the other SteamID formats - various online tools are available. In the configuration, an array needs to be filled with the comma separated IDs of your intended admins as strings (e.g. ['{steamid-1}', '{steamid-2}'].
- Since with credentials the CORS-Header is not allowed to be set to 'Allow-origin: *' the allowed origin(s) have to be set in the configuration at 'corsOrigin'.

## Starting
Start the script with 
```console
node serverControl.js
```

To start the API on boot and have it running in the background, I recommend [Forever](https://github.com/foreversd/forever)

## Usage
*NOTE: For API calls with basic http authentication see below.*

Use the following GET Messages to control the server. If you have certificates configured, you can also use https:// (These examples assume usage of jquery):

Note: Due to authentication with Steam, you will have to use $.ajax() with the following options.
```javascript
$.ajax({
  crossDomain: true,
  xhrFields: {
    withCredentials: true
  }
});
```
For better readability, $.get() is used in the following examples

### Login / Logout
```javascript
$.get('http://<your-servers-address>:<your-port>/csgoapi/login')
$.get('http://<your-servers-address>:<your-port>/csgoapi/logout')
$.get('http://<your-servers-address>:<your-port>/csgoapi/loginStatus')
```

For Authentication the API redirects to the Steam login page by calling '/csgoapi/login'
After authentication there, it will return to '/csgoapi/loginStatus' by default, returning { "login": true/false }.
If you use the API in a web interface, you can set 'redirectPage' in the config to your startPage (e.g. http://your-webserver/index.html) This way, you can call up the login page and then be returned to your web application after you got the session cookie in your browser.

If you want to have a manual logout in your client, call '/csgoapi/logout', which will redirect to '/csgoapi/loginStatus' to confirm the success.

### Map filtering
Filters are used to limit the maps that are transmitted to clients with the serverInfo. Filtering here consists of filter strings and a filter type. The strings are matched as parts against the maps filenames. 'cs_' would match all hostage rescue maps, 'dust' would match all maps that have dust in their names (de_dust2, de_dust, etc.).
The filter type controls if the matched maps are shown or hidden. 'inlcude' will include all matched maps in the mapsAvail and mapsDetails arrays of serverInfo, 'exclude' will hide them. For Example, if you want to play only bomb-defuse maps, you could set the filter type to 'include' and filter to 'de_'.
The filter type can only be set globally and not per filter string.

Current filter settings can be queried with
```javascript
$.get('http://<your-servers-address>:<your-port>/csgoapi/v1.0/filter')
```
Return value is JSON: { "type": {string}, "filters": {array of strings} }

Filter control works like this:
```javascript
$.get('http://<your-servers-address>:<your-port>/csgoapi/v1.0/filter/reset')
$.post('http://<your-servers-address>:<your-port>/csgoapi/v1.0/filter/<anAction>')
```
actions can be:
- reset (get) -> Resets the filter to tpye 'exclude' and no filter strings.
- add?filter= (post) -> Adds the given string to the filters.
- remove?filter= (post) -> Removes the given string, if it exists.
- type (post) -> Sets the filter type ('include' or 'exclude');

If successful, the call will return the new filter-info, else a JSON error string. E.g.: { "error": "No filter was removed." }

### Server Control
```javascript
$.get('http://<your-servers-address>:<your-port>/csgoapi/v1.0/control/<anAction>')
```
The /control message will return a JSON-String.
'action' can have the following values:
- status -> fetch the servers running status: { "running": true/false }
- update -> update the server (may take quite some time): { "success": true/false }
- start -> optional additional argument "startmap" (?startmap=mapname): { "success": true/false }
If run without startmap, server will be started with de_dust2.
- stop -> stop the server with RCON 'quit': { "success": true/false }
- kill -> use 'kill' command to shutdown the server, if RCON connection is not working: { "success": true/false }
- changemap -> additional argument "map" (action=changemap&map=mapname): 
- reloadmaplist -> reload the available maps on the server (action=reloadmaplist): { "success": true/false }

If you do not use websockets, the answer will be sent after completion of the operation.
If you use websockets, answer will be sent right away. Progress and/or completion messages are sent via the websocket. See below for format. Exception is server start, since RCON-authentication is a vital step for the api, 'start' will always return "success" only after authentication finished.

### RCON
```javascript
$.get('http://<your-servers-address>:<your-port>/csgoapi/v1.0/rcon', 'message=command')
```
'command' is the command as you would enter it in the servers console.
Answer is the response as string.

### Server Info
```javascript
$.get('http://<your-servers-address>:<your-port>/csgoapi/v1.0/info/serverInfo')
```
Gets information on the server as JSON-String. See serverInfo.js for available data.

```javascript
$.get('http://<your-servers-address>:<your-port>/csgoapi/v1.0/info/runstatus')
$.get('http://<your-servers-address>:<your-port>/csgoapi/v1.0/info/rconauthstatus')
```
Query if the server is running or also authenticated for rcon requests. Answer is deleayed if a status change is in progress.

## Information Updates via WebSocket
A websocket is available on a configurable port to receive further information.
Currently avialable are ServerInfo as any value changes, start/stop/fail of commands, update-progress and completion of mapchange (on start of new map).

ServerInfo message looks as follows:
```javascript
{ "type": "serverInfo", "payload": {ServerInfoObject}
```
For now, Serverinfo is always sent completely

Start/stop of a command:
```javascript
{ "type": "commandstatus", "payload": { "operation": <string>, "state": <"start"/"stop"/"fail"> } }
```
Operation can be one of the following: start, stop, update, mapchange

UpdateProgress looks as follows:
```javascript
{ "type": "updateProgress", "payload": { "step": <string>, "progress": <int> } }
```
## Api calls with http authentication
For stateless API-Calls via command line or other automatic tools the http basic authentication can be activated in the config with
```
"httpAuth": true,
"httpUser": { "username": "", "password": "" },
```
For now, only one user can be specified.

**If you enable this option, you should use https to avoid sending of paswords in the clear.**

The interface is:
```
http://<your-servers-address>:<your-port>/csgoapi/http/v1.0/...
```

## Example
An example of a webinterface is available in the folder "example"
It assumes, that you run it on the same domain as the API. If you want to change that, you can do so in js/gameserver.js (see comment in the file)
To correctly load the maplist for server start, edit the respective line at the beginning of gameserver.js.
The Webinterface works with and without websockets.

## Support
If you have any questions, contact me.
If you find any bugs or have feature requests, don't hesitate to open an issue.
