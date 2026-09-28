'use strict';

const { EventEmitter } = require('events');

/**
 * Shared event bus for the layout's "device" layer.
 *
 * This is the backbone of the event-driven rearchitecture: a sensor wired
 * up in shuttleEvents.js (4.5V location sensors) or trackController.js
 * (12V end-of-line sensors) looks at its own role/end/track once, and
 * emits a small, typed, self-described event here -- it does not know or
 * care who's listening or what they'll do about it. A JunctionEndGroup
 * (see junctionEndGroup.js) representing the junction(s) at one physical
 * end of one track independently subscribes to this bus, works out for
 * itself whether a given event is relevant to its own location, and
 * decides what (if anything) to throw. Nothing calls into a junction
 * directly any more; everything reacts to what it hears on the bus.
 *
 * Events:
 *   'track:arrived' { trackKind: '12v'|'45v', trackId: string, end: 'east'|'west' }
 *     A shuttle/train's leading obstacle sensor has fired at `end` of
 *     `trackId`. This is the ONLY event that ever causes a junction to
 *     move. Emitted once per real arrival -- never on departure/clear,
 *     which previously (see the removed resetJunctionsAtEnd in
 *     shuttleEvents.js) raced against and undid the very throw the prior
 *     arrival had just made for the leg the shuttle was now running.
 *
 * No fixed listener count is expected -- every JunctionEndGroup on the
 * layout subscribes, and the layout can be rebuilt at any time -- so the
 * default Node MaxListeners warning is disabled here.
 */
const railwayEvents = new EventEmitter();
railwayEvents.setMaxListeners(0);

module.exports = { railwayEvents };
