# WiiUp — iOS rideshare app (front end MVP)

React Native + Expo (SDK 58) + Expo Router + TypeScript. One app with **Ride** and **Drive** modes.
Every screen talks to `src/api/client.ts`. By default that is an in-memory mock (`src/api/mock.ts`) that simulates
drivers, matching, live car movement and ride requests; set `EXPO_PUBLIC_API_URL` to use the WiiUp server in `server/` instead.

## Run it

```bash
npm install
npx expo start
```

- **iPhone:** install **Expo Go** from the App Store and scan the QR code with the Camera app.
- **iOS Simulator:** requires full Xcode. Then press `i` in the Expo terminal.

Sign in with any name and phone number. The demo verification code is **1234**.

## Demo walkthrough

**Rider:** Where to? → pick a place → choose WiiUp Go / Comfort / XL → Confirm → watch the driver get matched,
drive to you and take you to the destination → rate + tip → see it in Account → Your trips.

**Driver:** Account → Mode: Drive → Go online → a request arrives within a few seconds (15 s to accept) →
Accept → I've arrived → Start trip → Complete trip → earnings update (tap the $ pill or chart icon).

Simulation speeds live in `MOCK_TIMING` in `src/api/mock.ts`.

## Structure

```
src/app/            Expo Router screens
  (auth)/           welcome, sign-in
  (rider)/          index (map home), search, options, trip, rate
  (driver)/         drive (online/offline + offers), drive-trip, earnings
  profile.tsx       account, Ride/Drive switch, sign out
  history.tsx       past rides
src/api/            types, RideService interface (client.ts), mock implementation
src/store/          zustand stores (auth, location, ride, driver) persisted to AsyncStorage
src/lib/            fare calculation, geo helpers, place search (expo-location geocoding + seeded places)
src/components/     shared UI (Sheet, Button, RideTierCard, DriverCard, map markers, …)
src/theme.ts        brand colors (light/dark), spacing, type
```

## Connecting the backend

The WiiUp server lives in `server/`; see `server/README.md`. Start it with `cd server && npm install && npm run dev`,
then put `EXPO_PUBLIC_API_URL=http://<your computer's network address>:8787` in `.env.local` and restart Expo.
Without that variable the app runs on the mock. Both implement the `RideService` interface in `src/api/client.ts`
(`src/api/http.ts` for the server, `src/api/mock.ts` for the mock).

## Not in this MVP

Real payments (fares are estimates; card is a placeholder), real SMS auth, turn-by-turn routing
(routes are approximated), push notifications, chat/calls.

## Checks

```bash
npx tsc --noEmit
npx expo lint
```
