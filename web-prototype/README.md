# WiiUp web prototype (React + MapLibre + Directions)

A browser version of the WiiUp rider and driver flows, separate from the Expo app in `../src`.
It is a design prototype: trips are simulated, but streets, routes, distances and turn instructions are real.

- **Map:** MapLibre GL JS with CARTO's free vector basemaps (Dark Matter / Positron, no key needed).
- **Routing:** Mapbox Directions API (`driving-traffic`, with steps, banner and voice instructions) when
  `VITE_MAPBOX_TOKEN` is set. Without a token it falls back to the public OSRM demo server, which returns
  the same route shape; instruction text and voice prompts are then generated locally.
- **Navigation:** `src/lib/navigation.ts` does what the Mapbox Navigation SDK does on iOS/Android: route
  progress, upcoming maneuver, distance to it, time remaining, and voice prompts (Web Speech API). The
  Navigation SDK itself is native-only, so this is the web stand-in, fed by a simulated car
  (`src/lib/useRouteSim.ts`) instead of GPS.

## Run

```bash
cd web-prototype
npm install
cp .env.example .env      # optional: paste your Mapbox pk.… token
npm run dev
```

Demo sign-in code: **1234**. The demo city is San Francisco (`src/lib/places.ts`).

**Rider:** Where to? → pick a place → fares are computed from the route's real distance and time → Confirm →
the driver drives the real route to you, then to the destination → rate and tip.

**Driver:** Account → Drive → Go online → Accept within 15 s → heading-up navigation with maneuver banner,
"then" hint, ETA and spoken prompts (mute and overview buttons on the right) → I've arrived → Start trip →
Complete trip → earnings update.

**Rate cards:** on the driver home screen, tap the three lines to open the menu, then **My rate card**. Each ride type
shows suggested and custom rates with − and + buttons, plus a switch to use the suggested card; Submit applies the rates
to your next ride offer. **Rate calculator** in the same menu estimates a trip and a month. Rider quotes and driver pay now use the same price, so a custom card changes both.
**Instant payout** on the driver home screen and in the menu cashes out the balance for a transaction fee (simulated).

**Plans:** Silver and Gold are paid in about $50 installments. Reaching a limit stops ride offers until the driver upgrades
for the rest of the billing period (Silver to Gold, Gold to Gold Plus). Periods repeat from the subscription date.
Platinum needs a livery license and admin approval.

## Files

```
src/lib/directions.ts   Mapbox Directions / OSRM client, instruction text, voice prompts
src/lib/navigation.ts   route progress (the Navigation SDK stand-in)
src/lib/useRouteSim.ts  simulated vehicle + voice prompt timing
src/components/MapCanvas.tsx  MapLibre map: route, traveled overlay, markers, follow camera
src/store.tsx           app state and the ride / drive flows
src/screens/            rider and driver screens
```

## Notes

- Keep the Mapbox token in `.env` (gitignored). Use a public `pk.` token restricted to your dev URL.
- The OSRM demo server is rate-limited and meant for light testing only.
- Bringing this to the Expo app would mean `@rnmapbox/maps` plus the Mapbox Navigation SDK through a
  development build; neither runs in Expo Go.
