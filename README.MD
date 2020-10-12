# CS:GO Server Control with a Nodejs-powered web-API

## Disclaimer
As of now, this script should only be used on private servers not accessible from the internet.
It allows control of the the Server and as of now has no built in Authentication. So basically everyone could takeover your server.

Authentication is the next todo on my list.

## Install
download the script files to and install the dependencies for nodejs
```console
npm install --save rcon-srcds srcds-log-receiver express express-session cors passport passport-steam node-pty ws 
```

## Configuration
The CS:GO Server must be configured to send logs to the local IP (not 127.0.0.1): on port 9871
```
log on
mp_logfile 1
mp_logdetail 3
mp_logmessages 1
logaddress_add xxx.xxx.xxx.xxx:9871
```
- Edit the settings in config.js. Most of them are explained in the sourcecode.
- The API uses steam authentication which returns a Steam ID as URL (https://steamcommunity.com/openid/id/<steamid>). The last part is the SteamID64, which can be calculated from the other SteamID formats - various online tools are available. In the configuration, an array needs to be filled with the comma separated IDs of your intended admins as strings (e.g. ['<steamid-1>', '<steamid-2>'].
- Since with credentials the CORS-Header is not allowed to be set to 'Allow-origin: *' the allowed origin(s) have to be set in the configuration at 'corsOrigin'.


## Usage
Start the script with 
```console
node serverControl.js
```
Then use the following GET Messages to control the server. If you have certificates configured, you can also use https:// (These examples assume usage of jquery):

Note: Due to authentication, you will have to use $.ajax() with the following options.
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
$.get('http://<your-servers-address>:<your-port>/login')
$.get('http://<your-servers-address>:<your-port>/logout')
$.get('http://<your-servers-address>:<your-port>/loginStatus')
```

For Authentication the API redirects to the Steam login page by calling '/login'
After authentication there, it will return to '/loginStatus' by default, returning { "login": true/false }.
If you use the API in a web interface, you can set 'redirectPage' in the config to your startPage (e.g. http://your-webserver/index.html) This way, you can call up the login page and then be returned to your web application after you got the session cookie in your browser.

If you want to have a manual logout in your client, call '/logout', which will redirect to '/loginStatus' to confirm the success.

### Server Control
```javascript
$.get('http://<your-servers-address>:<your-port>/control', 'action=<anAction>')
```
The /control message will return a JSON-String.
'action' can have the following values:
- status -> fetch the servers running status: { "running": true/false }
- update -> update the server (may take quite some time): { "success": true/false }
- start -> optional additional argument "starmap" (action=start&startmap=mapname): { "success": true/false }
If run without startmap, server will be started with famous de_dust2.
- changemap -> additional argument "map" (action=changemap&map=mapname): 
If you do not use websockets, the answer will be { "success": true/false }. true if start of new map is logged, false in case of error or after a timeout of 30 seconds.
If you use websockets, answer will be { "success": true/false } if the rcon command to server was sauccessful or not. Completion of mapchange is sent via the websocket in the format:
```javascript
{ "type": "mapchange", "payload": { "success": true/false } }
```
- reloadmaplist -> reload the available maps on the server (action=reloadmaplist): { "success": true/false }
- stop -> stop the server: { "success": true/false }

### RCON
```javascript
$.get('http://<your-servers-address>:<your-port>/rcon', 'message=command')
```
'command' is the command as you would enter it in the servers console.
Answer is the response as string.

### Server Info
```javascript
$.get('http://<your-servers-address>:<your-port>/serverInfo')
```
Gets information on the server as JSON-String. See serverInfo.js for available data.

## Information Updates via WebSocket
A websocket is available a configurable port to receive further information.
Currently avialable are update-progress, ServerInfo as any value changes and completion of mapchange (on start of new map).

ServerInfo message looks as follows:
```javascript
{ "type": "serverInfo", "payload": ${JSON.stringify(serverInfo.getAll())}
```
For now, Serverinfo is always sent completely

UpdateProgress looks as follows:
```javascript
{ "type": "updateProgress", "payload": { "step": <string>, "progress": <int> } }
```

mapchange message:
```javascript
{ "type": "mapchange", "payload": { "success": true/false }
```
false is sent after a 30 sec. timeout when no "Started map" log has been received.

## Support
If you have any questions, contact me.
If you find any bugs or have feature requests, don't hesitate to open an issue.
