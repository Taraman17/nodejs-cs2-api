const controlEmitter = require("./controlEmitter.js");
const logger = require("./logger.js");

function reportUpdateProgress(data) {
  if (data.includes("Checking for available updates")) {
    controlEmitter.emit("progress", "Checking Steam client updates", 0);
  } else if (data.includes("Verifying installation")) {
    controlEmitter.emit("progress", "Verifying client installation", 0);
  } else if (data.includes("Logging in user")) {
    controlEmitter.emit("progress", "Logging in steam user", 0);
  } else if (data.includes("FAILED")) {
    const matches = /FAILED \((.+)\)/.exec(data);
    controlEmitter.emit(
      "progress",
      `Login Failed: ${matches ? matches[1] : "unknown error"}`,
      0,
    );
  } else if (data.includes("Logged in OK")) {
    controlEmitter.emit("progress", "Login OK", 100);
  } else if (data.includes("Update state (0x")) {
    const matches =
      /Update state \(0x\d+\) (.+), progress: (\d{1,3})\.\d{2}/.exec(data);
    if (matches) {
      controlEmitter.emit("progress", matches[1], matches[2]);
    }
  } else if (data.includes("Downloaaction update (")) {
    const matches = /\[(.+)] Downloaaction update/.exec(data);
    if (matches) {
      controlEmitter.emit(
        "progress",
        "Updating Steam client",
        matches[1].slice(0, -1),
      );
    }
  } else if (data.includes("Success!")) {
    controlEmitter.emit("progress", "Update successful!", 100);
    logger.verbose("Update succeeded");
    controlEmitter.emit("exec", "update", "end");
    return true;
  }

  return false;
}

module.exports = reportUpdateProgress;
