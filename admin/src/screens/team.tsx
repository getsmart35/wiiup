import { useState } from 'react';

import { Badge, Btn, Card, Dialog, Field, Note, Page, Person, ReadOnlyNote, SearchBox, Select, Stat, Table, Tabs, type Tone } from '../components/ui';
import { canGrant, effectiveAccess, isLastOwner, MODULE_IDS, MODULE_LABEL, roleWithinMine, accessMap } from '../lib/access';
import { ago, count, dateTime, DAY, downloadCsv, isEmail, shortDate, uid } from '../lib/format';
import { useAdmin } from '../store';
import type { Access, Employee, ModuleId, Task } from '../types';

const STATUS: Record<Employee['status'], { tone: Tone; label: string }> = {
  active: { tone: 'good', label: 'Active' }, suspended: { tone: 'bad', label: 'Suspended' }, invited: { tone: 'info', label: 'Invited' },
};
const ACCESS_LABEL: Record<Access, string> = { none: 'No access', view: 'View', manage: 'Manage' };
const LEVELS: Access[] = ['none', 'view', 'manage'];

/* ---------- employees ---------- */

export function Employees() {
  const { db, me, can, act, confirm, toast } = useAdmin();
  const manage = can('employees', 'manage');
  const manageAccess = can('access', 'manage');
  const [q, setQ] = useState('');
  const [editing, setEditing] = useState<Employee | 'new' | null>(null);
  const [accessFor, setAccessFor] = useState<string | null>(null);
  const roleName = (id: string) => db.roles.find((r) => r.id === id)?.name ?? 'No role';
  const rows = db.employees.filter((e) => `${e.name} ${e.email} ${e.title}`.toLowerCase().includes(q.trim().toLowerCase()));
  const outranks = (e: Employee) => {
    const role = db.roles.find((r) => r.id === e.roleId);
    return !!role && !roleWithinMine(me, db.roles, role);
  };
  const locked = (e: Employee) => e.id === me?.id || outranks(e) || isLastOwner(db, e.id);

  const setStatus = (e: Employee, status: Employee['status']) => {
    const apply = () => act('employees', `${status === 'suspended' ? 'Suspended' : 'Activated'} employee ${e.name}`, (d) => ({ ...d, employees: d.employees.map((x) => (x.id === e.id ? { ...x, status } : x)) }));
    if (status === 'suspended') confirm({ title: `Suspend ${e.name}?`, body: 'They lose access to every module right away. Their history stays in the activity log.', okLabel: 'Suspend employee', danger: true, onOk: apply });
    else apply();
  };
  const remove = (e: Employee) => confirm({
    title: `Delete ${e.name}?`, body: "This removes their account and unassigns their open tasks and chats. Their past actions stay in the activity log. This can't be undone.", okLabel: 'Delete employee', danger: true,
    onOk: () => {
      act('employees', `Deleted employee ${e.name}`, (d) => ({
        ...d,
        employees: d.employees.filter((x) => x.id !== e.id),
        tasks: d.tasks.map((t) => (t.assigneeId === e.id ? { ...t, assigneeId: null } : t)),
        chats: d.chats.map((c) => (c.assigneeId === e.id ? { ...c, assigneeId: null } : c)),
      }));
      toast({ severity: 'info', title: `${e.name} was deleted` });
    },
  });
  const whyLocked = (e: Employee) => (e.id === me?.id ? "You can't change your own account here" : isLastOwner(db, e.id) ? 'This is the only active Owner' : outranks(e) ? 'This person has more access than you' : undefined);
  const open = db.employees.find((e) => e.id === accessFor);

  return (
    <Page title="Employees" subtitle="Your team, what they can open, and their account status." actions={<Btn kind="primary" icon="plus" disabled={!manage} onClick={() => setEditing('new')}>Invite employee</Btn>}>
      <ReadOnlyNote module="employees" />
      <Card flush>
        <div className="filters pad"><SearchBox value={q} onChange={setQ} placeholder="Search name, email or title" /></div>
        <Table label="Employees" rows={rows} rowKey={(e) => e.id} empty="No employees match" columns={[
          { key: 'name', head: 'Employee', sort: (e) => e.name, cell: (e) => <Person name={e.name} sub={e.email} /> },
          { key: 'title', head: 'Title', sort: (e) => e.title, cell: (e) => e.title },
          { key: 'role', head: 'Role', sort: (e) => roleName(e.roleId), cell: (e) => <>{roleName(e.roleId)}{Object.keys(e.overrides).length > 0 && <small className="muted block">{Object.keys(e.overrides).length} custom</small>}</> },
          { key: 'status', head: 'Status', sort: (e) => e.status, cell: (e) => <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge> },
          { key: 'last', head: 'Last active', sort: (e) => e.lastActive ?? 0, cell: (e) => (e.lastActive ? ago(e.lastActive) : 'Never') },
          { key: 'act', head: '', align: 'right', cell: (e) => {
            const why = whyLocked(e);
            return (
              <div className="row end nowrap">
                <Btn small disabled={!manage || outranks(e)} onClick={() => setEditing(e)}>Edit</Btn>
                <Btn small disabled={!manageAccess || locked(e)} title={why} onClick={() => setAccessFor(e.id)}>Access</Btn>
                {e.status === 'active'
                  ? <Btn small disabled={!manage || locked(e)} title={why} onClick={() => setStatus(e, 'suspended')}>Suspend</Btn>
                  : <Btn small disabled={!manage || locked(e)} title={why} onClick={() => setStatus(e, 'active')}>Activate</Btn>}
                <Btn small disabled={!manage || locked(e)} title={why} onClick={() => remove(e)}>Delete</Btn>
              </div>
            );
          } },
        ]} />
      </Card>
      {editing && <EmployeeForm employee={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
      {open && <AccessEditor employee={open} onClose={() => setAccessFor(null)} />}
    </Page>
  );
}

function EmployeeForm({ employee, onClose }: { employee: Employee | null; onClose: () => void }) {
  const { db, me, can, act } = useAdmin();
  const changeRole = can('access', 'manage') && employee?.id !== me?.id && !(employee && isLastOwner(db, employee.id));
  const assignable = db.roles.filter((r) => roleWithinMine(me, db.roles, r));
  const [f, setF] = useState({ name: employee?.name ?? '', email: employee?.email ?? '', title: employee?.title ?? '', roleId: employee?.roleId ?? (assignable.find((r) => r.id === 'support') ?? assignable[0])?.id ?? '' });
  const [tried, setTried] = useState(false);
  const email = f.email.trim().toLowerCase();
  const errors = {
    name: f.name.trim() ? '' : 'Enter a name',
    email: !isEmail(email) ? 'Enter a valid email' : db.employees.some((e) => e.email.toLowerCase() === email && e.id !== employee?.id) ? 'Another employee uses this email' : '',
  };
  const save = () => {
    setTried(true);
    if (errors.name || errors.email || !f.roleId) return;
    const values = { name: f.name.trim(), email, title: f.title.trim() };
    if (employee) {
      const roleId = changeRole ? f.roleId : employee.roleId;
      act('employees', roleId !== employee.roleId ? `Changed ${values.name}'s role to ${db.roles.find((r) => r.id === roleId)?.name}` : `Updated employee ${values.name}`, (d) => ({ ...d, employees: d.employees.map((e) => (e.id === employee.id ? { ...e, ...values, roleId } : e)) }));
    } else {
      const id = uid('e');
      act('employees', `Invited ${values.name} as ${db.roles.find((r) => r.id === f.roleId)?.name}`, (d) => ({ ...d, employees: [...d.employees, { id, ...values, roleId: f.roleId, status: 'invited', overrides: {}, lastActive: null }] }));
    }
    onClose();
  };
  const roleOptions = (employee && !assignable.some((r) => r.id === employee.roleId) ? db.roles : assignable).map((r) => ({ value: r.id, label: r.name, disabled: !assignable.some((a) => a.id === r.id) }));
  return (
    <Dialog title={employee ? `Edit ${employee.name}` : 'Invite employee'} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save}>{employee ? 'Save changes' : 'Send invite'}</Btn></>}>
      <Field label="Full name" error={tried ? errors.name : ''}><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
      <Field label="Work email" error={tried ? errors.email : ''}><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>
      <Field label="Job title"><input className="input" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></Field>
      <Field label="Role" hint={employee && !changeRole ? "You can't change this person's role." : db.roles.find((r) => r.id === f.roleId)?.description}>
        <Select label="Role" value={f.roleId} disabled={!!employee && !changeRole} onChange={(roleId) => setF({ ...f, roleId })} options={roleOptions} />
      </Field>
    </Dialog>
  );
}

function AccessEditor({ employee, onClose }: { employee: Employee; onClose: () => void }) {
  const { db, me, act } = useAdmin();
  const [overrides, setOverrides] = useState(employee.overrides);
  const role = db.roles.find((r) => r.id === employee.roleId);
  const set = (m: ModuleId, v: Access | 'role') => setOverrides((o) => {
    const next = { ...o };
    if (v === 'role') delete next[m];
    else next[m] = v;
    return next;
  });
  const save = () => {
    const changed = MODULE_IDS.filter((m) => overrides[m] !== employee.overrides[m]).map((m) => `${MODULE_LABEL[m]}: ${overrides[m] ? ACCESS_LABEL[overrides[m]] : 'role default'}`);
    if (changed.length) act('access', `Changed ${employee.name}'s module access (${changed.join(', ')})`, (d) => ({ ...d, employees: d.employees.map((e) => (e.id === employee.id ? { ...e, overrides } : e)) }));
    onClose();
  };
  return (
    <Dialog title={`Module access for ${employee.name}`} onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save}>Save access</Btn></>}>
      <p className="muted">Starts from the {role?.name ?? 'assigned'} role. Set a module to override it for this person only.</p>
      <ul className="accesslist">
        {MODULE_IDS.map((m) => (
          <li key={m}>
            <span>{MODULE_LABEL[m]}</span>
            <Select label={MODULE_LABEL[m]} value={overrides[m] ?? 'role'} onChange={(v) => set(m, v as Access | 'role')} options={[
              { value: 'role', label: `Role default (${ACCESS_LABEL[role?.access[m] ?? 'none']})` },
              ...LEVELS.map((l) => ({ value: l, label: ACCESS_LABEL[l], disabled: !canGrant(me, db.roles, m, l) })),
            ]} />
          </li>
        ))}
      </ul>
    </Dialog>
  );
}

/* ---------- roles and access ---------- */

export function AccessControl() {
  const { db, me, can, act, confirm, toast } = useAdmin();
  const manage = can('access', 'manage');
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [desc, setDesc] = useState('');
  const setCell = (roleId: string, roleName: string, m: ModuleId, level: Access) =>
    act('access', `Set ${roleName} to ${ACCESS_LABEL[level]} on ${MODULE_LABEL[m]}`, (d) => ({ ...d, roles: d.roles.map((r) => (r.id === roleId ? { ...r, access: { ...r.access, [m]: level } } : r)) }));
  const addRole = () => {
    const n = name.trim();
    if (!n) return;
    if (db.roles.some((r) => r.name.toLowerCase() === n.toLowerCase())) return toast({ severity: 'error', title: 'A role with this name already exists' });
    const id = uid('role');
    act('access', `Created role ${n}`, (d) => ({ ...d, roles: [...d.roles, { id, name: n, description: desc.trim(), system: false, access: accessMap('none', { overview: 'view' }) }] }));
    setAdding(false);
    setName('');
    setDesc('');
  };
  return (
    <Page title="Roles & access" subtitle="Decide who can see and change each module." actions={<Btn kind="primary" icon="plus" disabled={!manage} onClick={() => setAdding(true)}>New role</Btn>}>
      <ReadOnlyNote module="access" />
      <Note icon="shield">View-only staff see masked contact details. Access applies the moment you change it, and every change is written to the activity log.</Note>
      <Card flush>
        <div className="tablewrap" tabIndex={0} role="region" aria-label="Role permissions">
          <table className="matrix">
            <thead>
              <tr>
                <th>Module</th>
                {db.roles.map((r) => {
                  const inUse = db.employees.filter((e) => e.roleId === r.id).length;
                  return (
                    <th key={r.id}>
                      {r.name}
                      <small className="block muted">{count(inUse)} {inUse === 1 ? 'person' : 'people'}</small>
                      {!r.system && (
                        <button className="linkbtn" disabled={!manage || inUse > 0} title={inUse > 0 ? 'Move people off this role first' : undefined} onClick={() => confirm({
                          title: `Delete ${r.name}?`, body: 'This role has no one assigned.', okLabel: 'Delete role', danger: true,
                          onOk: () => act('access', `Deleted role ${r.name}`, (d) => ({ ...d, roles: d.roles.filter((x) => x.id !== r.id) })),
                        })}>Delete</button>
                      )}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {MODULE_IDS.map((m) => (
                <tr key={m}>
                  <td><strong>{MODULE_LABEL[m]}</strong></td>
                  {db.roles.map((r) => (
                    <td key={r.id}>
                      <Select label={`${r.name}: ${MODULE_LABEL[m]}`} value={r.access[m]} disabled={!manage || r.id === 'owner'} onChange={(v) => setCell(r.id, r.name, m, v)}
                        options={LEVELS.map((l) => ({ value: l, label: ACCESS_LABEL[l], disabled: !canGrant(me, db.roles, m, l) }))} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="muted small">The Owner role always has full access, so the account can't be locked out.</p>
      {adding && (
        <Dialog title="New role" onClose={() => setAdding(false)} footer={<><Btn onClick={() => setAdding(false)}>Cancel</Btn><Btn kind="primary" disabled={!name.trim()} onClick={addRole}>Create role</Btn></>}>
          <Field label="Role name"><input className="input" value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="What is it for?"><input className="input" value={desc} onChange={(e) => setDesc(e.target.value)} /></Field>
          <p className="muted small">New roles start with view access to Overview only. Add more in the table.</p>
        </Dialog>
      )}
    </Page>
  );
}

/* ---------- tasks ---------- */

const TASK_STATUS: Record<Task['status'], string> = { open: 'To do', in_progress: 'In progress', done: 'Done' };

export function Tasks() {
  const { db, me, can, act, go } = useAdmin();
  const manage = can('tasks', 'manage');
  const [filter, setFilter] = useState<'all' | 'mine' | 'overdue'>(manage ? 'all' : 'mine');
  const [adding, setAdding] = useState(false);
  const now = Date.now();
  const overdue = (t: Task) => t.status !== 'done' && t.due < now;
  const staff = db.employees.filter((e) => e.status === 'active');
  const nameOf = (id: string | null) => db.employees.find((e) => e.id === id)?.name ?? 'Unassigned';
  const rows = db.tasks.filter((t) => (filter === 'all' ? true : filter === 'mine' ? t.assigneeId === me?.id : overdue(t)));
  const openTasks = db.tasks.filter((t) => t.status !== 'done');

  const setStatus = (t: Task, status: Task['status']) =>
    // People can always update work assigned to them, even with view-only access to the module
    act('tasks', `Marked "${t.title}" as ${TASK_STATUS[status].toLowerCase()}`, (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, status } : x)) }), t.assigneeId === me?.id ? 'view' : 'manage');
  const reassign = (t: Task, assigneeId: string) =>
    act('tasks', `Reassigned "${t.title}" to ${nameOf(assigneeId)}`, (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, assigneeId: assigneeId || null } : x)) }));

  return (
    <Page title="Tasks" subtitle="Hand off work and see how it's going." actions={<Btn kind="primary" icon="plus" disabled={!manage} onClick={() => setAdding(true)}>Delegate task</Btn>}>
      <ReadOnlyNote module="tasks" />
      <div className="stats">
        <Stat label="Open" value={count(openTasks.length)} />
        <Stat label="Overdue" value={count(openTasks.filter(overdue).length)} />
        <Stat label="Unassigned" value={count(openTasks.filter((t) => !t.assigneeId).length)} />
        <Stat label="Done" value={count(db.tasks.length - openTasks.length)} />
      </div>
      <Tabs value={filter} onChange={setFilter} tabs={[{ value: 'all', label: 'All' }, { value: 'mine', label: 'Mine' }, { value: 'overdue', label: 'Overdue' }]} />
      <Card flush>
        <Table label="Tasks" rows={rows} rowKey={(t) => t.id} empty="No tasks here" defaultSort={{ key: 'due', dir: 1 }} columns={[
          { key: 'title', head: 'Task', sort: (t) => t.title, cell: (t) => (
            <span className="person-text">
              <strong>{t.title}</strong>
              <small>{can(t.module) ? <button className="linkbtn" onClick={() => go(t.module)}>{MODULE_LABEL[t.module]}</button> : MODULE_LABEL[t.module]} · From {t.createdBy}</small>
            </span>
          ) },
          { key: 'who', head: 'Assignee', sort: (t) => nameOf(t.assigneeId), cell: (t) => (
            <Select label={`Assignee for ${t.title}`} value={t.assigneeId ?? ''} disabled={!manage} onChange={(v) => reassign(t, v)}
              options={[{ value: '', label: 'Unassigned' }, ...staff.map((e) => ({ value: e.id, label: e.name }))]} />
          ) },
          { key: 'due', head: 'Due', sort: (t) => t.due, cell: (t) => (overdue(t) ? <Badge tone="bad">Overdue {shortDate(t.due)}</Badge> : shortDate(t.due)) },
          { key: 'pri', head: 'Priority', sort: (t) => t.priority, cell: (t) => (t.priority === 'high' ? <Badge tone="warn">High</Badge> : 'Normal') },
          { key: 'status', head: 'Status', sort: (t) => t.status, cell: (t) => (
            <Select label={`Status of ${t.title}`} value={t.status} disabled={!manage && t.assigneeId !== me?.id} onChange={(v) => setStatus(t, v)}
              options={(Object.keys(TASK_STATUS) as Task['status'][]).map((s) => ({ value: s, label: TASK_STATUS[s] }))} />
          ) },
        ]} />
      </Card>
      {adding && <TaskForm onClose={() => setAdding(false)} />}
    </Page>
  );
}

function TaskForm({ onClose }: { onClose: () => void }) {
  const { db, me, act } = useAdmin();
  const staff = db.employees.filter((e) => e.status === 'active');
  const [title, setTitle] = useState('');
  const [assigneeId, setAssigneeId] = useState(staff[0]?.id ?? '');
  const [module, setModule] = useState<ModuleId>('overview');
  const [priority, setPriority] = useState<Task['priority']>('normal');
  const [dueDays, setDueDays] = useState('3');
  const [tried, setTried] = useState(false);
  const assignee = staff.find((e) => e.id === assigneeId);
  const noAccess = assignee && effectiveAccess(assignee, db.roles, module) === 'none';
  const save = () => {
    setTried(true);
    if (!title.trim() || !assignee) return;
    const id = uid('t');
    const due = Date.now() + Number(dueDays) * DAY;
    act('tasks', `Delegated "${title.trim()}" to ${assignee.name}`, (d) => ({ ...d, tasks: [{ id, title: title.trim(), assigneeId, createdBy: me?.name ?? 'Unknown', due, priority, status: 'open', module }, ...d.tasks] }));
    onClose();
  };
  return (
    <Dialog title="Delegate task" onClose={onClose} footer={<><Btn onClick={onClose}>Cancel</Btn><Btn kind="primary" onClick={save}>Assign task</Btn></>}>
      <Field label="What needs doing?" error={tried && !title.trim() ? 'Describe the task' : ''}><input className="input" value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
      <Field label="Assign to"><Select label="Assign to" value={assigneeId} onChange={setAssigneeId} options={staff.map((e) => ({ value: e.id, label: e.name }))} /></Field>
      <Field label="Related module"><Select label="Related module" value={module} onChange={setModule} options={MODULE_IDS.map((m) => ({ value: m, label: MODULE_LABEL[m] }))} /></Field>
      {noAccess && <Note tone="warn">{assignee.name} can't open {MODULE_LABEL[module]}. Give them access in Roles & access, or pick someone else.</Note>}
      <Field label="Priority"><Select label="Priority" value={priority} onChange={setPriority} options={[{ value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }]} /></Field>
      <Field label="Due"><Select label="Due" value={dueDays} onChange={setDueDays} options={[{ value: '1', label: 'Tomorrow' }, { value: '3', label: 'In 3 days' }, { value: '7', label: 'In a week' }, { value: '14', label: 'In 2 weeks' }]} /></Field>
    </Dialog>
  );
}

/* ---------- activity log ---------- */

export function Activity() {
  const { db } = useAdmin();
  const [actor, setActor] = useState('all');
  const [module, setModule] = useState<'all' | ModuleId>('all');
  const [q, setQ] = useState('');
  const actors = [...new Set(db.audit.map((a) => a.actor))].sort();
  const rows = db.audit.filter((a) => (actor === 'all' || a.actor === actor) && (module === 'all' || a.module === module) && a.summary.toLowerCase().includes(q.trim().toLowerCase()));
  return (
    <Page title="Activity log" subtitle="Every staff change, with who made it and when. Entries can't be edited." actions={
      <Btn icon="download" onClick={() => downloadCsv('wiiup-activity.csv', [['When', 'Who', 'Module', 'What'], ...rows.map((a) => [new Date(a.at).toISOString(), a.actor, MODULE_LABEL[a.module], a.summary])])}>Export CSV</Btn>
    }>
      <Card flush>
        <div className="filters pad">
          <SearchBox value={q} onChange={setQ} placeholder="Search activity" />
          <Select label="Person" value={actor} onChange={setActor} options={[{ value: 'all', label: 'Everyone' }, ...actors.map((a) => ({ value: a, label: a }))]} />
          <Select label="Module" value={module} onChange={setModule} options={[{ value: 'all', label: 'All modules' }, ...MODULE_IDS.map((m) => ({ value: m, label: MODULE_LABEL[m] }))]} />
        </div>
        <Table label="Activity" rows={rows} rowKey={(a) => a.id} empty="No activity matches" pageSize={20} defaultSort={{ key: 'at', dir: -1 }} columns={[
          { key: 'at', head: 'When', sort: (a) => a.at, cell: (a) => dateTime(a.at) },
          { key: 'who', head: 'Who', sort: (a) => a.actor, cell: (a) => <Person name={a.actor} /> },
          { key: 'module', head: 'Module', sort: (a) => a.module, cell: (a) => MODULE_LABEL[a.module] },
          { key: 'what', head: 'What happened', cell: (a) => a.summary },
        ]} />
      </Card>
    </Page>
  );
}
