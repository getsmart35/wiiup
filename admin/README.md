# WiiUp admin dashboard

The back-office web app for WiiUp, separate from the Expo app in `../src`. Built with React, TypeScript and
Vite, with no UI or chart libraries. Fare and subscription rules are imported from `../web-prototype/src/lib`,
so the numbers here follow the same rules drivers see.

**Status: working front end on sample data.** There is no server yet. Data lives in this browser's
localStorage, "Viewing as" stands in for sign-in, and alerts are simulated. Don't put real customer data in it
or expose it publicly until the items under "Before production" are done.

## Run

```bash
cd admin
npm install
npm run dev        # http://localhost:5174
npm run build      # typecheck and production bundle
```

Use **Viewing as** in the top bar to try each role. Platform > Reset sample data restores the starting state.

## What's in it

| Module | What it does |
| --- | --- |
| Overview | Key numbers, revenue trend, action queue and recent alerts, limited to what the viewer may see |
| Analytics | Trends by date range, rides by service, peak hours, revenue by plan and generated insights |
| Payments | Transactions, partial refunds, charge retries, subscriptions, driver payouts and CSV export |
| Customers | Add, edit, suspend, analytics per customer, level breakdown and CSV export |
| Drivers | Status, plan, and monthly rides, fares and fee |
| Driver onboarding | Document review, background check and approval, plus Platinum approvals for licensed livery drivers |
| Background checks | Consent, five-part reports, review, adverse action notices with a waiting period, and yearly driver renewals. Findings are limited to Owner and Compliance |
| Levels & rewards | Customer levels, automatic reward rules, and capped manual grants of points and wallet bonuses |
| Reviews | Two-way ratings on/off, moderation of flagged reviews |
| Live chat | Shared inbox with assignment, canned replies and resolve/reopen |
| Push notifications | Audience targeting with reach, preview, confirmation and history |
| Employees | Invite, edit, suspend, delete and per-person module access |
| Roles & access | Permission matrix (no access / view / manage) and custom roles |
| Tasks | Delegate work, track overdue items and reassign |
| Activity log | Every staff change: who, what and when |
| Platform | Feature switches, integration status and demo controls |

## How it's organised

```
src/App.tsx             module registry, menu, top bar, notifications, toasts
src/store.tsx           state, permission checks, audit logging, event stream
src/lib/access.ts       permission rules
src/lib/analytics.ts    every derived number (pure functions)
src/lib/seed.ts         sample data, generated from the real fare and plan rules
src/lib/sim.ts          simulated live events
src/components/         UI kit and SVG charts
src/screens/            one file per area
```

- **Adding a module:** add its ID to `types.ts` and `access.ts`, then one entry to `MODULES` and `NAV` in
  `App.tsx`. It then appears in the menu, the permission matrix and the access editor.
- **Every change goes through `act()`** in `store.tsx`, which checks permission, applies the change and writes
  the audit entry. Moving to a real API mostly means replacing that function and `system()`.
- **Revenue:** drivers keep 100% of fares, so WiiUp's revenue is driver subscriptions only. Fares are reported
  separately as money passing through. Money is stored as integer cents.

## Before production

1. **Server and database.** Replace localStorage and the sample data.
2. **Real sign-in** with SSO or MFA for staff, replacing "Viewing as".
3. **Server-side permissions.** The checks here only control the interface. Anyone with browser tools can get
   around them, so the API must enforce the same rules and mask contact details before sending them.
4. **Server-written audit log**, so entries really can't be edited.
5. **Integrations:** Stripe (charges, refunds, payouts), Checkr or another provider (replacing `advanceChecks` in
   `lib/checks.ts`, and handling the real notices), FCM (push), a WebSocket stream (replacing `sim.ts`) and file storage for driver documents.
6. **Legal review of background checks.** The workflow follows the usual FCRA steps, but counsel should confirm
   the consent wording, notices, the 7-day waiting period and local fair chance rules. The sample notices aren't
   really sent, and reports should get retention rules and access logging on the server.
