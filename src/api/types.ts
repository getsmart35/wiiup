export type LatLng = { latitude: number; longitude: number };

export type Place = {
  id: string;
  name: string;
  address: string;
  coords: LatLng;
};

export type RideTier = 'go' | 'comfort' | 'xl' | 'platinum';

export type FareQuote = {
  /** Set by the server so a ride request can only use a price it issued. The mock leaves it out. */
  id?: string;
  tier: RideTier;
  label: string;
  seats: number;
  fare: number; // USD
  surge: number; // multiplier, 1 = none
  etaMin: number; // driver pickup ETA
  distanceKm: number;
  durationMin: number;
};

export type Driver = {
  id: string;
  name: string;
  rating: number;
  car: string;
  plate: string;
  color: string;
  location: LatLng;
};

export type RideStatus =
  /** Waiting for the rider to accept a driver's bid. */
  | 'bidding'
  | 'searching'
  | 'driver_assigned'
  | 'arriving'
  | 'arrived'
  | 'in_trip'
  | 'completed'
  | 'cancelled';

export type Ride = {
  id: string;
  riderName: string;
  pickup: Place;
  dropoff: Place;
  quote: FareQuote;
  status: RideStatus;
  driver?: Driver;
  /** Minutes until the next milestone (pickup while arriving, dropoff while in trip). */
  liveEtaMin?: number;
  createdAt: number;
  completedAt?: number;
  rating?: number;
  tip?: number;
  /** 'bid' when the rider asked drivers to bid on the trip. */
  mode?: 'match' | 'bid';
  /** While bidding: the open bids the rider can choose from (at most three, lowest first). */
  bids?: Bid[];
  /** When the trip stops taking bids. */
  biddingClosesAt?: number;
};

export type BidStatus = 'pending' | 'accepted' | 'declined' | 'expired' | 'lost';

/** A driver's fare for a trip. The rider pays it and the driver keeps all of it. */
export type Bid = {
  id: string;
  rideId: string;
  driver: Driver;
  fare: number;
  /** Minutes for this driver to reach the pickup. */
  etaMin: number;
  placedAt: number;
  expiresAt: number;
  status: BidStatus;
};

/** An open trip on a driver's bid board, priced from that driver's own rate card. */
export type TripForBid = {
  id: string;
  riderName: string;
  riderRating: number;
  pickup: Place;
  dropoff: Place;
  quote: FareQuote;
  /** The driver's rate card price for this trip, where their bid starts. */
  cardFare: number;
  minBid: number;
  maxBid: number;
  closesAt: number;
  /** How many more drivers can bid (up to MAX_BIDDERS in total). */
  bidsLeft: number;
  /** This driver's bid, and the trip if the rider accepted it. */
  myBid?: { id: string; fare: number; status: BidStatus; trip?: DriverTrip };
};

/** An offer shown to a driver while they are online. */
export type RideRequest = {
  id: string;
  riderName: string;
  riderRating: number;
  pickup: Place;
  dropoff: Place;
  quote: FareQuote;
  expiresAt: number;
};

export type InstantPayout = { id: string; amount: number; fee: number; net: number; destination: string; at: number };

export type DriverTripStage = 'to_pickup' | 'at_pickup' | 'in_trip' | 'completed';

export type DriverTrip = {
  id: string;
  request: RideRequest;
  stage: DriverTripStage;
  location: LatLng;
  liveEtaMin: number;
  earnings: number;
  acceptedAt: number;
  completedAt?: number;
  /** Set when the trip ended early. A cancelled trip earns nothing. */
  cancelledBy?: 'rider' | 'driver';
};
