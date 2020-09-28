# CS:GO Server Control with a Nodejs-powered web-API

## Disclaimer
As of now, this script should only be used on private servers not accessible from the internet.
It allows control of the the Server and as of now has no built in Authentication. So basically everyone could takeover your server.

Authentication is the next todo on my list.

## Install
download the script files to and install the dependencies for nodejs
```console
npm install --save rcon-srcds srcds-log-receiver node-pty ws 
```

## Configuration
Edit the settings in config.js

The CS:GO Server must be configured to send logs to the local IP (not 127.0.0.1): on port 9871
```
log on
mp_logfile 1
mp_logdetail 3
mp_logmessages 1
logaddress_add xxx.xxx.xxx.xxx:9871
```

## Usage
Start the script with 
```console
node serverControl.js
```
Then use the following GET Messages to control the server. If you have certificates configured, you can also use https:// (These examples assume usage of jquery):
### Server Control
```javascript
$.get('http://your-servers-address:8090/control', 'action=status')
```
The /control message will return a JSON-String.
'action' can have the following values:
- status -> fetch the servers running status: { "running": true/false }
- update -> update the server (may take quite some time): { "success": true/false }
- start -> optional additional argument "starmap" (action=start&startmap=mapname): { "success": true/false }<br>
If run without startmap, server will be started with famous de_dust2.
- changemap -> additional argument "map" (action=changemap&map=mapname): 
If you do not use websockets, the answer will be { "success": true/false }. true if start of new map is logged, false in case of error or after a timeout of 30 seconds.
If you use websockets, answer will be { "success": true/false } if the rcon command to server was sauccessful or not. Completion of mapchange is sent via the websocket in the format: { "type": "mapchange", "payload": { "success": true } }
Note: currently only answer is true, since there is no log entry for a failed mapchange. Clients therefore have to set a timeout thmeselves.
- stop -> stop the server: { "success": true/false }

### RCON
```javascript
$.get('http://your-servers-address:8090/rcon', 'message=command')
```
'command' is the command as you would enter it in the servers console.
Answer is the response as string.

### Server Info
```javascript
$.get('http://your-servers-address:8090/serverInfo')
```
Gets information on the server as JSON-String. See serverInfo.js for available data.

## Information Updates via WebSocket
A websocket is available on port 8091 to receive further information.
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
