import type {
  Driver,
  DriverTrip,
  FareQuote,
  InstantPayout,
  LatLng,
  Place,
  Ride,
  RideRequest,
  TripForBid,
} from './types';
import type { PlanId } from '@/lib/plans';
import { useAuth } from '@/store/useAuth';
import { useLocation } from '@/store/useLocation';
import { useRateCards } from '@/store/useRateCards';
import { tripVault } from '@/store/useTripVault';
import { createHttpService } from './http';
import { createMockService } from './mock';

export type Unsubscribe = () => void;

export type RequestRideInput = {
  riderName: string;
  pickup: Place;
  dropoff: Place;
  /** The exact quote the rider confirmed, so they pay what they saw. */
  quote: FareQuote;
  /** 'bid' asks nearby drivers to bid on the trip instead of matching at the quoted price. */
  mode?: 'match' | 'bid';
};

export type DriverTripAction = 'arrived' | 'start' | 'complete' | 'cancel';

/**
 * Everything the screens need from a backend. Set EXPO_PUBLIC_API_URL to use the WiiUp server (server/);
 * without it the app runs on the in-memory mock.
 */
export interface RideService {
  // Sign-in. `demoCode` is set while there is no SMS provider; `token` is null on the mock.
  startSignIn(phone: string): Promise<{ demoCode?: string }>;
  verifySignIn(input: { name: string; phone: string; code: string }): Promise<{ token: string | null }>;

  // Rider
  getNearbyDrivers(center: LatLng): Promise<Driver[]>;
  getQuotes(pickup: LatLng, dropoff: LatLng): Promise<FareQuote[]>;
  requestRide(input: RequestRideInput): Promise<Ride>;
  cancelRide(rideId: string): Promise<void>;
  subscribeRide(rideId: string, cb: (ride: Ride) => void): Unsubscribe;
  /** Books the driver who made this bid, at their fare. */
  acceptBid(rideId: string, bidId: string): Promise<void>;
  /** Removes a bid so the next lowest one can show. */
  declineBid(rideId: string, bidId: string): Promise<void>;

  // Driver
  subscribeRequests(getLocation: () => LatLng, cb: (req: RideRequest) => void): Unsubscribe;
  /** `earnings` comes from the driver's own rate card, and the driver keeps all of it. */
  acceptRequest(request: RideRequest, driverLocation: LatLng, earnings: number): Promise<DriverTrip>;
  requestInstantPayout(amount: number, fee: number, destination: string): Promise<InstantPayout>;
  purchaseUpgrade(plan: PlanId, price: number): Promise<void>;
  /** Sends a livery license for verification. An admin approves or declines it. */
  applyForPlatinum(license: string): Promise<{ submittedAt: number }>;
  getPlatinumReview(submittedAt: number): Promise<'pending' | 'approved' | 'rejected'>;
  updateDriverTrip(tripId: string, action: DriverTripAction): Promise<void>;
  subscribeDriverTrip(tripId: string, cb: (trip: DriverTrip) => void): Unsubscribe;
  /** Open trips near the driver that take bids, priced from their rate card. Called again on every change. */
  subscribeTripsForBid(getLocation: () => LatLng, cb: (trips: TripForBid[]) => void): Unsubscribe;
  placeBid(tripId: string, fare: number): Promise<void>;
}

const API_URL = process.env.EXPO_PUBLIC_API_URL;

export const api: RideService = API_URL
  ? createHttpService(API_URL, {
      getToken: () => useAuth.getState().user?.token,
      onUnauthorized: () => useAuth.getState().signOut(),
      getDriverSettings: () => {
        const { cards, plan, subscribedAt } = useRateCards.getState();
        return { cards, plan, subscribedAt };
      },
      getLocation: () => useLocation.getState().coords,
      vault: tripVault,
    })
  : createMockService();
