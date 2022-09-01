"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
var net_1 = require("net");
var protocol_1 = __importDefault(require("./protocol"));
var packets = __importStar(require("./packet"));
var RCON = /** @class */ (function () {
    /**
     * Source RCON (https://developer.valvesoftware.com/wiki/Source_RCON)
     * @param options Connection options
     */
    function RCON(options) {
        this.host = options.host || '127.0.0.1';
        this.port = options.port || 27015;
        this.maxPacketSize = options.maxPacketSize || 4096;
        this.encoding = options.encoding || 'ascii';
        this.timeout = options.timeout || 1000;
        this.authenticated = false;
        this.connected = false;
    }
    /**
     * Authenticates the connection
     * @param password Password string
     */
    RCON.prototype.authenticate = function (password) {
        return __awaiter(this, void 0, void 0, function () {
            var _this = this;
            return __generator(this, function (_a) {
                switch (_a.label) {
                    case 0:
                        if (!!this.connected) return [3 /*break*/, 2];
                        return [4 /*yield*/, this.connect()];
                    case 1:
                        _a.sent();
                        _a.label = 2;
                    case 2: return [2 /*return*/, new Promise(function (resolve, reject) {
                            if (_this.authenticated) {
                                reject(Error('Already authenticated'));
                                return;
                            }
                            _this.write(protocol_1.default.SERVERDATA_AUTH, protocol_1.default.ID_AUTH, password)
                                .then(function (data) {
                                if (data === true) {
                                    _this.authenticated = true;
                                    resolve(true);
                                }
                                else {
                                    _this.disconnect();
                                    reject(Error('Unable to authenticate'));
                                }
                            }).catch(reject);
                        })];
                }
            });
        });
    };
    /**
     * Executes command on the server
     * @param command Command to execute
     */
    RCON.prototype.execute = function (command) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            if (!_this.connected) {
                reject(Error('Already disconnected. Please reauthenticate.'));
                return;
            }
            var packetId = Math.floor(Math.random() * (256 - 1) + 1);
            if (!_this.connection.writable) {
                reject(Error('Unable to write to socket'));
                return;
            }
            if (!_this.authenticated) {
                reject(Error('Not authorized'));
                return;
            }
            _this.write(protocol_1.default.SERVERDATA_EXECCOMMAND, packetId, command)
                .then(resolve)
                .catch(reject);
        });
    };
    /**
     * Creates a connection to the socket
     */
    RCON.prototype.connect = function () {
        var _this = this;
        return new Promise(function (resolve, reject) {
            _this.connection = net_1.createConnection({
                host: _this.host,
                port: _this.port
            }, function () {
                if (_this.connection)
                    _this.connection.removeListener('error', reject);
                _this.connected = true;
                resolve();
            });
            _this.connection.once('error', reject);
            _this.connection.setTimeout(_this.timeout);
        });
    };
    /**
     * Destroys the socket connection
     */
    RCON.prototype.disconnect = function () {
        var _this = this;
        this.authenticated = false;
        this.connected = false;
        this.connection.destroy();
        return new Promise(function (resolve, reject) {
            var onError = function (e) {
                _this.connection.removeListener('close', onClose);
                reject(e);
            };
            var onClose = function () {
                _this.connection.removeListener('error', onError);
                resolve();
            };
            _this.connection.once('close', onClose);
            _this.connection.once('error', onError);
        });
    };
    RCON.prototype.isConnected = function () {
        return this.connected;
    };
    RCON.prototype.isAuthenticated = function () {
        return this.authenticated;
    };
    /**
     * Writes to socket connection
     * @param type Packet Type
     * @param id Packet ID
     * @param body Packet payload
     */
    RCON.prototype.write = function (type, id, body) {
        var _this = this;
        return new Promise(function (resolve, reject) {
            var response = '';
            var onData = function (packet) {
                var decodedPacket = packets.decode(packet, _this.encoding);
                // Server will respond twice (0x00 and 0x02) if we send an auth packet (0x03)
                // but we need 0x02 to confirm
                if (type === protocol_1.default.SERVERDATA_AUTH && decodedPacket.type !== protocol_1.default.SERVERDATA_AUTH_RESPONSE) {
                    return;
                }
                else if (type === protocol_1.default.SERVERDATA_AUTH && decodedPacket.type === protocol_1.default.SERVERDATA_AUTH_RESPONSE) {
                    if (decodedPacket.id === protocol_1.default.ID_AUTH) {
                        resolve(true);
                    }
                    else {
                        resolve(false);
                    }
                    _this.connection.removeListener('data', onData);
                }
                else if (id === decodedPacket.id) {
                    response = response.concat(decodedPacket.body.replace(/\n$/, '\n')); // remove last line break
                    // Check the response if it's defined rather than if it contains 'command ${body}'
                    // Reason for this is because we no longer need to check if it starts with 'command', testing shows it never will
                    if (response.includes(body)) {
                        _this.connection.removeListener('data', onData);
                        resolve(response);
                    }
                }
                _this.connection.removeListener('error', onError);
            };
            var onError = function (e) {
                _this.connection.removeListener('data', onData);
                reject(e);
            };
            var encodedPacket = packets.encode(type, id, body, _this.encoding);
            if (_this.maxPacketSize > 0 && encodedPacket.length > _this.maxPacketSize) {
                reject(Error('Packet size too big'));
                return;
            }
            _this.connection.on('data', onData);
            _this.connection.on('error', onError);
            _this.connection.write(encodedPacket);
        });
    };
    return RCON;
}());
exports.default = RCON;
