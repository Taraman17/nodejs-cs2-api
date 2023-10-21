"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
/**
 * Packet Types
 * Reference: https://developer.valvesoftware.com/wiki/Source_RCON#Requests_and_Responses
 *
 * @readonly
 */
var protocol = Object.freeze({
    SERVERDATA_AUTH: 0x03,
    SERVERDATA_EXECCOMMAND: 0x02,
    SERVERDATA_AUTH_RESPONSE: 0x02,
    SERVERDATA_RESPONSE_VALUE: 0x00,
    ID_AUTH: 0x999,
    ID_REQUEST: 0x123,
});
exports.default = protocol;
