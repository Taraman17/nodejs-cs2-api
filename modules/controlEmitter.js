const events = require('events');

/**
 * Emits information on control operations.
 */
var controlEmitter = new events.EventEmitter();
/**
 * Control execution event. Tells the start and end of control routines.
 * @event controlEmitter#exec
 * @property {string} operation (start, stop, update, mapchange)
 * @property {string} action (start, end, fail)
 */
/**
 * Tracks progress of control routines.
 * @event controlEmitter#progress
 * @property {string} step - descripbes which step of an operation is reported.
 * @property {int} progress - the percentage of the step that is completed.
 */

module.exports = controlEmitter;