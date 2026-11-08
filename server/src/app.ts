import { randomBytes, timingSafeEqual } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

import { Backup } from './backup.ts';
import { Bidding } from './bidding.ts';
import type { Config } from './config.ts';
import { Dispatch, type TripAction } from './dispatch.ts';
import * as drivers from './drivers.ts';
import { badRequest, bearer, conflict, HttpError, notFound, Router } from './http.ts';
import { Live, type ClientMessage } from './live.ts';
import { Store, type PlatinumStatus } from './store.ts';
import * as v from './validate.ts';

const MAX_CODE_TRIES = 5;
const CODE_WINDOW = 10 * 60 * 1000;

export function createApp(config: Config) {
  const store = new Store(config.dbPath);
  const router = new Router();
  const server = createServer((req, res) => void router.handle(req, res));
  const live: Live = new Live(server, {
    authenticate: (token) => (token ? store.sessionUser(token) : null),
    authorize: (userId, topic) => dispatch.canFollow(userId, topic),
    snapshot: (topic) => dispatch.snapshot(topic),
    onMessage: (userId, msg) => onLiveMessage(userId, msg),
    onConnect: (userId) => backup?.phoneConnected(userId),
    onDisconnect: (userId) => (dispatch.goOffline(userId), bidding.leave(userId)),
  }, config.push);
  const dispatch: Dispatch = new Dispatch(store, live, config);
  dispatch.recover();
  const bidding: Bidding = new Bidding(store, live, config, dispatch);
  dispatch.bidding = bidding;
  const backup = config.backupKeys ? new Backup(store, live, config.backupKeys, config.region, dispatch) : null;
  if (backup) dispatch.onTripSaved = (rec, previous) => backup.tripSaved(rec, previous);
  const autoApprovals = new Set<ReturnType<typeof setTimeout>>();

  function onLiveMessage(userId: string, msg: ClientMessage) {
    try {
      if (msg.type === 'online') {
        const location = v.latLng(msg.location);
        // No offers until the phone's backups have been checked
        void (backup?.ready(userId) ?? Promise.resolve()).then(() => dispatch.goOnline(userId, location));
      } else if (msg.type === 'bids_on') {
        const location = v.latLng(msg.location);
        void (backup?.ready(userId) ?? Promise.resolve()).then(() => bidding.join(userId, location));
      } else if (msg.type === 'bids_off') bidding.leave(userId);
      else if (msg.type === 'vault_keys') backup?.reply(msg.reqId, msg.keys);
      else if (msg.type === 'vault_blob') backup?.reply(msg.reqId, msg.blob);
      else if (msg.type === 'offline') dispatch.goOffline(userId);
      else if (msg.type === 'location') {
        const location = v.latLng(msg.location);
        dispatch.driverLocation(userId, location);
        bidding.moved(userId, location);
      }
    } catch (e) {
      if (!(e instanceof HttpError)) console.error(e);
    }
  }

  const userId = (req: IncomingMessage) => {
    const token = bearer(req);
    const id = token ? store.sessionUser(token) : null;
    if (!id) throw new HttpError(401, 'unauthorized', 'Sign in again to continue');
    return id;
  };

  const idempotencyKey = (req: IncomingMessage) => {
    const key = req.headers['idempotency-key'];
    if (typeof key !== 'string' || key.length < 8 || key.length > 100) throw badRequest('An Idempotency-Key header is required');
    return key;
  };

  const requireAdmin = (req: IncomingMessage) => {
    const token = bearer(req) ?? '';
    const ok = config.adminToken && token.length === config.adminToken.length && timingSafeEqual(Buffer.from(token), Buffer.from(config.adminToken));
    if (!ok) throw notFound();
  };

  // ---------- health ----------

  router.on('GET', '/health', () => ({ ok: true, sim: config.sim, region: config.region, phoneBackups: !!backup }));

  // ---------- sign-in ----------

  const codeTries = new Map<string, { count: number; since: number }>();

  router.on('POST', '/v1/auth/start', ({ body }) => {
    v.phone(v.obj(body).phone);
    if (!config.demoCode) throw new HttpError(503, 'sms_unavailable', 'Text message sign-in is not set up yet');
    // No SMS provider yet: every number uses the demo code, which the app shows
    return { sent: true, demoCode: config.demoCode };
  });

  router.on('POST', '/v1/auth/verify', ({ body }) => {
    const b = v.obj(body);
    const phone = v.phone(b.phone);
    const name = v.str(b.name, 'Name', 80);
    const code = typeof b.code === 'string' ? b.code : '';
    const now = Date.now();
    const tries = codeTries.get(phone);
    const recent = tries && now - tries.since < CODE_WINDOW ? tries : { count: 0, since: now };
    if (recent.count >= MAX_CODE_TRIES) throw new HttpError(429, 'too_many_tries', 'Too many tries. Wait a few minutes and try again.');
    if (!config.demoCode || code !== config.demoCode) {
      codeTries.set(phone, { ...recent, count: recent.count + 1 });
      throw new HttpError(400, 'wrong_code', "That code didn't match");
    }
    codeTries.delete(phone);
    const user = store.upsertUser(phone, name);
    const token = randomBytes(32).toString('base64url');
    store.createSession(user.id, token);
    return { token, user: { id: user.id, name: user.name, phone: user.phone } };
  });

  router.on('POST', '/v1/auth/sign-out', ({ req }) => {
    const token = bearer(req);
    if (token) store.deleteSession(token);
  });

  // ---------- rider ----------

  router.on('GET', '/v1/drivers/nearby', ({ req, query }) => {
    userId(req);
    return dispatch.nearbyDrivers(v.latLng({ latitude: Number(query.get('lat')), longitude: Number(query.get('lng')) }));
  });

  router.on('POST', '/v1/quotes', ({ req, body }) => {
    const b = v.obj(body);
    return dispatch.getQuotes(userId(req), v.latLng(b.pickup, 'pickup'), v.latLng(b.dropoff, 'dropoff'));
  });

  router.on('POST', '/v1/rides', ({ req, body }) => {
    const id = userId(req);
    const b = v.obj(body);
    const quote = v.obj(b.quote, 'quote');
    const user = store.user(id)!;
    const mode = b.mode === 'bid' ? 'bid' : 'match';
    return dispatch.requestRide(id, user.name, v.place(b.pickup, 'pickup'), v.place(b.dropoff, 'dropoff'), v.str(quote.id, 'quote.id', 100), mode);
  });

  router.on('POST', '/v1/rides/:id/bids/:bidId/:decision', ({ req, params }) => {
    const id = userId(req);
    if (params.decision === 'accept') bidding.accept(id, params.id, params.bidId);
    else if (params.decision === 'decline') bidding.decline(id, params.id, params.bidId);
    else throw notFound();
  });

  router.on('POST', '/v1/rides/:id/cancel', ({ req, params }) => {
    dispatch.cancelRide(userId(req), params.id);
  });

  // ---------- driver ----------

  router.on('GET', '/v1/driver/status', ({ req }) => {
    const id = userId(req);
    const profile = store.ensureDriver(id);
    return { ...drivers.planStatus(store, profile), balance: drivers.balance(store, id), subscribedAt: profile.subscribedAt };
  });

  router.on('PUT', '/v1/driver/settings', ({ req, body }) => {
    const id = userId(req);
    const b = v.obj(body);
    const subscribedAt = typeof b.subscribedAt === 'number' ? b.subscribedAt : undefined;
    const profile = drivers.saveSettings(store, id, { cards: v.rateCards(b.cards), plan: v.plan(b.plan), subscribedAt });
    return { ...drivers.planStatus(store, profile), subscribedAt: profile.subscribedAt };
  });

  router.on('POST', '/v1/driver/requests/:id/accept', ({ req, params, body }) => {
    return dispatch.acceptRequest(userId(req), params.id, v.latLng(v.obj(body).location));
  });

  router.on('POST', '/v1/driver/trips/:id/:action', async ({ req, params }) => {
    const action = params.action as TripAction;
    if (!['arrived', 'start', 'complete', 'cancel'].includes(action)) throw notFound();
    const id = userId(req);
    if (backup) {
      await backup.ready(id);
      // After a failover the trip may only exist on the driver's phone until it reconnects; the app retries
      if (!dispatch.isActive(params.id) && !backup.hasChecked(id)) throw new HttpError(503, 'recovering', 'Reconnecting… your trip is safe');
    }
    dispatch.updateTrip(id, params.id, action);
  });

  router.on('POST', '/v1/driver/bids', ({ req, body }) => {
    const b = v.obj(body);
    bidding.place(userId(req), v.str(b.tripId, 'tripId', 100), v.num(b.fare, 'fare'));
  });

  router.on('POST', '/v1/driver/payouts', ({ req, body }) => {
    if (backup?.payoutsPaused) throw new HttpError(503, 'payouts_paused', 'Instant payout is paused for a few minutes while we check your balance.');
    return drivers.instantPayout(store, userId(req), v.num(v.obj(body).amount, 'amount'), idempotencyKey(req));
  });

  router.on('POST', '/v1/driver/upgrade', ({ req, body }) => {
    const b = v.obj(body);
    return drivers.purchaseUpgrade(store, userId(req), v.plan(b.plan), v.num(b.price, 'price'), idempotencyKey(req));
  });

  router.on('POST', '/v1/driver/platinum', ({ req, body }) => {
    const id = userId(req);
    const request = drivers.applyForPlatinum(store, id, v.str(v.obj(body).license, 'License number', 40));
    if (config.platinumAutoApproveMs != null && request.status === 'pending') {
      const t = setTimeout(() => (autoApprovals.delete(t), store.decidePlatinum(request.id, 'approved')), config.platinumAutoApproveMs);
      autoApprovals.add(t);
    }
    return { submittedAt: request.submittedAt };
  });

  router.on('GET', '/v1/driver/platinum', ({ req, query }) => {
    const submittedAt = query.get('submittedAt') ? Number(query.get('submittedAt')) : undefined;
    return { status: drivers.platinumReview(store, userId(req), submittedAt).status };
  });

  // ---------- admin (requires WIIUP_ADMIN_TOKEN) ----------

  router.on('GET', '/v1/admin/platinum-requests', ({ req, query }) => {
    requireAdmin(req);
    const status = query.get('status') as PlatinumStatus | null;
    return store.platinumRequests(status ? { status } : {}).map((r) => ({ ...r, driver: store.user(r.driverId) }));
  });

  router.on('POST', '/v1/admin/platinum-requests/:id/:decision', ({ req, params }) => {
    requireAdmin(req);
    const decision = { approve: 'approved', reject: 'rejected' }[params.decision] as 'approved' | 'rejected' | undefined;
    if (!decision) throw notFound();
    const [request] = store.platinumRequests({ id: params.id });
    if (!request) throw notFound('Application not found');
    if (request.status !== 'pending') throw conflict('already_decided', `This application was already ${request.status}`);
    store.decidePlatinum(request.id, decision);
    return store.platinumRequests({ id: params.id })[0];
  });

  /** Push delivery health: acks, redeliveries, replays after reconnects, drops on slow sockets, ack round trips. */
  router.on('GET', '/v1/admin/push/stats', ({ req }) => {
    requireAdmin(req);
    return live.stats();
  });

  router.on('GET', '/v1/admin/failover/events', ({ req }) => {
    requireAdmin(req);
    return { payoutsPaused: backup?.payoutsPaused ?? false, events: store.failoverEvents() };
  });

  /** After a failover: the payment ledger is confirmed current, so instant payouts can resume. */
  router.on('POST', '/v1/admin/failover/confirm-ledger', ({ req }) => {
    requireAdmin(req);
    if (backup) backup.payoutsPaused = false;
    return { payoutsPaused: false };
  });

  router.on('GET', '/v1/admin/backup/audit', async ({ req }) => {
    requireAdmin(req);
    if (!backup) throw new HttpError(503, 'backups_off', 'Phone backups are off (no WIIUP_BACKUP_KEYS)');
    return backup.audit();
  });

  router.on('PUT', '/v1/admin/drivers/:id/vehicle', ({ req, params, body }) => {
    requireAdmin(req);
    if (!store.user(params.id)) throw notFound('Driver not found');
    const b = v.obj(body);
    const profile = store.ensureDriver(params.id);
    const vehicle = { car: v.str(b.car, 'car', 60), color: v.str(b.color, 'color', 30), plate: v.str(b.plate, 'plate', 12).toUpperCase() };
    store.saveDriver({ ...profile, vehicle });
    return vehicle;
  });

  return {
    server,
    store,
    listen(port = config.port) {
      return new Promise<number>((resolve) => server.listen(port, () => resolve((server.address() as AddressInfo).port)));
    },
    async close() {
      dispatch.stop();
      bidding.stop();
      backup?.stop();
      autoApprovals.forEach(clearTimeout);
      live.close();
      await new Promise((r) => server.close(r));
      store.close();
    },
  };
}
