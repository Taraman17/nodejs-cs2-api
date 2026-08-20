var controlEmitter = require("./controlEmitter.js");
const logger = require("./logger.js");
const Docker = require('dockerode');
const docker = new Docker({ socketPath: '/var/run/docker.sock' });

// For debugging purposes, write all received logs to a file.
const fs = require('fs');
const stream = fs.createWriteStream('log.txt', { flags: 'a' });

async function dockerUpdate() {
  
    const containers = await docker.listContainers();
    const name = "cs2-dedicated"
    const target = containers.find(c => c.Names.includes(`/${name}`));
    let containerId = target ? target.Id : null;

    const container = docker.getContainer(containerId);
    
    // Create a stream to the container's logs
    const logStream = await container.logs({
      follow: true,      // Keep the stream open for new logs
      stdout: true,      // Include standard output
      stderr: true,      // Include standard error
      timestamps: true,  // Include RFC3339 timestamps
      tail: 10           // Start with the last 10 lines
    });

    
    // Process each data chunk as it arrives
    logStream.on('data', (chunk) => {
      // Docker's multiplexed logs (STDOUT/STDERR) have an 8-byte header
      // The first byte identifies the stream (1 = stdout, 2 = stderr)
      // const streamType = chunk.readUInt8(0);
      const data = chunk.slice(8).toString('utf8');

      // For debugging purposes, write all received logs to a file.
      stream.write(data + '\n')
      if (data.indexOf("Checking for available updates") != -1) {
        controlEmitter.emit("progress", "Checking Steam client updates", 0);
      } else if (data.indexOf("Verifying installation") != -1) {
        controlEmitter.emit("progress", "Verifying client installation", 0);
      } else if (data.indexOf("Logging in user") != -1) {
        controlEmitter.emit("progress", "Logging in steam user", 0);
      } else if (data.indexOf("FAILED") != -1) {
        let rex = /FAILED \((.+)\)/;
        let matches = rex.exec(data);
        controlEmitter.emit("progress", `Login Failed: ${matches[1]}`, 0);
      } else if (data.indexOf("Logged in OK") != -1) {
        controlEmitter.emit("progress", "Login OK", 100);
      } else if (data.indexOf("Update state (0x") != -1) {
        let rex = /Update state \(0x\d+\) (.+), progress: (\d{1,3})\.\d{2}/;
        let matches = rex.exec(data);
        controlEmitter.emit("progress", matches[1], matches[2]);
      } else if (data.indexOf("Downloaaction update (") != -1) {
        let rex = /\[(.+)] Downloaaction update/;
        let matches = rex.exec(data);
        controlEmitter.emit(
          "progress",
          "Updating Steam client",
          matches[1].slice(0, -1),
        );
      } else if (data.indexOf("Success! App '730'") != -1) {
        controlEmitter.emit("progress", "Update successful!", 100);
        logger.verbose("Update succeeded");
        controlEmitter.emit("exec", "update", "end");
        controlEmitter.emit("exec", "start", "start");
        logStream.destroy();
      }
    });

    logStream.on('error', (err) => logger.error('Docker stream error:', err));
}

module.exports = {
  dockerUpdate
}