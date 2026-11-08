import type { Db, Severity, ModuleId } from '../types';
import { DAY, toCents, uid } from './format';

type Event = { notice: { severity: Severity; title: string; body: string; module: ModuleId }; apply: (d: Db) => Db };
const pick = <T,>(a: T[]) => a[Math.floor(Math.random() * a.length)];

/** One simulated platform event. Where an event implies a record, the record is created too. */
export function nextEvent(db: Db): Event {
  const now = Date.now();
  const city = pick(['San Francisco', 'Chicago']);
  const driver = pick(db.drivers.filter((d) => d.status === 'active'));
  const customer = pick(db.customers.filter((c) => c.status === 'active'));
  const wrap = (notice: Event['notice'], change: (d: Db) => Db = (d) => d): Event => ({
    notice,
    apply: (d) => {
      const next = change(d);
      return { ...next, notices: [{ id: uid('n'), at: now, read: false, ...notice }, ...next.notices].slice(0, 100) };
    },
  });

  const events: (() => Event)[] = [
    () => wrap({ severity: 'info', title: `Ride requests up in ${city}`, body: `Requests are ${15 + Math.floor(Math.random() * 30)}% above normal for this hour.`, module: 'analytics' }),
    () => wrap({ severity: 'warning', title: 'Long pickup times', body: `Riders in ${city} are waiting over 9 minutes. More drivers online would help.`, module: 'drivers' }),
    () => wrap({ severity: 'warning', title: `${driver.name} reported a vehicle issue`, body: 'They went offline mid-shift with a flat tire.', module: 'drivers' }),
    () => wrap({ severity: 'critical', title: `Safety alert from ${driver.name}`, body: `In-trip safety button pressed in ${driver.city}. A chat was opened for follow-up.`, module: 'chat' }, (d) => ({
      ...d,
      chats: [{ id: uid('ch'), party: 'driver' as const, name: driver.name, subject: 'Safety alert during trip', status: 'open' as const, assigneeId: null, messages: [{ id: uid('m'), from: 'user' as const, name: driver.name, text: 'I pressed the safety button. A passenger is being aggressive.', at: now }] }, ...d.chats],
    })),
    () => wrap({ severity: 'warning', title: 'Subscription payment failed', body: `${driver.name}'s card ending ${driver.card} was declined.`, module: 'payments' }, (d) => ({
      ...d,
      txns: [{ id: uid('tx'), kind: 'subscription' as const, at: now, amount: toCents(50), status: 'failed' as const, driverId: driver.id, plan: driver.plan, note: 'Subscription charge' }, ...d.txns],
    })),
    () => wrap({ severity: 'warning', title: 'New low rating needs review', body: `A rider left ${driver.name} one star.`, module: 'reviews' }, (d) => ({
      ...d,
      reviews: [{ id: uid('rv'), at: now, subject: 'driver' as const, subjectName: driver.name, authorName: customer.name, rating: 1, text: 'Driver missed the pickup spot twice.', status: 'flagged' as const }, ...d.reviews],
    })),
    () => wrap({ severity: 'info', title: 'New driver application', body: 'An applicant submitted documents for review.', module: 'onboarding' }, (d) => {
      const pending = { status: 'pending' as const, expires: now + 300 * DAY };
      return {
        ...d,
        applicants: [{
          id: uid('a'), name: `New Applicant ${d.applicants.length + 1}`, email: `applicant${d.applicants.length + 1}@example.com`, phone: '415-555-0199',
          city: 'San Francisco' as const, car: 'Toyota Prius', plate: `9WUP${100 + d.applicants.length}`, plan: 'silver' as const, submittedAt: now,
          docs: { license: pending, registration: pending, insurance: pending, inspection: pending, photo: { status: 'pending' as const } },
          decision: 'pending' as const,
        }, ...d.applicants],
      };
    }),
  ];
  return pick(events)();
}
