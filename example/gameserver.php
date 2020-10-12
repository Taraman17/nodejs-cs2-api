<!DOCTYPE HTML>
<html>
<head>
    <title>CS:GO Gameserver</title>
    <link href="gameserver.css" rel="stylesheet" type="text/css">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=yes">
</head>

<body alink="#000099"
      link="#000099"
      vlink="#990099">

    <div class="container-popup">
        <div class="popup">
            <div id="popupCaption" class="ueberschrift">Server wird gestartet</div>
            <div id="popupText" class="unterschrift">augenblick bitte</div>
        </div>
    </div>

    <div id="header" class="section">
        <p class="text" id="header-text">CS:GO Server</p>
    </div>
    <div id="serverControl" class="clearfix section">
        <div id="runControl">
            <image id="power-image" src="pic/power-off.png">
            <input id="buttonUpdate"
                   type="button"
                   class="text"
                   value="Update"
                   onclick="clickButton(this);"/>
            <input id="buttonStart"
                   type="button"
                   class="text"
                   value="Start"
                   onclick="clickButton(this);"/>
            <input id="buttonRestart"
                   type="button"
                   class="text"
                   value="Restart"
                   onclick="clickButton(this);"/>
            <input id="buttonStop"
                   type="button"
                   class="text"
                   value="Stop"
                   onclick="clickButton(this);"/>
            <input id="buttonLogin"
                   type="button"
                   class="text"
                   value="Login"
                   onclick="doLogin(this);"/>
        </div>
        <div id="startMap" class="label clearfix">
            Starten mit:&nbsp;&nbsp;
            <select id="mapAuswahl">
    <?php
            // change path here to load the list of maps to start the server with.
            $maplist = file("/home/csgo/csgo_ds/csgo/maplist.txt", FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
            foreach($maplist as $value){ // Loop through each element
                print("            <option value=".$value.">".$value."</option>\n");
            }
    ?>
            </select>
        </div>
    </div>
    <div id="serverInfo" class="clearfix section">
        <div id="gameInfo">
            <div id="currentMap" class="label">current Map:</div>
            <div id="rounds" class="label">Rounds: 30 / Left: 30</div>
            <div id="score" class="label">Score: CT: <span id="scoreCT">0</span> / T: <span id="scoreT">0</span></div>
        </div>
        <div id="players">
            <h3>Players:</h3>
            <div id="playerLists" onclick="showPlayerMenu(event);">
                <div id="cPlayers" class="playerDiv">
                    <h4 class="counter">Counter Terrorists</h4>
                    <ul id="cList">
                    </ul>
                </div>
                <div id="tPlayers" class="playerDiv">
                    <h4 class="terrorist">Terrorists</h4>
                    <ul id="tList">
                    </ul>
                </div>
                <div id="uPlayers" class="playerDiv">
                    <h4>Unassigned</h4>
                    <ul id="uList">
                    </ul>
                </div>
                <div id="sPlayers" class="playerDiv">
                    <h4>Spectators</h4>
                    <ul id="sList">
                    </ul>
                </div>
            </div>
        </div>
    </div>
    <div id="mapControl">
        <input type="button" id="restart" class="text" onclick="restartRound()" value="Restart Round"/>
        <input type="button" id="changeMap" class="text" onclick="toggleMaplist()" value="Change Map"/>
        <div id="mapSelector">
            <ul id="mapList">
                <li id="noMaps">No maps loaded.</li>
            </ul>
        </div>
    </div>
    <div id="playerDropdown" class="dropdown-menu">
        <p onclick='movePlayer(event);' command="t">Move to T</p>
        <p onclick='movePlayer(event);' command="ct">Move to CT</p>
        <p onclick='movePlayer(event);' command="spec">Move to Spectators</p>
        <p onclick='alert("test");'>Kick from Server</p>
  </div>
    <script type="text/javascript" src="js/jquery-3.4.1.min.js"></script>
    <script type="text/javascript" src="js/gameserver.js"></script>
</body>
</html>