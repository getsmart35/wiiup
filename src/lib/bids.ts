/**
 * Trip bidding: a rider can ask nearby drivers to bid instead of taking the standard price. Up to ten drivers
 * can bid on a trip. Each starts from their own rate card's price for the trip and sets their fare within a range.
 * The rider sees the three lowest bids and accepts or declines each; the driver keeps 100% of the fare they bid.
 * The range, step and timings are placeholders until WiiUp sets them.
 * Copy of web-prototype/src/lib/bids.ts: keep the copies identical apart from this line.
 */

/** A bid can go from 80% to 150% of the driver's rate card price for the trip. */
export const BID_RANGE = { min: 0.8, max: 1.5 };
export const BID_STEP = 0.5;
/** How many bids a rider sees at once. Declining one makes room for the next lowest. */
export const BIDS_SHOWN = 3;
/** How many drivers can bid on one trip. After that the trip stops taking bids. */
export const MAX_BIDDERS = 10;
/** How long a trip takes bids before it closes. */
export const BIDDING_WINDOW_MS = 3 * 60 * 1000;
/** How long one bid stays open for the rider to accept. */
export const BID_TTL_MS = 60 * 1000;

const toStep = (n: number) => Math.round(n / BID_STEP) * BID_STEP;

/** The lowest and highest fare a driver can bid, from their rate card price for the trip. */
export function bidLimits(cardFare: number) {
  return { min: Math.max(BID_STEP, Math.ceil((cardFare * BID_RANGE.min) / BID_STEP) * BID_STEP), max: Math.floor((cardFare * BID_RANGE.max) / BID_STEP) * BID_STEP };
}

/** Rounds a fare to the bid step and keeps it within the driver's limits. */
export function clampBid(fare: number, limits: { min: number; max: number }) {
  return Math.min(limits.max, Math.max(limits.min, toStep(fare)));
}

/** The bids a rider sees: open ones, lowest fare first, then earliest. */
export function visibleBids<T extends { fare: number; placedAt: number; status: string }>(bids: T[]) {
  return bids
    .filter((b) => b.status === 'pending')
    .sort((a, b) => a.fare - b.fare || a.placedAt - b.placedAt)
    .slice(0, BIDS_SHOWN);
}
