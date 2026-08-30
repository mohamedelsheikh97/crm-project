import { EventEmitter } from 'node:events';

/**
 * An in-process loudspeaker for notifications that have ALREADY been persisted.
 *
 * IT DECIDES NOTHING. No filtering, no permission check, no formatting, no
 * knowledge of what a notification means. Producers decide what to write, the
 * notification service decides who receives it, and this carries an
 * already-saved row to whichever connections happen to be listening
 * (Constitution Principle III — this is infrastructure, not business logic,
 * which is why it lives in lib/ rather than services/).
 *
 * THE ORDERING RULE, which is the whole reason this file is so small:
 * everything publishes AFTER its transaction commits. A notification that
 * exists in the database but was never emitted is a latency bug the client's
 * catch-up query fixes on its next connect. A notification emitted for a
 * transaction that then rolls back is a lie no query can fix.
 *
 * KNOWN LIMIT (plan.md Complexity Tracking): this is process memory, so it
 * assumes ONE backend process. With two, a notification still reaches every
 * recipient correctly — the row is written first — but the live half only
 * reaches agents connected to the emitting process; the rest see it on their
 * next poll or reload. Lifting that means putting a shared bus behind this
 * module, which is why every publish goes through one function.
 */

/** The payload is the serialised notification the client will render. */
export type NotificationPayload = Record<string, unknown>;

type Listener = (payload: NotificationPayload) => void;

const emitter = new EventEmitter();

// One held connection per signed-in agent, and a listener per connection. The
// Node default of 10 would print a spurious leak warning at the eleventh
// concurrent agent, which is a normal team size rather than a bug.
emitter.setMaxListeners(0);

function channel(userId: number): string {
  return `user:${userId}`;
}

/**
 * Emit a persisted notification to any live connection for its recipient.
 *
 * Returns nothing and throws nothing on "no listeners" — an offline recipient
 * is the normal case, not an error. Their notification is already a row, and
 * they will see it at next sign-in (FR-047).
 */
export function publish(userId: number, payload: NotificationPayload): void {
  emitter.emit(channel(userId), payload);
}

/**
 * Subscribe a connection to its user's notifications.
 *
 * Returns the unsubscribe function rather than expecting the caller to
 * reconstruct the listener reference — a stream route that fails to detach on
 * `close` leaks a listener per reconnect, and reconnects are routine here.
 */
export function subscribe(userId: number, listener: Listener): () => void {
  emitter.on(channel(userId), listener);

  return () => {
    emitter.off(channel(userId), listener);
  };
}

/** Live connection count for a user. Used by tests, not by any decision. */
export function listenerCount(userId: number): number {
  return emitter.listenerCount(channel(userId));
}
