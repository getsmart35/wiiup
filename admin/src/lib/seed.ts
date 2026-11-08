import { quoteFare, type Tier } from '../../../web-prototype/src/lib/fare';
import { isLadderPlan, ladderFee, LEVELS, PLANS, PLATINUM_PRICE } from '../../../web-prototype/src/lib/plans';
import type { Applicant, BackgroundCheck, Chat, PlatinumRequest, City, Customer, Db, DocStatus, DocType, Driver, DriverDoc, Employee, Review, Role, Task, Txn } from '../types';
import { accessMap } from './access';
import { DAY, startOfMonth, toCents } from './format';

/** Demo data: deterministic so numbers are stable, and derived from the real fare and plan rules. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const FIRST = ['Maya', 'Jordan', 'Priya', 'Alex', 'Sam', 'Leila', 'Noah', 'Ines', 'Theo', 'Amara', 'Kenji', 'Sofia', 'Omar', 'Hana', 'Luca', 'Zoe', 'Mateo', 'Nia', 'Ravi', 'Elena', 'Tariq', 'Chloe', 'Diego', 'Yuki', 'Marcus', 'Aisha', 'Ben', 'Carmen', 'Dev', 'Freya'];
const LAST = ['Okafor', 'Rivera', 'Shah', 'Nguyen', 'Cohen', 'Haddad', 'Park', 'Silva', 'Novak', 'Mensah', 'Tanaka', 'Rossi', 'Farah', 'Kim', 'Bianchi', 'Walker', 'Reyes', 'Adeyemi', 'Patel', 'Ivanova'];
const CARS = ['Toyota Camry', 'Toyota Prius', 'Honda Accord', 'Hyundai Ioniq 5', 'Kia Niro', 'Tesla Model 3', 'Chevrolet Bolt', 'Toyota Sienna'];
const CITIES: City[] = ['San Francisco', 'Chicago'];

function nameMaker(r: () => number) {
  const used = new Set<string>();
  return () => {
    for (;;) {
      const n = `${FIRST[Math.floor(r() * FIRST.length)]} ${LAST[Math.floor(r() * LAST.length)]}`;
      if (!used.has(n)) {
        used.add(n);
        return n;
      }
    }
  };
}
const emailOf = (n: string) => `${n.toLowerCase().replace(' ', '.')}@example.com`;
// 555-01xx numbers are reserved for fictional use
const phoneOf = (i: number) => `415-555-01${String(i % 100).padStart(2, '0')}`;

const ROLES: Role[] = [
  { id: 'owner', name: 'Owner', system: true, description: 'Full control, including staff and access.', access: accessMap('manage') },
  {
    id: 'ops', name: 'Operations manager', system: true, description: 'Runs customers, drivers and day-to-day delegation.',
    access: accessMap('none', { overview: 'view', analytics: 'view', customers: 'manage', drivers: 'manage', onboarding: 'manage', payments: 'view', loyalty: 'manage', reviews: 'manage', chat: 'manage', push: 'manage', employees: 'view', tasks: 'manage', activity: 'view' }),
  },
  {
    id: 'finance', name: 'Finance', system: true, description: 'Refunds, subscriptions and payouts.',
    access: accessMap('none', { overview: 'view', analytics: 'view', customers: 'view', drivers: 'view', payments: 'manage', loyalty: 'view', tasks: 'view', activity: 'view' }),
  },
  {
    id: 'compliance', name: 'Compliance', system: true, description: 'Reviews driver documents and runs background checks.',
    access: accessMap('none', { overview: 'view', drivers: 'manage', onboarding: 'manage', checks: 'manage', tasks: 'view', activity: 'view' }),
  },
  {
    id: 'support', name: 'Support agent', system: true, description: 'Handles chat and moderates reviews. Contact details stay masked.',
    access: accessMap('none', { overview: 'view', customers: 'view', drivers: 'view', reviews: 'manage', chat: 'manage', tasks: 'view' }),
  },
];

export function createSeed(now = Date.now()): Db {
  const r = rng(20261105);
  const name = nameMaker(r);
  const pick = <T,>(a: T[]) => a[Math.floor(r() * a.length)];
  const card = () => String(1000 + Math.floor(r() * 9000));

  const employees: Employee[] = [
    { id: 'e_owner', name: 'Dana Whitfield', email: 'dana@wiiup.example', title: 'Founder', roleId: 'owner', status: 'active', overrides: {}, lastActive: now - 600_000 },
    { id: 'e_ops', name: 'Rafael Mendes', email: 'rafael@wiiup.example', title: 'Head of Operations', roleId: 'ops', status: 'active', overrides: {}, lastActive: now - 3_600_000 },
    { id: 'e_fin', name: 'Grace Liu', email: 'grace@wiiup.example', title: 'Finance Lead', roleId: 'finance', status: 'active', overrides: {}, lastActive: now - 8_000_000 },
    { id: 'e_comp', name: 'Samir Aziz', email: 'samir@wiiup.example', title: 'Driver Compliance', roleId: 'compliance', status: 'active', overrides: {}, lastActive: now - 5_000_000 },
    { id: 'e_sup', name: 'Tess Moreau', email: 'tess@wiiup.example', title: 'Support Agent', roleId: 'support', status: 'active', overrides: { push: 'view' }, lastActive: now - 900_000 },
    { id: 'e_sup2', name: 'Kofi Boateng', email: 'kofi@wiiup.example', title: 'Support Agent', roleId: 'support', status: 'suspended', overrides: {}, lastActive: now - 20 * DAY },
    { id: 'e_new', name: 'Mei Tan', email: 'mei@wiiup.example', title: 'Operations Analyst', roleId: 'ops', status: 'invited', overrides: {}, lastActive: null },
  ];

  const customers: Customer[] = Array.from({ length: 220 }, (_, i) => {
    const n = name();
    return {
      id: `c_${i}`, name: n, email: emailOf(n), phone: phoneOf(i), city: r() < 0.62 ? 'San Francisco' : 'Chicago',
      status: r() < 0.05 ? 'suspended' : 'active', joinedAt: now - Math.floor(r() * 420 + 2) * DAY,
      rating: Math.round((4.2 + r() * 0.8) * 100) / 100, card: card(), points: 0, lifetimePoints: 0, wallet: r() < 0.25 ? toCents(Math.floor(r() * 4 + 1) * 5) : 0,
    };
  });

  const drivers: Driver[] = Array.from({ length: 18 }, (_, i) => {
    const n = name();
    const city: City = i % 3 === 0 ? 'Chicago' : 'San Francisco';
    return {
      id: `d_${i}`, name: n, email: emailOf(n), phone: phoneOf(i + 20), city,
      status: i === 11 ? 'suspended' : 'active', joinedAt: now - Math.floor(100 + r() * 400) * DAY,
      rating: Math.round((4.5 + r() * 0.48) * 100) / 100, card: card(),
      plan: pick(['silver', 'silver', 'gold', 'gold', 'platinum'] as const),
      car: pick(CARS), plate: `${Math.floor(r() * 9) + 1}${String.fromCharCode(65 + Math.floor(r() * 26), 65 + Math.floor(r() * 26), 65 + Math.floor(r() * 26))}${100 + Math.floor(r() * 899)}`,
      points: Math.floor(r() * 2000), wallet: 0, paidThrough: now - 3 * DAY,
    };
  });
  const driverWeight = drivers.map((_, i) => 1 / (1 + i * 0.22));
  const weightTotal = driverWeight.reduce((a, b) => a + b, 0);
  const pickDriver = (city: City) => {
    for (let tries = 0; tries < 30; tries++) {
      let x = r() * weightTotal;
      for (let i = 0; i < drivers.length; i++) {
        x -= driverWeight[i];
        if (x <= 0) {
          if (drivers[i].city === city && drivers[i].status === 'active') return drivers[i];
          break;
        }
      }
    }
    return drivers.find((d) => d.city === city)!;
  };

  /* ---------- fares: daily volume grows, with commute and weekend-night peaks ---------- */
  const hourShape = [2, 1, 1, 1, 2, 4, 9, 14, 12, 7, 6, 7, 8, 7, 6, 7, 10, 15, 16, 12, 9, 8, 7, 4];
  const weekendShape = [8, 7, 5, 2, 1, 1, 2, 3, 5, 7, 9, 10, 10, 9, 8, 8, 9, 11, 13, 13, 13, 14, 14, 11];
  const pickHour = (shape: number[]) => {
    let x = r() * shape.reduce((a, b) => a + b, 0);
    for (let h = 0; h < 24; h++) {
      x -= shape[h];
      if (x <= 0) return h;
    }
    return 12;
  };
  const txns: Txn[] = [];
  let n = 0;
  for (let d = 89; d >= 0; d--) {
    const dayStart = new Date(now - d * DAY);
    dayStart.setHours(0, 0, 0, 0);
    const weekend = dayStart.getDay() === 0 || dayStart.getDay() === 6;
    const rides = Math.round((20 + (89 - d) * 0.22) * (weekend ? 1.25 : 1) * (0.88 + r() * 0.24));
    for (let k = 0; k < rides; k++) {
      const at = dayStart.getTime() + pickHour(weekend ? weekendShape : hourShape) * 3_600_000 + Math.floor(r() * 3_600_000);
      if (at > now) continue;
      const eligible = customers.filter((c) => c.joinedAt < at);
      if (!eligible.length) continue;
      const c = eligible[Math.floor(r() ** 1.5 * eligible.length)];
      const driver = pickDriver(c.city);
      const x = r();
      const tier: Tier = x < 0.64 ? 'go' : x < 0.84 ? 'comfort' : x < 0.95 ? 'xl' : 'platinum';
      const km = 2 + r() * r() * 28;
      const amount = toCents(quoteFare(tier, km * 1000, (km / 0.42) * 60));
      const failed = r() < 0.012;
      const tip = !failed && r() < 0.42 ? toCents(Math.ceil(r() * 5)) : 0;
      txns.push({ id: `tx_${++n}`, kind: 'fare', at, amount, status: failed ? 'failed' : 'succeeded', customerId: c.id, driverId: driver.id, tier, tip });
      if (!failed) c.lifetimePoints += Math.floor(amount / 100);
    }
  }
  customers.forEach((c) => (c.points = Math.floor(c.lifetimePoints * (0.5 + r() * 0.5))));

  /* ---------- subscriptions: WiiUp's revenue, charged by the rules in plans.ts as fares come in ---------- */
  const fares = txns.filter((t) => t.status === 'succeeded');
  const sub = (d: Driver, at: number, dollars: number, note: string): Txn => ({
    id: `tx_${++n}`, kind: 'subscription', at, amount: toCents(dollars), status: r() < 0.025 ? 'failed' : 'succeeded', driverId: d.id, plan: d.plan, note,
  });
  const subs: Txn[] = [];
  const earliest = now - 89 * DAY;
  drivers.forEach((d) => {
    const mine = fares.filter((f) => f.driverId === d.id);
    if (d.plan === 'platinum') {
      for (let m = startOfMonth(earliest); m <= now; m = new Date(new Date(m).getFullYear(), new Date(m).getMonth() + 1, 1).getTime())
        if (m >= earliest) subs.push(sub(d, m + 3_600_000, PLATINUM_PRICE, `${PLANS.platinum.name}, prepaid`));
    } else if (isLadderPlan(d.plan)) {
      const plan = d.plan;
      const month: Record<number, number> = {};
      mine.forEach((f) => {
        const m = startOfMonth(f.at);
        const before = ladderFee(plan, month[m] ?? 0).installments;
        month[m] = (month[m] ?? 0) + f.amount / 100;
        const after = ladderFee(plan, month[m]).installments;
        for (let k = before; k < after; k++)
          subs.push(sub(d, f.at, LEVELS[plan][k].installment, `${PLANS[plan].name} installment ${k + 1} of ${LEVELS[plan].length}`));
      });
    }
  });
  txns.push(...subs);

  /* ---------- refunds and payouts ---------- */
  fares.filter((_, i) => i % 97 === 5).forEach((f) => {
    const amount = r() < 0.5 ? f.amount : Math.round(f.amount / 2);
    f.refunded = amount;
    txns.push({ id: `tx_${++n}`, kind: 'refund', at: f.at + 7_200_000, amount, status: 'succeeded', customerId: f.customerId, driverId: f.driverId, refundOf: f.id, note: pick(['Route issue', 'Driver cancelled late', 'Duplicate charge', 'Goodwill']) });
  });
  txns.sort((a, b) => b.at - a.at);

  /* ---------- onboarding ---------- */
  const docs = (license: DocStatus, registration: DocStatus, insurance: DocStatus, inspection: DocStatus, photo: DocStatus, over: Partial<Record<DocType, Partial<DriverDoc>>> = {}): Applicant['docs'] => {
    const make = (s: DocStatus, days: number | null): DriverDoc => ({ status: s, ...(s !== 'missing' && days ? { expires: now + days * DAY } : {}) });
    return {
      license: { ...make(license, 900), ...over.license }, registration: { ...make(registration, 320), ...over.registration },
      insurance: { ...make(insurance, 170), ...over.insurance }, inspection: { ...make(inspection, 340), ...over.inspection }, photo: { ...make(photo, null), ...over.photo },
    };
  };
  const applicant = (i: number, d: Applicant['docs'], extra: Partial<Applicant> = {}): Applicant => {
    const nm = name();
    const city = pick(CITIES);
    return {
      id: `a_${i}`, name: nm, email: emailOf(nm), phone: phoneOf(i + 40), city, car: pick(CARS), plate: `${i + 2}WUP${100 + i * 37}`,
      plan: 'silver', submittedAt: now - (i * 11 + 3) * 3_600_000, docs: d, decision: 'pending', ...extra,
    };
  };
  const allVerified = () => docs('verified', 'verified', 'verified', 'verified', 'verified');
  const applicants: Applicant[] = [
    applicant(0, docs('pending', 'pending', 'pending', 'missing', 'pending')),
    applicant(1, docs('verified', 'missing', 'missing', 'missing', 'verified')),
    applicant(2, docs('rejected', 'verified', 'verified', 'pending', 'verified', { license: { note: 'Photo is blurred; name is unreadable.' } })),
    applicant(3, docs('pending', 'pending', 'pending', 'pending', 'pending')),
    applicant(4, docs('verified', 'verified', 'pending', 'verified', 'verified', { insurance: { expires: now - 6 * DAY } })),
    applicant(5, allVerified()),
    applicant(6, allVerified()),
    applicant(7, allVerified()),
    applicant(8, allVerified()),
    applicant(9, allVerified(), { decision: 'rejected', decisionNote: 'Applicant withdrew.', decidedAt: now - 2 * DAY, submittedAt: now - 9 * DAY }),
    applicant(10, allVerified(), { submittedAt: now - 14 * DAY }),
    applicant(11, allVerified(), { submittedAt: now - 8 * DAY }),
  ];

  /* ---------- background checks: names and findings are sample data ---------- */
  const reportParts = (over: Partial<BackgroundCheck['parts']> = {}): BackgroundCheck['parts'] => ({
    identity: { result: 'clear' }, criminal: { result: 'clear' }, offender: { result: 'clear' }, watchlist: { result: 'clear' }, driving: { result: 'clear' }, ...over,
  });
  const finished = (subject: BackgroundCheck['subject'], p: { id: string; name: string; city: City }, id: string, completedAgo: number, status: BackgroundCheck['status'], parts: BackgroundCheck['parts'], extra: Partial<BackgroundCheck> = {}, extraEvents: BackgroundCheck['events'] = []): BackgroundCheck => {
    const completedAt = now - completedAgo * DAY;
    const requestedAt = completedAt - 2 * DAY;
    return {
      id, subject, subjectId: p.id, name: p.name, city: p.city, status, orderedBy: 'Samir Aziz', requestedAt, consentAt: requestedAt + DAY, startedAt: requestedAt + DAY, completedAt,
      ...(status === 'clear' ? { expiresAt: completedAt + 365 * DAY } : {}), parts,
      events: [
        { at: requestedAt, by: 'Samir Aziz', text: 'Sent the disclosure and consent request' },
        { at: requestedAt + DAY, by: p.name, text: 'Signed the disclosure and consent' },
        { at: completedAt, by: 'System', text: status === 'clear' ? 'Report completed with nothing to review' : 'Report completed with items to review' },
        ...extraEvents,
      ],
      ...extra,
    };
  };
  const courtRecord = { criminal: { result: 'consider' as const, finding: 'County court returned a record that needs review.' } };
  const majorViolation = { driving: { result: 'consider' as const, finding: 'Driving record shows a recent major violation.' } };
  const checks: BackgroundCheck[] = [
    finished('applicant', applicants[6], 'bg_a6', 1, 'review', reportParts(courtRecord)),
    finished('applicant', applicants[7], 'bg_a7', 1, 'clear', reportParts()),
    finished('applicant', applicants[8], 'bg_a8', 2, 'clear', reportParts()),
    finished('applicant', applicants[9], 'bg_a9', 4, 'clear', reportParts()),
    finished('applicant', applicants[10], 'bg_a10', 10, 'pre_adverse', reportParts(majorViolation), { noticeAt: now - 8 * DAY }, [{ at: now - 8 * DAY, by: 'Samir Aziz', text: 'Sent pre-adverse notice: two major violations in the past year.' }]),
    finished('applicant', applicants[11], 'bg_a11', 4, 'pre_adverse', reportParts(courtRecord), { noticeAt: now - 2 * DAY }, [{ at: now - 2 * DAY, by: 'Samir Aziz', text: 'Sent pre-adverse notice: record is recent and relates to driving.' }]),
    // Drivers renew yearly. Index 3 has expired and two more come due within 30 days.
    ...drivers.map((d, i) => finished('driver', d, `bg_${d.id}`, i === 3 ? 370 : i === 4 ? 353 : i === 7 ? 340 : Math.floor(20 + r() * 280), 'clear', reportParts())),
  ];

  /* ---------- reviews and chat ---------- */
  const good = ['Spotless car and a really smooth ride.', 'On time and very friendly.', 'Knew a faster route around traffic.', 'Great conversation, felt safe the whole way.', 'Helped with my bags without being asked.'];
  const mid = ['Fine overall, pickup took a little longer than shown.', 'Ride was okay. Music was a bit loud.'];
  const bad = ['Driver was on the phone for most of the trip.', 'Took a strange route and the fare went up.', 'Felt unsafe, speeding on the highway.'];
  const riderNotes = ['Ready at the curb, easy pickup.', 'Polite and on time.', 'Kept me waiting nearly ten minutes.'];
  const reviews: Review[] = Array.from({ length: 42 }, (_, i) => {
    const aboutDriver = i % 3 !== 2;
    const x = r();
    const rating = x < 0.62 ? 5 : x < 0.82 ? 4 : x < 0.91 ? 3 : x < 0.96 ? 2 : 1;
    const text = aboutDriver ? (rating >= 4 ? pick(good) : rating === 3 ? pick(mid) : pick(bad)) : rating >= 4 ? riderNotes[i % 2] : riderNotes[2];
    return {
      id: `rv_${i}`, at: now - Math.floor(r() * 20 * DAY), subject: aboutDriver ? 'driver' : 'customer',
      subjectName: aboutDriver ? pick(drivers).name : pick(customers).name, authorName: aboutDriver ? pick(customers).name : pick(drivers).name,
      rating, text, status: rating <= 2 ? 'flagged' : 'published',
    };
  });
  reviews.sort((a, b) => b.at - a.at);

  const chat = (id: string, party: Chat['party'], who: string, subject: string, lines: [Chat['messages'][number]['from'], string][], status: Chat['status'], assigneeId: string | null, minsAgo: number): Chat => ({
    id, party, name: who, subject, status, assigneeId,
    messages: lines.map(([from, text], i) => ({ id: `${id}_${i}`, from, name: from === 'user' ? who : 'Tess Moreau', text, at: now - (minsAgo - i * 2) * 60_000 })),
  });
  const chats: Chat[] = [
    chat('ch_1', 'customer', customers[3].name, 'Charged twice for one ride', [['user', 'Hi, I see two charges for my ride to the airport this morning.']], 'open', null, 8),
    chat('ch_2', 'driver', drivers[2].name, 'Silver installment question', [['user', 'Why was I charged $50 today?'], ['agent', 'Your fares passed the next Silver level this period, so one installment came due.'], ['user', 'Got it. What happens at my limit?']], 'open', 'e_sup', 25),
    chat('ch_3', 'customer', customers[7].name, 'Left my phone in the car', [['user', 'I left my phone in the back seat. Can you contact the driver?'], ['agent', 'I have reached out to your driver and will update you here.']], 'waiting', 'e_sup', 70),
    chat('ch_4', 'driver', drivers[5].name, 'Insurance renewal upload', [['user', 'I renewed my insurance. Where do I upload it?'], ['agent', 'Go to Account, then Documents. Thanks for keeping it current!']], 'resolved', 'e_sup', 900),
  ];

  const task = (id: string, title: string, assigneeId: string, dueDays: number, priority: Task['priority'], status: Task['status'], module: Task['module']): Task => ({ id, title, assigneeId, createdBy: 'Dana Whitfield', due: now + dueDays * DAY, priority, status, module });
  const tasks: Task[] = [
    task('t_1', 'Review flagged background check', 'e_comp', 1, 'high', 'open', 'checks'),
    task('t_2', 'Retry failed subscription charges', 'e_fin', 0.5, 'high', 'in_progress', 'payments'),
    task('t_3', 'Reply to open billing chats', 'e_sup', -1, 'normal', 'open', 'chat'),
    task('t_4', 'Plan weekend driver bonus for Chicago', 'e_ops', 5, 'normal', 'open', 'loyalty'),
    task('t_5', 'Reconcile last week of payouts', 'e_fin', -3, 'normal', 'done', 'payments'),
  ];

  return {
    roles: ROLES, employees, customers, drivers, applicants, checks, txns,
    platinumRequests: [
      ...drivers.filter((d) => d.plan === 'platinum').map((d, i): PlatinumRequest => ({ id: `pl_${d.id}`, driverId: d.id, name: d.name, city: d.city, license: `LV-${40100 + i * 37}`, submittedAt: now - (60 + i) * DAY, status: 'approved', note: 'License verified.', decidedBy: 'Samir Aziz', decidedAt: now - (58 + i) * DAY })),
      ...drivers.filter((d) => d.plan !== 'platinum' && d.status === 'active').slice(0, 3).map((d, i): PlatinumRequest => ({ id: `pl_${d.id}`, driverId: d.id, name: d.name, city: d.city, license: `LV-${51200 + i * 53}`, submittedAt: now - (i + 1) * 9 * 3_600_000, status: 'pending' })),
    ],
    levels: [
      { id: 'lv_1', name: 'Starter', minPoints: 0, multiplier: 1, walletBonus: 0, perk: 'Earn 1 point per $1 of fares.' },
      { id: 'lv_2', name: 'Regular', minPoints: 100, multiplier: 1.1, walletBonus: 200, perk: '10% more points and a $2 wallet bonus.' },
      { id: 'lv_3', name: 'Gold', minPoints: 400, multiplier: 1.25, walletBonus: 500, perk: '25% more points and priority support.' },
      { id: 'lv_4', name: 'Elite', minPoints: 1000, multiplier: 1.5, walletBonus: 1500, perk: '50% more points and free cancellation.' },
    ],
    rules: [
      { id: 'ru_1', name: 'Fare points', audience: 'customer', trigger: 'Every $1 of completed fares', points: 1, wallet: 0, active: true },
      { id: 'ru_2', name: 'Refer a friend', audience: 'customer', trigger: "Referred friend's first ride", points: 200, wallet: 500, active: true },
      { id: 'ru_3', name: 'Five-star week', audience: 'driver', trigger: 'Average 4.9+ across 20+ trips in a week', points: 300, wallet: 2000, active: true },
      { id: 'ru_4', name: '100-trip milestone', audience: 'driver', trigger: 'Every 100 completed trips', points: 500, wallet: 5000, active: false },
    ],
    grants: [
      { id: 'g_1', at: now - 2 * DAY, audience: 'driver', recipientId: drivers[0].id, recipient: drivers[0].name, points: 300, wallet: 2000, reason: 'Five-star week', by: 'Rafael Mendes' },
      { id: 'g_2', at: now - 4 * DAY, audience: 'customer', recipientId: customers[4].id, recipient: customers[4].name, points: 100, wallet: 500, reason: 'Apology for late pickup', by: 'Tess Moreau' },
    ],
    reviews, chats,
    campaigns: [{ id: 'cp_1', at: now - 6 * DAY, title: 'Your weekend ride is 10% off', body: 'Use WEEKEND10 on rides this Saturday and Sunday.', audience: 'All customers', reach: 208, by: 'Rafael Mendes' }],
    tasks,
    notices: [
      { id: 'n_1', at: now - 300_000, severity: 'critical', title: 'Rider reported a safety concern', body: 'A rider used the in-trip safety button in Chicago. Support should follow up.', module: 'chat', read: false },
      { id: 'n_2', at: now - 2_400_000, severity: 'warning', title: 'Background check needs review', body: 'One applicant returned a record that needs a manual decision.', module: 'checks', read: false },
      { id: 'n_3', at: now - 5_400_000, severity: 'info', title: 'Ride requests up in San Francisco', body: 'Requests are 24% above normal for this hour.', module: 'analytics', read: true },
    ],
    audit: [
      { id: 'au_2', at: now - 2 * DAY, actor: 'Rafael Mendes', module: 'loyalty', summary: `Granted 300 points and $20.00 to ${drivers[0].name}` },
      { id: 'au_1', at: now - 3 * DAY, actor: 'Dana Whitfield', module: 'employees', summary: 'Suspended employee Kofi Boateng' },
    ],
    integrations: [
      { id: 'stripe', name: 'Stripe', category: 'Payments', description: 'Fare charges, driver subscriptions, refunds and payouts.', connected: false },
      { id: 'checkr', name: 'Checkr', category: 'Compliance', description: 'Background checks for driver applicants.', connected: false },
      { id: 'mapbox', name: 'Mapbox', category: 'Maps', description: 'Routing and navigation, as used by the rider and driver prototype.', connected: true },
      { id: 'fcm', name: 'Firebase Cloud Messaging', category: 'Messaging', description: 'Push notifications to iOS and Android.', connected: false },
      { id: 'twilio', name: 'Twilio', category: 'Messaging', description: 'SMS sign-in codes and masked calling between riders and drivers.', connected: false },
      { id: 'zendesk', name: 'Zendesk', category: 'Support', description: 'Hand off escalated live chats to a help desk.', connected: false },
    ],
    features: { driverReviews: true, customerReviews: true, loyalty: true, liveChat: true, push: true },
    live: true,
  };
}
