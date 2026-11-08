import type { Tier } from '../../web-prototype/src/lib/fare';
import type { PlanId } from '../../web-prototype/src/lib/plans';

export type { PlanId, Tier };

/** Money is integer cents everywhere in the admin. Times are epoch ms. */
export type ModuleId =
  | 'overview' | 'analytics' | 'customers' | 'drivers' | 'onboarding' | 'checks' | 'payments'
  | 'loyalty' | 'reviews' | 'chat' | 'push' | 'employees' | 'access' | 'tasks' | 'activity' | 'platform';

export type Access = 'none' | 'view' | 'manage';
export type City = 'San Francisco' | 'Chicago';

export type Role = { id: string; name: string; description: string; system: boolean; access: Record<ModuleId, Access> };

export type Employee = {
  id: string; name: string; email: string; title: string; roleId: string;
  status: 'active' | 'suspended' | 'invited';
  overrides: Partial<Record<ModuleId, Access>>;
  lastActive: number | null;
};

export type Customer = {
  id: string; name: string; email: string; phone: string; city: City;
  status: 'active' | 'suspended'; joinedAt: number; rating: number; card: string;
  points: number; lifetimePoints: number; wallet: number;
};

export type Driver = {
  id: string; name: string; email: string; phone: string; city: City;
  status: 'active' | 'suspended'; joinedAt: number; rating: number; card: string;
  plan: PlanId; car: string; plate: string; points: number; wallet: number; paidThrough: number;
};

export type DocType = 'license' | 'registration' | 'insurance' | 'inspection' | 'photo';
export type DocStatus = 'missing' | 'pending' | 'verified' | 'rejected';
export type DriverDoc = { status: DocStatus; expires?: number; note?: string };
export type CheckPartId = 'identity' | 'criminal' | 'offender' | 'watchlist' | 'driving';
export type CheckPartResult = 'pending' | 'clear' | 'consider';
export type BackgroundCheck = {
  id: string; subject: 'applicant' | 'driver'; subjectId: string; name: string; city: City;
  status: 'consent_sent' | 'running' | 'clear' | 'review' | 'pre_adverse' | 'adverse_final';
  orderedBy: string; requestedAt: number; consentAt?: number; startedAt?: number; completedAt?: number; expiresAt?: number; noticeAt?: number;
  parts: Record<CheckPartId, { result: CheckPartResult; finding?: string }>;
  events: { at: number; by: string; text: string }[];
};

export type Applicant = {
  id: string; name: string; email: string; phone: string; city: City; car: string; plate: string; plan: PlanId;
  submittedAt: number; docs: Record<DocType, DriverDoc>;
  decision: 'pending' | 'approved' | 'rejected'; decisionNote?: string; decidedAt?: number;
};

export type PlatinumRequest = {
  id: string; driverId: string; name: string; city: City; license: string; submittedAt: number;
  status: 'pending' | 'approved' | 'rejected'; note?: string; decidedBy?: string; decidedAt?: number;
};

export type TxnKind = 'fare' | 'subscription' | 'refund' | 'bonus' | 'payout';
export type TxnStatus = 'succeeded' | 'failed';
export type Txn = {
  id: string; kind: TxnKind; at: number; amount: number; status: TxnStatus;
  customerId?: string; driverId?: string; tier?: Tier; tip?: number;
  refunded?: number; plan?: PlanId; note?: string; refundOf?: string;
};

export type Level = { id: string; name: string; minPoints: number; multiplier: number; walletBonus: number; perk: string };
export type RewardRule = { id: string; name: string; audience: 'customer' | 'driver'; trigger: string; points: number; wallet: number; active: boolean };
export type Grant = { id: string; at: number; audience: 'customer' | 'driver'; recipientId: string; recipient: string; points: number; wallet: number; reason: string; by: string };

export type Review = {
  id: string; at: number; subject: 'driver' | 'customer'; subjectName: string; authorName: string;
  rating: number; text: string; status: 'published' | 'flagged' | 'hidden';
};

export type ChatMessage = { id: string; from: 'user' | 'agent'; name: string; text: string; at: number };
export type Chat = {
  id: string; party: 'customer' | 'driver'; name: string; subject: string;
  status: 'open' | 'waiting' | 'resolved'; assigneeId: string | null; messages: ChatMessage[];
};

export type Campaign = { id: string; at: number; title: string; body: string; audience: string; reach: number; by: string };

export type Task = {
  id: string; title: string; assigneeId: string | null; createdBy: string; due: number;
  priority: 'high' | 'normal'; status: 'open' | 'in_progress' | 'done'; module: ModuleId;
};

export type Severity = 'critical' | 'warning' | 'info';
export type Notice = { id: string; at: number; severity: Severity; title: string; body: string; module: ModuleId; read: boolean };
export type AuditEntry = { id: string; at: number; actor: string; module: ModuleId; summary: string };
export type Integration = { id: string; name: string; category: string; description: string; connected: boolean };
export type Features = { driverReviews: boolean; customerReviews: boolean; loyalty: boolean; liveChat: boolean; push: boolean };

export type Db = {
  roles: Role[]; employees: Employee[]; customers: Customer[]; drivers: Driver[]; applicants: Applicant[]; checks: BackgroundCheck[]; platinumRequests: PlatinumRequest[];
  txns: Txn[]; levels: Level[]; rules: RewardRule[]; grants: Grant[]; reviews: Review[]; chats: Chat[];
  campaigns: Campaign[]; tasks: Task[]; notices: Notice[]; audit: AuditEntry[]; integrations: Integration[];
  features: Features; live: boolean;
};
