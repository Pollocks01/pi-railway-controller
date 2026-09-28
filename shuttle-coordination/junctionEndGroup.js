'use strict';

const { Junctions } = require('../config/configStore');
const runtimeState = require('../config/runtimeState');
const { railwayEvents } = require('./eventBus');
const { oppositeEnd } = require('./trackEnds');
const { getChannel } = require('./junctionChannels');

/**
 * Represents every junction physically located at ONE end of ONE track
 * (e.g. "the junction(s) at the EAST end of shuttle line X") as a single
 * self-contained, self-registering object -- not config rows pushed
 * around by a central coordinator function.
 *
 * On construction it subscribes itself to the shared event bus
 * (eventBus.js) for 'track:arrived' events, and reacts ONLY to an
 * arrival at its OWN track's OPPOSITE end -- that's the arrival that
 * determines how *this* end's junction(s) need to be set, because it's
 * what the shuttle/train will meet once it reverses back out and heads
 * this way. Put another way: "a train just arrived at the other end of
 * my track, heading my way -- I need to set my own point(s) now." No
 * caller ever tells a JunctionEndGroup what to do; it works that out
 * from its own trackKind/trackId/end plus what it hears on the bus.
 *
 * A per-instance queue (`_queue`) serializes throws so two arrivals in
 * quick succession can't drive the same DRV8833 channel with two
 * overlapping, unsynchronized writes. This closes the actual bug behind
 * "junction toggle stops working after the first arrival": a previous
 * version of this codebase reset the opposite end's junctions on every
 * DEPARTURE, on a completely separate, unqueued path -- so departing the
 * end you just arrived at would immediately undo the throw that same
 * arrival had made moments earlier for the opposite end, often before
 * the shuttle had even reached it. That path is gone. The only thing
 * that ever moves this end's junctions now is an arrival at the end
 * that determines them, one throw at a time.
 */
class JunctionEndGroup {
  constructor(trackKind, trackId, end) {
    this.trackKind = trackKind;
    this.trackId = trackId;
    this.end = end;
    // Round-robin cursor for throwRoute() when multiple junctions share this
    // end (e.g. two sidings) -- advances by one on every throw so each
    // junction gets used in turn, rather than the same one being re-picked
    // (or, before route_weight existed, always junctions[0]).
    this._nextChoiceIndex = 0;
    this._queue = Promise.resolve({ chosenJunctionId: null, chosenJunctionName: null });
    this._handleArrival = this._handleArrival.bind(this);
    railwayEvents.on('track:arrived', this._handleArrival);
  }

  _handleArrival(event) {
    if (event.trackKind !== this.trackKind || event.trackId !== this.trackId) return;
    if (event.end !== oppositeEnd(this.end)) return;
    // Chain onto the queue synchronously, before any `await` runs, so a
    // second arrival landing while the first throw is still in flight is
    // appended after it rather than racing it on the same GPIO pins.
    this._queue = this._queue.then(() => this.throwRoute());
    this._queue.catch((err) => {
      console.error(
        `[JunctionEndGroup] throw failed for ${this.trackKind} track ${this.trackId} ${this.end} end:`,
        err.message
      );
    });
  }

  /**
   * Pick one junction at this end -- round-robin, in rotation, when there's
   * more than one (e.g. two sidings to choose between) -- and toggle THAT
   * junction between 'through' and 'diverging' (whichever it isn't
   * currently sitting at). Every junction remembers its own position
   * independently; nothing here forces an unselected junction back to
   * 'through' any more, since a single junction's own state is now exactly
   * "which way it was last toggled," not "diverging iff it's the chosen
   * one." Position is assumed 'through' until the first throw, matching
   * homeJunction's boot-time behaviour -- there's no hardware feedback, so
   * if a junction physically drifts out of sync during a show, that's
   * corrected by hand, not detected in software. Never touches the
   * opposite end of the track; that's a separate JunctionEndGroup's own
   * decision, made on its own next arrival.
   */
  async throwRoute() {
    const junctions = Junctions.listForEnd(this.trackKind, this.trackId, this.end);
    if (junctions.length === 0) {
      return { chosenJunctionId: null, chosenJunctionName: null };
    }

    const chosen = junctions[this._nextChoiceIndex % junctions.length];
    this._nextChoiceIndex = (this._nextChoiceIndex + 1) % junctions.length;

    const currentPosition = runtimeState.state.junctions[chosen.id]?.position || 'through';
    const nextPosition = currentPosition === 'diverging' ? 'through' : 'diverging';
    const direction = nextPosition === 'diverging' ? 'b' : 'a';
    console.log(
      `[JunctionEndGroup] ${this.trackKind} track ${this.trackId} ${this.end} end: chose "${chosen.name}" ` +
        `out of ${junctions.length} junction(s), toggling ${currentPosition} -> ${nextPosition}`
    );

    const channel = getChannel(chosen);
    runtimeState.updateJunction(chosen.id, { position: nextPosition, moving: true });
    try {
      await channel.throw_(direction);
    } finally {
      runtimeState.updateJunction(chosen.id, { moving: false });
    }

    return { chosenJunctionId: chosen.id, chosenJunctionName: chosen.name };
  }

  /**
   * Await the current throw and anything already queued ahead of it,
   * returning its outcome. For diagnostics/tests that need to know what
   * happened -- live sensor wiring never calls this, it just emits and
   * moves on (fire-and-forget), same as before this rearchitecture.
   */
  waitForIdle() {
    return this._queue;
  }

  destroy() {
    railwayEvents.off('track:arrived', this._handleArrival);
  }
}

// -----------------------------------------------------------------------
// Registry: one JunctionEndGroup per (trackKind, trackId, end) that has
// at least one junction configured. Rebuilt from scratch by layoutManager
// on every config change -- same "destroy what's running, then rebuild"
// pattern already used for TrackController and the 4.5V location sensors.
// -----------------------------------------------------------------------

const groups = new Map(); // "trackKind:trackId:end" -> JunctionEndGroup

function key(trackKind, trackId, end) {
  return `${trackKind}:${trackId}:${end}`;
}

function getJunctionEndGroup(trackKind, trackId, end) {
  return groups.get(key(trackKind, trackId, end));
}

/** Create a JunctionEndGroup for every distinct end present in `junctionsForTrack` (a Junctions.listForTrack(...) result). */
function ensureGroups(trackKind, trackId, junctionsForTrack) {
  const ends = new Set(junctionsForTrack.map((j) => j.end));
  for (const end of ends) {
    const k = key(trackKind, trackId, end);
    // Belt-and-braces against layoutManager ever calling this without
    // teardownAllGroups() first (or being called twice back to back): if a
    // live group already occupies this key, destroy it before replacing it,
    // so its 'track:arrived' listener can never linger and double-fire
    // alongside the new one. Loud on purpose -- two listeners reacting to
    // one real arrival is exactly the kind of bug that looks like "it
    // toggles on its own" from the outside.
    const existing = groups.get(k);
    if (existing) {
      console.warn(`[JunctionEndGroup] replacing an already-registered group for ${k} -- this should only happen via teardownAllGroups() first`);
      existing.destroy();
    }
    groups.set(k, new JunctionEndGroup(trackKind, trackId, end));
  }
}

function teardownAllGroups() {
  for (const group of groups.values()) group.destroy();
  groups.clear();
}

module.exports = { JunctionEndGroup, getJunctionEndGroup, ensureGroups, teardownAllGroups };
