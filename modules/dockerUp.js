var controlEmitter = require("./controlEmitter.js");
const logger = require("./logger.js");
const reportUpdateProgress = require("./updateProgress.js");
const Docker = require("dockerode");
const docker = new Docker({ socketPath: "/var/run/docker.sock" });

// For debugging purposes, write all received logs to a file.
const fs = require("fs");
const stream = fs.createWriteStream("log.txt", { flags: "a" });

async function dockerUpdate() {
  const containers = await docker.listContainers();
  const name = "cs2-dedicated";
  const target = containers.find((c) => c.Names.includes(`/${name}`));
  let containerId = target ? target.Id : null;

  const container = docker.getContainer(containerId);

  // Create a stream to the container's logs
  const logStream = await container.logs({
    follow: true, // Keep the stream open for new logs
    stdout: true, // Include standard output
    stderr: true, // Include standard error
    timestamps: true, // Include RFC3339 timestamps
    tail: 10, // Start with the last 10 lines
  });

  // Process each data chunk as it arrives
  logStream.on("data", (chunk) => {
    // Docker's multiplexed logs (STDOUT/STDERR) have an 8-byte header
    // The first byte identifies the stream (1 = stdout, 2 = stderr)
    // const streamType = chunk.readUInt8(0);
    const data = chunk.slice(8).toString("utf8");

    // For debugging purposes, write all received logs to a file.
    stream.write(data + "\n");
    if (reportUpdateProgress(data)) {
      controlEmitter.emit("exec", "start", "start");
      logStream.destroy();
    }
  });

  logStream.on("error", (err) => logger.error("Docker stream error:", err));
}

module.exports = {
  dockerUpdate,
};
