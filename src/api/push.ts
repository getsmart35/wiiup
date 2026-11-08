/**
 * The push protocol on the live socket, shared by the app and server/ (one contract for both, like a proto file).
 * Modeled on Uber's RAMEN push platform: numbered messages, real-time acks on the same stream, redelivery of
 * unacknowledged messages, resume after reconnect, server heartbeats, and control messages.
 *
 * Connect: `WS /v1/live?token=…&resume=<epoch>:<lastSeq>` (resume is optional).
 */

/** Server → app. */
export type ServerFrame =
  /** First frame on every socket. A new `epoch` means the server lost the session: start counting again. */
  | { t: 'hello'; epoch: string; seq: number; heartbeatMs: number; resumed: boolean }
  /**
   * An app message. `ack` is set on messages that must be delivered: the app acks them, and the server resends
   * them until it does or they expire. Messages without it (like car positions) may be dropped on a slow network.
   */
  | { t: 'msg'; seq: number; ack?: true; body: unknown }
  | { t: 'hb'; at: number }
  /** The server asks the app to reconnect (for example while it restarts), after waiting `afterMs`. */
  | { t: 'ctl'; action: 'reconnect'; afterMs: number; reason: string };

/** App → server, besides its own messages (sub, online, location, …). Acks are cumulative. */
export type AckFrame = { type: 'ack'; seq: number };

/** The app reconnects if it hears nothing (no message or heartbeat) for this long past the heartbeat interval. */
export const HEARTBEAT_GRACE_MS = 2000;
