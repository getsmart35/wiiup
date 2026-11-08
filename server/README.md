# WiiUp server

The backend for the WiiUp app: sign-in, ride quotes, matching riders with drivers, live trip updates,
instant payouts, plan upgrades and Platinum approvals.

It is built with Node and TypeScript. It stores data in SQLite (built into Node) and depends on one
library, `ws`, for WebSockets. Prices, plan limits and payout fees come from the app's own
`src/lib`, so the server and the app use the same rules.

## Run it

You need Node 22.13 or later.

```bash
cd server
npm install
npm run dev          # restarts on changes; http://localhost:8787
```

To connect the app, create `.env.local` in the app folder (one level up) with your computer's
network address. A phone can't reach `localhost` on your computer.

```bash
EXPO_PUBLIC_API_URL=http://192.168.1.20:8787
```

Restart `npx expo start` after creating the file. Without `EXPO_PUBLIC_API_URL`, the app keeps
using its built-in mock.

**Simulation** is on by default outside production. You can demo on one phone because:

- Simulated drivers take rides that no real driver accepts.
- Online drivers get simulated ride requests.
- Trips drive themselves along the route.

Turn it off with `WIIUP_SIM=0`. Then rides only go to real drivers, and the car's position comes
from the driver's phone.

## Settings

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` | HTTP and WebSocket port. |
| `WIIUP_DB` | `data/wiiup.db` | SQLite file. |
| `WIIUP_SIM` | `1`, or `0` in production | Simulated drivers, riders and movement. |
| `WIIUP_DEMO_CODE` | `1234`, or none in production | The sign-in code every number accepts. With no code, sign-in is disabled until SMS is connected. |
| `WIIUP_ADMIN_TOKEN` | none | Turns on the `/v1/admin` routes. Send it as `Authorization: Bearer <token>`. |
| `WIIUP_PLATINUM_AUTO_APPROVE_MS` | `5000` with simulation on | Approves Platinum applications automatically, for demos. Otherwise an admin approves them. |
| `TZ` | `America/Chicago` | Time zone for billing periods and daily payout limits. |
| `WIIUP_REGION` | `A` | This server's region name, used in trip versions. |
| `WIIUP_BACKUP_KEYS` | A shared development key, or none in production | `id:base64key,…` (32-byte keys, newest first) that seal trip backups on driver phones. Every region needs the same keys. Without keys, phone backups are off. |

## API

Every route except sign-in and `/health` needs `Authorization: Bearer <token>` from sign-in.
Errors come back as `{ "error": "<code>", "message": "<text for the user>" }`.

| Route | What it does |
|---|---|
| `POST /v1/auth/start` `{phone}` | Starts sign-in. Returns `demoCode` while there is no SMS provider. |
| `POST /v1/auth/verify` `{phone, code, name}` | Returns `{token, user}`. After five wrong codes, that number must wait 10 minutes. |
| `POST /v1/auth/sign-out` | Ends the session. |
| `GET /v1/drivers/nearby?lat&lng` | Free drivers within 5 km. |
| `POST /v1/quotes` `{pickup, dropoff}` | One quote per ride type. Each quote has an `id` and lasts 10 minutes. |
| `POST /v1/rides` `{pickup, dropoff, quote}` | Requests a ride. Only `quote.id` is trusted. The price is the one the server issued. |
| `POST /v1/rides/:id/cancel` | The rider cancels. |
| `GET /v1/driver/status` | Plan, billing period, fares so far, limit, available upgrade and balance. |
| `PUT /v1/driver/settings` `{cards, plan, subscribedAt?}` | Rate cards and plan. Gold Plus is only sold as an upgrade, and Platinum needs approval. |
| `POST /v1/driver/requests/:id/accept` `{location}` | Accepts an offer. Earnings are set by the server. |
| `POST /v1/driver/trips/:id/(arrived\|start\|complete\|cancel)` | Moves a trip forward. Steps must happen in order. |
| `POST /v1/rides/:id/bids/:bidId/(accept\|decline)` | The rider accepts a bid (that driver is booked at that fare) or declines it (the next lowest shows). |
| `POST /v1/driver/bids` `{tripId, fare}` | A driver bids on a trip from their bid board, within their limits. One bid per trip. |
| `POST /v1/driver/payouts` `{amount}` + `Idempotency-Key` | Instant payout, checked against the server balance and daily limit. |
| `POST /v1/driver/upgrade` `{plan, price}` + `Idempotency-Key` | Buys the upgrade offered at the plan limit. |
| `POST /v1/driver/platinum` `{license}` · `GET /v1/driver/platinum?submittedAt` | Applies for Platinum and checks the decision. |
| `GET /v1/admin/platinum-requests?status=pending` | Platinum applications, with driver details. |
| `POST /v1/admin/platinum-requests/:id/(approve\|reject)` | Records the admin's decision. |
| `PUT /v1/admin/drivers/:id/vehicle` `{car, color, plate}` | The car riders see. Until it is set, riders see "Vehicle details pending". |
| `GET /v1/admin/failover/events` | Trips restored from phones, conflicts and rejected backups, and whether payouts are paused. |
| `POST /v1/admin/failover/confirm-ledger` | Resumes instant payouts after a failover. |
| `GET /v1/admin/push/stats` | Push delivery statistics (see Push protocol). |
| `GET /v1/admin/backup/audit` | How many trips in progress have their latest version on the driver's phone. |

### Live updates

The live channel is `WS /v1/live?token=…`. The app sends these messages:

| Message | What it does |
|---|---|
| `{type:"sub", topic:"ride:<id>"}` or `"trip:<id>"` | Follows a ride or trip. Only the ride's rider and driver can follow it. |
| `{type:"unsub", topic}` | Stops following. |
| `{type:"online", location}` | The driver goes online. |
| `{type:"offline"}` | The driver goes offline. |
| `{type:"location", location}` | The driver's position, every 5 seconds while online or on a trip. |

The server sends `{type:"ride", ride}`, `{type:"trip", trip}`, `{type:"request", request}` (a ride
offer) and `{type:"request_gone", id}`, each wrapped in a push frame (below).

### Push protocol

The live channel follows the model of Uber's RAMEN push platform, as described in their post on
moving it to gRPC. The protocol is defined once, in `src/api/push.ts`, for both the app and the
server. It runs over the WebSocket the app already uses. WebSockets already carry messages both
ways, and the gRPC streams the article uses would need extra native code that Expo Go doesn't
include.

| Feature | How it works |
|---|---|
| **Numbered messages** | Each user has one session. Every message in it gets the next sequence number: `{t:"msg", seq, ack?, body}`. |
| **Receipts** | Messages that must arrive carry `ack: true`. The app answers right away with `{type:"ack", seq}`, which also covers every earlier message. |
| **Re-sending** | A must-deliver message that isn't acknowledged within 3 seconds is re-sent, up to 3 times. It is then kept until it expires: a ride offer when the offer ends, everything else after 2 minutes. The app ignores repeats. |
| **Resume** | The app reconnects with `&resume=<epoch>:<lastSeq>`. The server replays what the app missed, including updates for rides it follows that happened while it was disconnected. A session is kept for 2 minutes after the last socket closes. A new `epoch` in `hello` means the session was lost, so numbering starts again. |
| **Latest state only** | Ride and trip updates replace any older update still waiting for a receipt. |
| **Priorities** | Ride, trip, offer and backup messages must arrive. Car positions don't: when a connection is backed up (over 1 MB queued), they are dropped, and so are heartbeats. |
| **Heartbeats** | `{t:"hb"}` every 5 seconds. If the app hears nothing for 7 seconds, it reconnects and resumes. |
| **Control messages** | When the server shuts down, it sends `{t:"ctl", action:"reconnect", afterMs}`. Each app waits a random 0–2 seconds before reconnecting, so they don't all arrive at once. |
| **Compression** | Messages over 1 KB are compressed (permessage-deflate) when the app's WebSocket supports it. |
| **Statistics** | `GET /v1/admin/push/stats` shows messages sent, receipts, re-sends, replays, expired and dropped messages, the delivery rate, and the median and 95th-percentile receipt time. |

## Failover: driver phones as backup

This follows `docs/FAILOVER.md`, which is based on Uber's design.

- **Backups:** after every trip change, the server seals the trip with AES-256-GCM and stores it on
  the driver's phone under a write-once key, `trip/<driver>/<trip>/<version>`. It then deletes the
  older version.
- **Finished trips** shrink to a small tombstone, kept for the billing period so earnings limits
  survive.
- **Recovery:** when any phone connects, the server lists its keys. It restores anything newer
  than what it has, settles conflicts (the later stage wins, and the trip is flagged), rejects
  tampered backups, and brings the phone up to date.
- **Payouts:** instant payout stays paused after a restore until an admin confirms the ledger.

To try it locally:

1. Run region A: `WIIUP_REGION=A WIIUP_DB=data/a.db npm start`
2. Stop it.
3. Copy an older `a.db` to `data/b.db`.
4. Start region B on the same port: `WIIUP_REGION=B WIIUP_DB=data/b.db npm start`

The driver's app reconnects to region B and uploads its backups.

## Trip bidding

A rider can tap **Get bids from drivers** instead of booking at the standard price. That sends
`POST /v1/rides` with `mode: "bid"`, and the ride goes into `bidding` status. The rules live in
`src/lib/bids.ts`, shared by the app, the server and the prototype; the code is in
`server/src/bidding.ts`.

- **Bid board:** a driver opens "Bid on trips", from the rate card or the driver menu. The app
  sends `{type:"bids_on", location}` on the live socket. The server pushes
  `{type:"bid_board", trips}` with open trips within 8 km, each priced from that driver's own rate
  card.
- **Bid limits:** a driver can bid from 80% to 150% of their rate card price, in 50¢ steps, one bid
  per trip. Drivers on a trip or at their plan limit can't bid.
- **Up to 10 drivers per trip:** after 10 bids the trip stops taking bids, and the 11th driver gets
  `bids_full`. Declined and expired bids still count toward the 10. Each trip on the board carries
  `bidsLeft`.
- **What the rider sees:** the three lowest open bids, updated live in `ride.bids`. Declining a bid
  makes room for the next lowest. Bids last 60 seconds, and a trip takes bids for 3 minutes before
  it is cancelled.
- **Accepting:** the chosen driver is booked at their bid, and the rider pays exactly that. Other
  bidders see "chose another driver".
- **Simulation on:** simulated drivers bid on riders' trips, and drivers' boards get simulated
  riders' trips. A simulated rider picks the lowest of three bids.

The range, step and timings are placeholders until WiiUp sets them.

## How matching works

1. A ride is offered to the nearest free driver within 8 km, as long as:
   - the driver hasn't reached their plan limit, and
   - the driver's own rate card price is no higher than the rider's quote.
2. The driver has 15 seconds to accept. If they don't, the ride goes to the next driver.
3. The rider pays the driver's price, and the driver keeps all of it, so both see the same number.
4. If a driver cancels, the ride searches again at the price the rider confirmed.
5. With simulation off, a ride with no driver after 60 seconds is cancelled.

## Tests

```bash
npm test          # starts real servers and drives them with the app's own HTTP client
npm run typecheck
```

## Not built yet

| Area | Status today |
|---|---|
| **Payments** | Payouts and upgrade charges are recorded with protection against double charging, but no money moves. Riders aren't charged. |
| **SMS sign-in** | Every number uses the demo code. |
| **Admin dashboard** | `admin/` still keeps its own data in the browser. It isn't connected to these routes yet. |
| **Ratings, tips and trip history** | Kept on the phone only. |
| **Background location** | The app sends its last known position, but it doesn't track GPS continuously or while backgrounded. |
| **Running more than one region** | Phone backups and recovery are built. Database replication between regions and switching traffic between them aren't set up. See `docs/FAILOVER.md`. |
