import { useEffect, useMemo, useRef, useState } from 'react';

import { BarList } from '../components/charts';
import { Avatar, Badge, Btn, Card, Dialog, Empty, Field, Note, Page, Person, ReadOnlyNote, SearchBox, Select, Stars, Stat, Switch, Table, Tabs, type Tone } from '../components/ui';
import { levelOf } from '../lib/analytics';
import { ago, count, dateTime, money, shortDate, toCents, uid } from '../lib/format';
import { useAdmin } from '../store';
import type { Chat, Db, Features, Level, Review } from '../types';

const MAX_GRANT_POINTS = 10000;
const MAX_GRANT_WALLET = 10000; // cents

/* ---------- levels and rewards ---------- */

export function Loyalty() {
  const { db, can, act, confirm } = useAdmin();
  const manage = can('loyalty', 'manage');
  const [tab, setTab] = useState<'levels' | 'rewards'>('levels');
  const [editing, setEditing] = useState<Level | 'new' | null>(null);
  const [granting, setGranting] = useState(false);
  const levels = [...db.levels].sort((a, b) => a.minPoints - b.minPoints);
  const members = (l: Level) => db.customers.filter((c) => levelOf(db.levels, c.lifetimePoints).id === l.id).length;

  return (
    <Page title="Levels & rewards" subtitle="Reward riders and drivers with points and wallet bonuses." actions={
      tab === 'levels'
        ? <Btn kind="primary" icon="plus" disabled={!manage} onClick={() => setEditing('new')}>Add level</Btn>
        : <Btn kind="primary" icon="gift" disabled={!manage} onClick={() => setGranting(true)}>Grant reward</Btn>
    }>
      <ReadOnlyNote module="loyalty" />
      {!db.features.loyalty && <Note tone="warn">Loyalty is turned off in Platform, so riders and drivers don't see points right now.</Note>}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: 'levels', label: 'Customer levels', count: levels.length }, { value: 'rewards', label: 'Rewards' }]} />
      {tab === 'levels' ? (
        <div className="levels">
          {levels.map((l, i) => (
            <Card key={l.id} title={l.name} subtitle={`${count(l.minPoints)}+ lifetime points`} actions={
              <div className="row">
                <Btn small disabled={!manage} onClick={() => setEditing(l)}>Edit</Btn>
                {i > 0 && (
                  <Btn small disabled={!manage} onClick={() => confirm({
                    title: `Delete ${l.name}?`, body: `Its ${members(l)} customers move down to the level below. Their points don't change.`, okLabel: 'Delete level', danger: true,
                    onOk: () => act('loyalty', `Deleted customer level ${l.name}`, (d) => ({ ...d, levels: d.levels.filter((x) => x.id !== l.id) })),
                  })}>Delete</Btn>
                )}
              </div>
            }>
              <p>{l.perk}</p>
              <div className="minis">
                <Stat label="Customers" value={count(members(l))} />
                <Stat label="Points rate" value={`${l.multiplier}×`} />
                <Stat label="Bonus on reaching" value={money(l.walletBonus)} />
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <>
          <Card title="Automatic rewards" subtitle="Rules your backend applies as trips complete.">
            <ul className="rules">
              {db.rules.map((r) => (
                <li key={r.id}>
                  <div>
                    <strong>{r.name}</strong> <Badge>{r.audience === 'customer' ? 'Customers' : 'Drivers'}</Badge>
                    <p className="muted">{r.trigger}: {count(r.points)} points{r.wallet ? ` and ${money(r.wallet)} wallet bonus` : ''}</p>
                  </div>
                  <Switch label={`${r.name} active`} checked={r.active} disabled={!manage} onChange={(active) => act('loyalty', `${active ? 'Turned on' : 'Turned off'} reward rule ${r.name}`, (d) => ({ ...d, rules: d.rules.map((x) => (x.id === r.id ? { ...x, active } : x)) }))} />
                </li>
              ))}
            </ul>
          </Card>
          <Card flush title="Rewards granted by staff">
            <Table label="Rewards granted" rows={db.grants} rowKey={(g) => g.id} empty="No rewards granted yet" columns={[
              { key: 'at', head: 'Date', sort: (g) => g.at, cell: (g) => shortDate(g.at) },
              { key: 'who', head: 'Recipient', sort: (g) => g.recipient, cell: (g) => <Person name={g.recipient} sub={g.audience === 'customer' ? 'Customer' : 'Driver'} /> },
              { key: 'pts', head: 'Points', align: 'right', cell: (g) => count(g.points) },
              { key: 'wallet', head: 'Wallet', align: 'right', cell: (g) => money(g.wallet) },
              { key: 'reason', head: 'Reason', cell: (g) => g.reason },
              { key: 'by', head: 'Granted by', cell: (g) => g.by },
            ]} />
          </Card>
        </>
      )}
      {editing && <LevelForm level={editing === 'new' ? null : editing} isBase={editing !== 'new' && levels[0]?.id === editing.id} onClose={() => setEditing(null)} />}
      {granting && <GrantForm onClose={() => setGranting(false)} />}
    </Page>
  );
}

function LevelForm({ level, isBase, onClose }: { level: Level | null; isBase: boolean; onClose: () => void }) {
  const { db, act } = useAdmin();
  const [f, setF] = useState({ name: level?.name ?? '', minPoints: String(level?.minPoints ?? ''), multiplier: String(level?.multiplier ?? 1), wallet: ((level?.walletBonus ?? 0) / 100).toFixed(2), perk: level?.perk ?? '' });
  const [tried, setTried] = useState(false);
  const min = Number(f.minPoints);
  const others = db.levels.filter((l) => l.id !== level?.id);
  const errors = {
    name: !f.name.trim() ? 'Enter a name' : others.some((l) => l.name.toLowerCase() === f.name.trim().toLowerCase()) ? 'Another level has this name' : '',
    min: f.minPoints === '' || !Number.isInteger(min) || min < 0 ? 'Enter a whole number of points' : !isBase && min === 0 ? 'Only the first level starts at 0' : others.some((l) => l.minPoints === min) ? 'Another level starts at this number' : '',
    multiplier: Number(f.multiplier) >= 1 && Number(f.multiplier) <= 5 ? '' : 'Use a rate from 1 to 5',
    wallet: Number(f.wallet) >= 0 ? '' : 'Enter $0 or more',
  };
  const save = () => {
    setTried(true);
    if (Object.values(errors).some(Boolean)) return;
    const values = { name: f.name.trim(), minPoints: min, multiplier: Number(f.multiplier), walletBonus: toCents(Number(f.wallet)), perk: f.perk.trim() };
    if (level) act('loyalty', `Updated customer level ${values.name}`, (d) => ({ ...d, levels: d.levels.map((l) => (l.id === level.id ? { ...l, ...values } : l)) }));
    else {
      const id = uid('lv');
      act('loyalty', `Added customer level ${values.name}`, (d) => ({ ...d, levels: [...d.levels, { id, ...values }] }));
    }
    onClose();
  };
  return (
    <Dialog title={level ? `Edit ${level.name}` : 'Add customer level'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save}>Save level</Btn></>}>
      <Field label="Level name" error={tried ? errors.name : ''}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Lifetime points needed" hint={isBase ? 'The first level always starts at 0.' : undefined} error={tried ? errors.min : ''}><input className="input" inputMode="numeric" disabled={isBase} value={f.minPoints} onChange={(e) => setF({ ...f, minPoints: e.target.value })} /></Field>
      <Field label="Points rate" hint="1.25 means 25% more points per $1 of fares." error={tried ? errors.multiplier : ''}><input className="input" inputMode="decimal" value={f.multiplier} onChange={(e) => setF({ ...f, multiplier: e.target.value })} /></Field>
      <Field label="Wallet bonus on reaching this level (USD)" error={tried ? errors.wallet : ''}><input className="input" inputMode="decimal" value={f.wallet} onChange={(e) => setF({ ...f, wallet: e.target.value })} /></Field>
      <Field label="What customers get"><textarea className="input" rows={2} value={f.perk} onChange={(e) => setF({ ...f, perk: e.target.value })} /></Field>
    </Dialog>
  );
}

function GrantForm({ onClose }: { onClose: () => void }) {
  const { db, act, me } = useAdmin();
  const [audience, setAudience] = useState<'customer' | 'driver'>('customer');
  const people = audience === 'customer' ? db.customers : db.drivers;
  const [recipientId, setRecipientId] = useState(db.customers[0]?.id ?? '');
  const [points, setPoints] = useState('100');
  const [wallet, setWallet] = useState('0');
  const [reason, setReason] = useState('');
  const [tried, setTried] = useState(false);
  const pts = Number(points);
  const cents = toCents(Number(wallet));
  const errors = {
    points: !Number.isInteger(pts) || pts < 0 ? 'Enter a whole number' : pts > MAX_GRANT_POINTS ? `Limit is ${count(MAX_GRANT_POINTS)} points per grant` : '',
    wallet: !Number.isFinite(cents) || cents < 0 ? 'Enter $0 or more' : cents > MAX_GRANT_WALLET ? `Limit is ${money(MAX_GRANT_WALLET)} per grant` : '',
    reason: reason.trim() ? '' : 'Say why, so the reward can be audited',
    empty: pts === 0 && cents === 0 ? 'Add points or a wallet amount' : '',
  };
  const save = () => {
    setTried(true);
    const person = people.find((p) => p.id === recipientId);
    if (!person || Object.values(errors).some(Boolean)) return;
    const at = Date.now();
    const grantId = uid('g');
    const txnId = uid('tx');
    const parts = [pts ? `${count(pts)} points` : '', cents ? money(cents) : ''].filter(Boolean).join(' and ');
    act('loyalty', `Granted ${parts} to ${person.name}: ${reason.trim()}`, (d): Db => ({
      ...d,
      customers: audience === 'customer' ? d.customers.map((c) => (c.id === recipientId ? { ...c, points: c.points + pts, lifetimePoints: c.lifetimePoints + pts, wallet: c.wallet + cents } : c)) : d.customers,
      drivers: audience === 'driver' ? d.drivers.map((x) => (x.id === recipientId ? { ...x, points: x.points + pts, wallet: x.wallet + cents } : x)) : d.drivers,
      grants: [{ id: grantId, at, audience, recipientId, recipient: person.name, points: pts, wallet: cents, reason: reason.trim(), by: me?.name ?? 'Unknown' }, ...d.grants],
      txns: cents ? [{ id: txnId, kind: 'bonus', at, amount: cents, status: 'succeeded', ...(audience === 'customer' ? { customerId: recipientId } : { driverId: recipientId }), note: reason.trim() }, ...d.txns] : d.txns,
    }));
    onClose();
  };
  return (
    <Dialog title="Grant reward" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save}>Grant reward</Btn></>}>
      <Field label="Who is it for?">
        <Select label="Audience" value={audience} onChange={(v) => { setAudience(v); setRecipientId((v === 'customer' ? db.customers : db.drivers)[0]?.id ?? ''); }} options={[{ value: 'customer', label: 'Customer' }, { value: 'driver', label: 'Driver' }]} />
      </Field>
      <Field label="Recipient">
        <Select label="Recipient" value={recipientId} onChange={setRecipientId} options={[...people].sort((a, b) => a.name.localeCompare(b.name)).map((p) => ({ value: p.id, label: p.name }))} />
      </Field>
      <Field label="Loyalty points" error={tried ? errors.points : ''}><input className="input" inputMode="numeric" value={points} onChange={(e) => setPoints(e.target.value)} /></Field>
      <Field label="Wallet bonus (USD)" error={tried ? errors.wallet || errors.empty : ''}><input className="input" inputMode="decimal" value={wallet} onChange={(e) => setWallet(e.target.value)} /></Field>
      <Field label="Reason" error={tried ? errors.reason : ''}><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
    </Dialog>
  );
}

/* ---------- reviews ---------- */

const REVIEW_TONE: Record<Review['status'], { tone: Tone; label: string }> = {
  published: { tone: 'good', label: 'Published' }, flagged: { tone: 'warn', label: 'Flagged' }, hidden: { tone: 'neutral', label: 'Hidden' },
};

export function Reviews() {
  const { db, can, act } = useAdmin();
  const manage = can('reviews', 'manage');
  const [subject, setSubject] = useState<'all' | 'driver' | 'customer'>('all');
  const [status, setStatus] = useState<'all' | Review['status']>('all');
  const [q, setQ] = useState('');
  const rows = db.reviews.filter((r) => (subject === 'all' || r.subject === subject) && (status === 'all' || r.status === status) && `${r.subjectName} ${r.authorName} ${r.text}`.toLowerCase().includes(q.trim().toLowerCase()));
  const shown = db.reviews.filter((r) => r.status !== 'hidden');
  const avg = (k: Review['subject']) => {
    const xs = shown.filter((r) => r.subject === k);
    return xs.length ? (xs.reduce((a, r) => a + r.rating, 0) / xs.length).toFixed(2) : '—';
  };
  const setFeature = (key: keyof Features, on: boolean, label: string) =>
    act('reviews', `${on ? 'Turned on' : 'Turned off'} ${label}`, (d) => ({ ...d, features: { ...d.features, [key]: on } }));
  const setReview = (r: Review, next: Review['status']) =>
    act('reviews', `${next === 'hidden' ? 'Hid' : 'Published'} a ${r.rating}-star review of ${r.subjectName}`, (d) => ({ ...d, reviews: d.reviews.map((x) => (x.id === r.id ? { ...x, status: next } : x)) }));

  return (
    <Page title="Reviews" subtitle="Ratings in both directions, with moderation for anything flagged.">
      <ReadOnlyNote module="reviews" />
      <div className="stats">
        <Stat label="Average driver rating" value={avg('driver')} />
        <Stat label="Average customer rating" value={avg('customer')} />
        <Stat label="Waiting for review" value={count(db.reviews.filter((r) => r.status === 'flagged').length)} hint="Ratings of 2 stars or lower are flagged" />
      </div>
      <div className="grid-2-1">
        <Card flush>
          <div className="filters pad">
            <SearchBox value={q} onChange={setQ} placeholder="Search reviews" />
            <Select label="About" value={subject} onChange={setSubject} options={[{ value: 'all', label: 'Everyone' }, { value: 'driver', label: 'About drivers' }, { value: 'customer', label: 'About customers' }]} />
            <Select label="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'All statuses' }, { value: 'flagged', label: 'Flagged' }, { value: 'published', label: 'Published' }, { value: 'hidden', label: 'Hidden' }]} />
          </div>
          <Table label="Reviews" rows={rows} rowKey={(r) => r.id} empty="No reviews match these filters" defaultSort={{ key: 'at', dir: -1 }} columns={[
            { key: 'at', head: 'Date', sort: (r) => r.at, cell: (r) => shortDate(r.at) },
            { key: 'subject', head: 'About', sort: (r) => r.subjectName, cell: (r) => <Person name={r.subjectName} sub={`By ${r.authorName}`} /> },
            { key: 'rating', head: 'Rating', sort: (r) => r.rating, cell: (r) => <Stars value={r.rating} /> },
            { key: 'text', head: 'Review', cell: (r) => <span className="reviewtext">{r.text}</span> },
            { key: 'status', head: 'Status', sort: (r) => r.status, cell: (r) => <Badge tone={REVIEW_TONE[r.status].tone}>{REVIEW_TONE[r.status].label}</Badge> },
            { key: 'act', head: '', align: 'right', cell: (r) => (
              <div className="row end">
                {r.status !== 'published' && <Btn small disabled={!manage} onClick={() => setReview(r, 'published')}>Publish</Btn>}
                {r.status !== 'hidden' && <Btn small disabled={!manage} onClick={() => setReview(r, 'hidden')}>Hide</Btn>}
              </div>
            ) },
          ]} />
        </Card>
        <div className="stack">
          <Card title="Review system">
            <ul className="rules">
              <li><div><strong>Riders rate drivers</strong></div><Switch label="Riders rate drivers" checked={db.features.driverReviews} disabled={!manage} onChange={(v) => setFeature('driverReviews', v, 'reviews of drivers')} /></li>
              <li><div><strong>Drivers rate riders</strong></div><Switch label="Drivers rate riders" checked={db.features.customerReviews} disabled={!manage} onChange={(v) => setFeature('customerReviews', v, 'reviews of customers')} /></li>
            </ul>
          </Card>
          <Card title="Rating breakdown">
            <BarList format={count} items={[5, 4, 3, 2, 1].map((n) => ({ key: String(n), label: `${n} star${n > 1 ? 's' : ''}`, value: db.reviews.filter((r) => r.rating === n).length }))} />
          </Card>
        </div>
      </div>
    </Page>
  );
}

/* ---------- live chat ---------- */

const CHAT_TONE: Record<Chat['status'], { tone: Tone; label: string }> = {
  open: { tone: 'warn', label: 'Needs reply' }, waiting: { tone: 'info', label: 'Waiting on them' }, resolved: { tone: 'neutral', label: 'Resolved' },
};
const CANNED = ['Thanks for reaching out. Let me look into this for you.', 'I understand, and I am sorry about that.', 'Is there anything else I can help you with?'];

export function LiveChat() {
  const { db, can, act, me } = useAdmin();
  const manage = can('chat', 'manage');
  const [filter, setFilter] = useState<'active' | 'mine' | 'resolved'>('active');
  const [openId, setOpenId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const list = db.chats.filter((c) => (filter === 'resolved' ? c.status === 'resolved' : c.status !== 'resolved' && (filter === 'active' || c.assigneeId === me?.id)));
  const chat = db.chats.find((c) => c.id === openId) ?? null;
  const messageCount = chat?.messages.length;
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'nearest' });
  }, [openId, messageCount]);

  const patch = (id: string, summary: string, change: (c: Chat) => Chat) => act('chat', summary, (d) => ({ ...d, chats: d.chats.map((c) => (c.id === id ? change(c) : c)) }));
  const send = () => {
    if (!chat || !draft.trim()) return;
    const msg = { id: uid('m'), from: 'agent' as const, name: me?.name ?? 'Support', text: draft.trim(), at: Date.now() };
    if (patch(chat.id, `Replied to ${chat.name}: ${chat.subject}`, (c) => ({ ...c, status: 'waiting', assigneeId: c.assigneeId ?? me?.id ?? null, messages: [...c.messages, msg] }))) setDraft('');
  };
  const nameOf = (id: string | null) => db.employees.find((e) => e.id === id)?.name ?? 'Unassigned';

  return (
    <Page title="Live chat" subtitle="Talk with riders and drivers in one inbox.">
      <ReadOnlyNote module="chat" />
      {!db.features.liveChat && <Note tone="warn">Live chat is turned off in Platform, so riders and drivers can't start new chats.</Note>}
      <div className={`inbox${chat ? ' has-open' : ''}`}>
        <aside className="inbox-list">
          <Tabs value={filter} onChange={setFilter} tabs={[{ value: 'active', label: 'Active' }, { value: 'mine', label: 'Mine' }, { value: 'resolved', label: 'Resolved' }]} />
          {list.length ? (
            <ul>
              {list.map((c) => (
                <li key={c.id}>
                  <button aria-current={c.id === openId} onClick={() => setOpenId(c.id)}>
                    <Avatar name={c.name} />
                    <span className="inbox-item">
                      <strong>{c.name}</strong><span>{c.subject}</span>
                      <small className="muted">{c.party === 'driver' ? 'Driver' : 'Customer'} · {ago(c.messages[c.messages.length - 1].at)}</small>
                    </span>
                    <Badge tone={CHAT_TONE[c.status].tone}>{CHAT_TONE[c.status].label}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          ) : <Empty title="No chats here" />}
        </aside>
        <section className="thread">
          {chat ? (
            <>
              <header>
                <button className="btn ghost small thread-back" onClick={() => setOpenId(null)}>Back</button>
                <div className="thread-title"><strong>{chat.subject}</strong><small className="muted">{chat.name} · {nameOf(chat.assigneeId)}</small></div>
                <div className="row">
                  {chat.assigneeId !== me?.id && <Btn small disabled={!manage} onClick={() => patch(chat.id, `Took chat with ${chat.name}`, (c) => ({ ...c, assigneeId: me?.id ?? null }))}>Assign to me</Btn>}
                  {chat.status !== 'resolved'
                    ? <Btn small disabled={!manage} onClick={() => patch(chat.id, `Resolved chat with ${chat.name}`, (c) => ({ ...c, status: 'resolved' }))}>Resolve</Btn>
                    : <Btn small disabled={!manage} onClick={() => patch(chat.id, `Reopened chat with ${chat.name}`, (c) => ({ ...c, status: 'open' }))}>Reopen</Btn>}
                </div>
              </header>
              <div className="messages" aria-live="polite">
                {chat.messages.map((m) => (
                  <div key={m.id} className={`bubble ${m.from}`}>
                    <p>{m.text}</p>
                    <small>{m.name} · {dateTime(m.at)}</small>
                  </div>
                ))}
                <div ref={endRef} />
              </div>
              {chat.status !== 'resolved' && (
                <footer>
                  <div className="canned">{CANNED.map((t) => <button key={t} disabled={!manage} onClick={() => setDraft(t)}>{t}</button>)}</div>
                  <div className="composer">
                    <textarea className="input" rows={2} aria-label="Reply" placeholder="Write a reply" disabled={!manage} value={draft} onChange={(e) => setDraft(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); } }} />
                    <Btn kind="primary" icon="send" disabled={!manage || !draft.trim()} onClick={send}>Send</Btn>
                  </div>
                </footer>
              )}
            </>
          ) : <Empty title="Select a chat" body="Conversations open here." />}
        </section>
      </div>
    </Page>
  );
}

/* ---------- push ---------- */

const TITLE_MAX = 65;
const BODY_MAX = 178;

export function Push() {
  const { db, can, act, confirm, me } = useAdmin();
  const manage = can('push', 'manage');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [audience, setAudience] = useState('customers');
  const options = useMemo(() => {
    const activeC = db.customers.filter((c) => c.status === 'active');
    const activeD = db.drivers.filter((d) => d.status === 'active');
    return [
      { value: 'customers', label: 'All customers', reach: activeC.length },
      ...[...db.levels].sort((a, b) => a.minPoints - b.minPoints).map((l) => ({ value: `level:${l.id}`, label: `${l.name} customers`, reach: activeC.filter((c) => levelOf(db.levels, c.lifetimePoints).id === l.id).length })),
      { value: 'drivers', label: 'All drivers', reach: activeD.length },
      { value: 'drivers:San Francisco', label: 'Drivers in San Francisco', reach: activeD.filter((d) => d.city === 'San Francisco').length },
      { value: 'drivers:Chicago', label: 'Drivers in Chicago', reach: activeD.filter((d) => d.city === 'Chicago').length },
    ];
  }, [db.customers, db.drivers, db.levels]);
  const target = options.find((o) => o.value === audience) ?? options[0];
  const connected = db.integrations.find((i) => i.id === 'fcm')?.connected;
  const valid = title.trim() && body.trim() && title.length <= TITLE_MAX && body.length <= BODY_MAX && target.reach > 0;

  const send = () => confirm({
    title: `Send to ${count(target.reach)} people?`, body: `"${title.trim()}" goes to ${target.label.toLowerCase()}. A push can't be recalled once sent.`, okLabel: 'Send notification',
    onOk: () => {
      const id = uid('cp');
      const at = Date.now();
      const ok = act('push', `Sent push "${title.trim()}" to ${target.label} (${target.reach})`, (d) => ({ ...d, campaigns: [{ id, at, title: title.trim(), body: body.trim(), audience: target.label, reach: target.reach, by: me?.name ?? 'Unknown' }, ...d.campaigns] }));
      if (ok) {
        setTitle('');
        setBody('');
      }
    },
  });

  return (
    <Page title="Push notifications" subtitle="Message riders and drivers on their phones.">
      <ReadOnlyNote module="push" />
      {!db.features.push && <Note tone="warn">Push is turned off in Platform.</Note>}
      {!connected && <Note icon="plug">Firebase Cloud Messaging isn't connected, so campaigns are recorded here but not delivered to any phone.</Note>}
      <div className="grid-2-1">
        <Card title="New notification">
          <Field label="Audience" hint={`Reaches ${count(target.reach)} active ${target.reach === 1 ? 'person' : 'people'}.`}>
            <Select label="Audience" value={audience} onChange={setAudience} disabled={!manage} options={options.map((o) => ({ value: o.value, label: `${o.label} (${o.reach})` }))} />
          </Field>
          <Field label={`Title (${title.length}/${TITLE_MAX})`} error={title.length > TITLE_MAX ? 'Title is too long and would be cut off' : ''}>
            <input className="input" value={title} disabled={!manage} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label={`Message (${body.length}/${BODY_MAX})`} error={body.length > BODY_MAX ? 'Message is too long and would be cut off' : ''}>
            <textarea className="input" rows={3} value={body} disabled={!manage} onChange={(e) => setBody(e.target.value)} />
          </Field>
          <div><Btn kind="primary" icon="send" disabled={!manage || !valid || !db.features.push} onClick={send}>Review and send</Btn></div>
        </Card>
        <Card title="Preview">
          <div className="pushpreview">
            <span className="logo-mark tiny">W</span>
            <div><strong>{title || 'Your title'}</strong><p>{body || 'Your message appears here.'}</p></div>
          </div>
        </Card>
      </div>
      <Card flush title="Sent">
        <Table label="Sent notifications" rows={db.campaigns} rowKey={(c) => c.id} empty="Nothing sent yet" defaultSort={{ key: 'at', dir: -1 }} columns={[
          { key: 'at', head: 'Date', sort: (c) => c.at, cell: (c) => dateTime(c.at) },
          { key: 'title', head: 'Notification', cell: (c) => <span className="person-text"><strong>{c.title}</strong><small>{c.body}</small></span> },
          { key: 'aud', head: 'Audience', sort: (c) => c.audience, cell: (c) => c.audience },
          { key: 'reach', head: 'Reach', align: 'right', sort: (c) => c.reach, cell: (c) => count(c.reach) },
          { key: 'by', head: 'Sent by', cell: (c) => c.by },
        ]} />
      </Card>
    </Page>
  );
}
