// Change here if you don't host the webInterfae on the same host as the NodeJS API
const host = window.location.hostname;
const protocol = window.location.protocol;
const address = `${protocol}//${host}:8090/csgoapi`;
const apiPath = `${address}/v1.0`;
const maplistFile = "./maplist.txt";

// Titles for throbber window.
const titles = {
  start: "Starting server",
  stop: "Stopping server",
  auth: "Authenticating RCON",
  update: "Updating server",
  mapchange: "Changing map",
  pause: "Pausing/Unpausing match",
};

// Redirect to login page.
function doLogin() {
  window.location.href = `${address}/login`;
}

// Sends a get Request with the headers needed for authentication with the seesion cookie.
function sendGet(address, data, callback) {
  return $.ajax({
    type: "GET",
    url: address,
    data: data,
    cache: false,
    crossDomain: true,
    xhrFields: {
      withCredentials: true,
    },
    success: callback,
  });
}

// Load the maplist for serverstart from maplist.txt
function loadMaplist() {
  // The Maplist file can be taken from the csgo folder.
  $.get(maplistFile, (data) => {
    let lines = data.split(/\r\n|\n/);
    lines.forEach((map) => {
      $("#mapAuswahl").append(`<option value="${map}">${map}</option>`);
    });
  });
}

// Setup the Elements according to server status.
function setupPage() {
  $("#popupCaption").text("Querying Server");
  let getPromise = (path) => {
    return Promise.resolve(sendGet(`${address}/${path}`));
  };

  let loginCheck = getPromise("loginStatus");
  loginCheck
    .then((data) => {
      if (data.login) {
        let authenticated = getPromise("v1.0/info/rconauthstatus");
        authenticated
          .then((data) => {
            if (data.rconauth) {
              setupServerRunning();
            } else {
              let serverRunning = getPromise("v1.0/info/runstatus");
              serverRunning.then((data) => {
                if (data.running) {
                  window.location.href = "./notauth.htm";
                } else {
                  setupServerStopped();
                }
              });
            }
          })
          .catch(() => {
            setupServerStopped();
          });
      } else {
        setupNotLoggedIn();
      }
    })
    .catch(() => {
      setupNotLoggedIn();
    });

  $("#container-popup").css("display", "none");
}

function setupNotLoggedIn() {
  $("#power-image").hide(0);
  $("#startMap").hide(0);
  $("#buttonStop").hide(0);
  $("#buttonStart").hide(0);
  $("#buttonUpdate").hide(0);
  $("#buttonLogin").show(0);
  $("#addControl").hide(0);
  $("#serverInfo").hide(0);
  $("#mapControl").hide(0);
}

function setupServerRunning() {
  $("#power-image").attr("src", "pic/power-on.png");
  if (socket.readyState != 1) {
    // if websocket not connected
    getMaps();
  } else if ($("#mapSelector div").length < 2) {
    socket.send("infoRequest");
  }
  $("#startMap").hide(0);
  $("#buttonStop").show(0);
  $("#buttonStart").hide(0);
  $("#buttonUpdate").hide(0);
  $("#buttonLogin").hide(0);
  $("#addControl").show(0);
  $("#serverInfo").css("display", "flex");
  $("#mapControl").show(0);
}

function setupServerStopped() {
  $("#power-image").attr("src", "pic/power-off.png");
  $("#startMap").show(0);
  $("#buttonStart").show(0);
  $("#buttonStop").hide(0);
  $("#buttonUpdate").show(0);
  $("#buttonLogin").hide(0);
  $("#serverInfo").hide(0);
  $("#addControl").hide(0);
  $("#mapControl").hide(0);
  $("#mapSelector").hide("fast");
}

function clickButton(aButton) {
  let action = aButton.value.toLowerCase();
  $("#popupCaption").text(`${titles[action]}`);
  $("#popupText").text("Moment bitte!");
  $("#container-popup").css("display", "flex");
  let startMap = document.getElementById("mapAuswahl").value;

  sendGet(`${apiPath}/control/${action}`, `startmap=${startMap}`)
    .done((data) => {
      if (socket.readyState != 1) {
        // if websocket not connected
        if (action != "update") {
          setupPage();
        }
        $("#container-popup").hide();
      }
    })
    .fail((err) => {
      let errorText = err.responseJSON.error;
      if (errorText.indexOf("Another Operation is pending:") != -1) {
        let operation = errorText.split(":")[1];
        alert(`${operation} running.\nTry again in a moment.`);
      } else {
        alert(`command ${action} failed!\nError: ${errorText}`);
        window.location.href = "./notauth.htm";
      }
      if (socket.readyState != 1) {
        $("#container-popup").css("display", "none");
      }
    });
}

function showPlayerMenu(event) {
  $("#playerDropdown").css({
    top: event.pageY,
    left: event.pageX,
    display: "block",
  });
  $("#playerDropdown").attr("player", event.target.textContent);
  // Close the dropdown menu if the user clicks outside of it
  window.onclick = function (event) {
    if (!event.target.matches(".dropbtn")) {
      $("#playerDropdown").css("display", "none");
      window.onclick = "";
    }
  };
}

function movePlayer(event) {
  // This function uses sourcemod plugin "moveplayers" -> https://forums.alliedmods.net/showthread.php?p=2471466
  /* "sm_movect"                        - Move a player to the counter-terrorist team.
       "sm_movespec"                      - Move a player to the spectators team.
       "sm_movet"                         - Move a player to the terrorist team. */
  let player = event.target.parentElement.getAttribute("player");
  let command = event.target.getAttribute("command");
  sendGet(
    `${apiPath}/rcon`,
    `message=sm_move${command} "${player}"`,
    (data) => {
      // no actions for now.
    }
  );
}

function getMaps() {
  function getServerInfo() {
    return Promise.resolve(sendGet(`${apiPath}/info/serverInfo`));
  }
  let serverInfo = getServerInfo();
  serverInfo
    .then((data) => {
      $("#currentMap").html(`Current map: ${data.map}`);
      maplist = data.mapsDetails;
      $("#mapSelector").empty();
      maplist.forEach((map) => {
        if ("content" in document.createElement("template")) {
          var mapDiv = document.querySelector("#maptemplate");
          mapDiv.content.querySelector(".mapname").textContent = map.title;
          mapDiv.content
            .querySelector(".mapimg")
            .setAttribute("src", map.previewLink);
          mapDiv.content
            .querySelector(".map")
            .setAttribute("id", map.workshopID);
          $("#mapSelector").append(document.importNode(mapDiv.content, true));
        } else {
          let alttext = createElement("h2");
          text.html(
            "Your browser does not have HTML template support - please use another browser."
          );
          $("#mapSelector").append(alttext);
        }
      });
    })
    .catch((error) => {
      // do nothing for now
    });
}

function toggleMaplist() {
  $("#mapSelector").toggle("fast");
}

function showPlay(event) {
  if (event.currentTarget.classList.contains("active")) {
    changeMap(event);
    $(".map").removeClass("active");
  } else {
    $(".active > .playicon").hide(0);
    $(".active").removeClass("active");
    event.currentTarget.classList.add("active");
    event.currentTarget.children[1].style.display = "block";
  }
}

function changeMap(event) {
  let map = event.currentTarget.firstElementChild.textContent;
  $("#mapSelector").hide("fast");
  // $('#popupCaption').text(titles['mapchange']);
  // $('#container-popup').css('display', 'flex');
  sendGet(`${apiPath}/control/changemap`, `map=${map}`, (data) => {
    if (data.success) {
      $("#popupText").html(`Changing map to ${map}`);
    } else {
      $("#popupText").html(`Mapchange failed!`);
      window.setTimeout(() => {
        $("#container-popup").css("display", "none");
      }, 2000);
    }
  });
}

function restartRound() {
  sendGet(`${apiPath}/rcon`, `message=mp_restartgame 1`, (data) => {
    $("#popupCaption").text(`Restart Round`);
    $("#popupText").html(`Round Restarted!`);
    $("#container-popup").css("display", "flex");
    window.setTimeout(() => {
      $("#container-popup").css("display", "none");
    }, 1000);
  });
}

function pauseGame() {
  sendGet(`${apiPath}/control/pause`).done((data) => {
    if (data.success) {
      if (socket.readyState != 1) {
        // if websocket not connected
        $("#pause-overlay").css("top", $("#serverControl").position().top);
        $("#pause-overlay").css(
          "height",
          $("#serverInfo").height() + $("#serverControl").height()
        );
        $("#pause-overlay").css("display", "flex");
      }
    } else {
      alert("Pausing the match failed!");
    }
  });
}

function resumeGame() {
  sendGet(`${apiPath}/control/unpause`).done((data) => {
    if (data.success) {
      if (socket.readyState != 1) {
        // if websocket not connected
        $("#pause-overlay").hide();
      }
    } else {
      alert("Unpausing the match failed!");
    }
  });
}

function authenticate(caller) {
  sendGet(`${apiPath}/authenticate`).done((data) => {
    if (data.authenticated) {
      window.location.href = "./gameserver.htm";
    } else {
      caller.disabled = true;
      $("#autherror").show("fast");
    }
  });
}

function kill(caller) {
  sendGet(`${apiPath}/control/kill`)
    .done((data) => {
      window.location.href = "./gameserver.htm";
    })
    .fail((error) => {
      caller.disabled = true;
      $("#killerror").show("fast");
    });
}

// Bot Training functions
function setBotRules() {
  sendGet(`${apiPath}/rcon`, `message=mp_autoteambalance 0`);
  sendGet(`${apiPath}/rcon`, `message=mp_limitteams 0`);
  sendGet(`${apiPath}/rcon`, `message=bot_difficulty 3`);
}

function addBots(team, quantity) {
  for (let i = 0; i < quantity; i++) {
    setTimeout(sendGet(`${apiPath}/rcon`, `message=bot_add_${team}`), 100);
  }
}

function kickBots() {
  sendGet(`${apiPath}/rcon`, `message=bot_kick all`);
}

// what to do after document is loaded.
var socket = null;
$(document).ready(() => {
  let startSocket = () => {
    try {
      if (protocol == "https:") {
        socket = new WebSocket(`wss://${host}:8091`);
      } else {
        socket = new WebSocket(`ws://${host}:8091`);
      }
    } catch (err) {
      console.error("Connection to websocket failed:\n" + err);
    }

    socket.onopen = () => {
      socket.send("infoRequest");
    };

    socket.onmessage = (e) => {
      let data = JSON.parse(e.data);

      if (data.type == "serverInfo") {
        let serverInfo = data.payload;

        $("#currentMap").html(`Current map: ${serverInfo.map}`);
        $("#scoreT").text(serverInfo.score.T);
        $("#scoreCT").text(serverInfo.score.C);
        $("#rounds").html(
          `Rounds: ${serverInfo.maxRounds} / Left: ${
            serverInfo.maxRounds - (serverInfo.score.T + serverInfo.score.C)
          }`
        );

        $(".playerDiv ul").empty();
        $(".playerDiv").hide(0);
        if (serverInfo.players.length > 0) {
          for (let i = 0; i < serverInfo.players.length; i++) {
            let player = serverInfo.players[i];
            if (player.disconnected) {
              break;
            }
            if ("content" in document.createElement("template")) {
              var playerLi = document.querySelector("#playerTemplate");
              playerLi.content.querySelector(".playerName").textContent =
                player.name;
              playerLi.content.querySelector(
                ".playerKills"
              ).textContent = `K: ${player.kills}`;
              playerLi.content.querySelector(
                ".playerDeaths"
              ).textContent = `D: ${player.deaths}`;
              $(`#${player.team.toLowerCase()}List`).append(
                document.importNode(playerLi.content, true)
              );
            } else {
              let alttext = document.createElement("li");
              alttext.html(
                "Your browser does not have HTML template support - please use another browser."
              );
              $(`#${player.team.toLowerCase()}List`).append(alttext);
            }
            $(`#${player.team.toLowerCase()}Players`).show(0);
          }
        }
        if (serverInfo.pause) {
          $("#pause-overlay").css("top", $("#serverControl").position().top);
          $("#pause-overlay").css(
            "height",
            $("#serverInfo").height() + $("#serverControl").height()
          );
          $("#pause-overlay").css("display", "flex");
        } else {
          $("#pause-overlay").hide();
        }
        if ($("#mapSelector .map").length != serverInfo.mapsDetails.length) {
          if (serverInfo.mapsDetails) {
            let maplist = serverInfo.mapsDetails;
            $("#mapSelector").empty();
            maplist.forEach((map) => {
              if ("content" in document.createElement("template")) {
                var mapDiv = document.querySelector("#maptemplate");
                mapDiv.content.querySelector(".mapname").textContent =
                  map.title;
                mapDiv.content
                  .querySelector(".mapimg")
                  .setAttribute("src", map.previewLink ? map.previewLink : "");
                mapDiv.content
                  .querySelector(".map")
                  .setAttribute("id", map.workshopID);
                $("#mapSelector").append(
                  document.importNode(mapDiv.content, true)
                );
              } else {
                let alttext = document.createElement("h2");
                alttext.html(
                  "Your browser does not have HTML template support - please use another browser."
                );
                $("#mapSelector").append(alttext);
              }
            });
          }
        }
      } else if (data.type == "commandstatus") {
        if (data.payload.state == "start") {
          $("#popupCaption").text(`${titles[data.payload.operation]}`);
          $("#popupText").text("Moment bitte!");
          $("#container-popup").css("display", "flex");
        } else if (
          data.payload.state == "end" &&
          data.payload.operation != "start"
        ) {
          $("#popupText").html(`${data.payload.operation} success!`);
          setTimeout(() => {
            $("#container-popup").css("display", "none");
            setupPage();
          }, 1500);
        } else if (data.payload.state == "fail") {
          $("#popupText").html(`${data.payload.operation} failed!`);
          setTimeout(() => {
            $("#container-popup").css("display", "none");
            if (
              data.payload.operation != "update" &&
              data.payload.operation != "mapchange"
            ) {
              window.location.href = "./notauth.htm";
            }
          }, 3000);
        }
      } else if (data.type == "progress") {
        $("#popupText").html(`${data.payload.step}: ${data.payload.progress}%`);
      } else if (data.type == "mapchange") {
        if (
          data.payload.success$ &&
          $("#popupCaption").text() == "Changing Map"
        ) {
          socket.send("infoRequest");
          $("#container-popup").css("display", "none");
        } else if (!data.payload.success) {
          $("#popupText").html("Mapchange failed!");
        }
      }
    };

    socket.onclose = () => {
      // connection closed, discard old websocket and create a new one in 5s
      socket = null;
      setTimeout(startSocket, 5000);
    };
  };
  startSocket();
  loadMaplist();
  setupPage();
});
