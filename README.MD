# CS:GO Server Control with a Nodejs-powered web-API

## Disclaimer
As of now, this script should only be used on private servers not yccessible from the internet.
It allows control of the the Server and as of now has no built in Authentication. So basically everyone could takeover your server.

Secure communication and authentication are the next todos on my list.

## Install
download the script files to and install the dependencies for nodejs
```console
npm install --save rcon-srcds srcds-log-receiver node-pty ws 
```

## Configuration
Edit the settings in config.js
