# Phase 19 — pallet and reusable-packaging accounts

## Current status

Implemented locally from main `c36c33d` on `phase19-pallet-accounts`. No hosted migration or main publication yet. Phase 20 has not started. Photos remain disabled hosted.

## Business behavior

- Separate debt journal, not physical stock or an individual handling unit. Existing configurable `pallet_types` master data represents reusable types, including frames and other returnables; no business fixtures or types are hardcoded.
- Account dimensions: operating company, customer **or** supplier, reusable type. Positive balance means counterparty owes us; negative means we owe counterparty. Zero is settled. Both directions are valid; all quantities are integer pieces.
- Manual outbound/inbound, signed opening/correction and exact reversal. Reason, business date, reference, actor and timestamp retained. Reversal dated on posting date, preserves original party/type snapshot, links original and can happen once. A reversal cannot itself be reversed. Corrections do not delete history.
- Balance derived from immutable entries, optionally as of a date; history supports date range, counterparty/type filters and pagination. Balance does not apply a start-date filter, so a period movement cannot be mistaken for total debt.
- Draft shipment can declare actual returnable counts with snapshotted type names. Existing packing overview supports the operator; pallet type alone does not imply reusable/exchangeable status, so quantities are explicitly declared. Zero lines means no exchange. Duplicate types rejected; declarations version the shipment and retain immutable declaration history.
- Dispatch automatically posts declared quantities against the shipment customer in the **same transaction** as inventory/shipment posting. Permission or inventory failure rolls everything back. Cancelling never posts a debt; reservation/planning do not post a debt. Repeated dispatch does not duplicate debt.
- No second packaging consumption or physical stock change from this ledger. Separate manual movements must not duplicate a shipment movement; UI warns about this. Manual physical receipt/issue, if applicable, uses existing inventory workflows independently.

## Model / safety

Migration: `supabase/migrations/20260915115913_phase_19_pallet_accounts.sql` (created by installed CLI; not yet hosted).

- `app.pallet_events`: immutable authorized requests/results, unique company/idempotency key; input columns only writable by runtime. Actions outbound, inbound, correction, reverse, declare.
- `app.pallet_entries`: immutable derived journal; company-qualified foreign keys to customer/supplier/type/event/shipment/original entry. Exactly one party and exactly one event/shipment origin. Unique reversal and shipment/type origin. No runtime direct writes.
- `app.shipments.pallet_exchange`: protected JSON declaration projection; runtime cannot update it directly. Existing shipment version lock shared with declaration, plan and dispatch. Declaration events preserve previous versions even when changed.
- `pallets.read`, `pallets.manage`, `pallets.adjust`; runtime session/revocation/tenant checks and RLS. No browser role grants, no private-function execute grants. Masterdata.read additionally required for creating movements/declarations; shipment read/manage required for declaration; dispatch with declared returnables additionally needs pallets.read/manage.
- SERIALIZABLE NestJS commands with bounded retries and exact idempotency payload matching. Immutable sum avoids lost balance updates. Shared shipment lock handles declaration versus state transition; unique original-entry reversal avoids double correction.
- Historical party/type data remains stable. Customer and supplier records are separate account identities even when they represent the same real-world business; no implicit netting between them. Deactivated master data blocks new manual movements/declarations but does not prevent historical reversal or fulfillment of existing shipment snapshots.
- No new dependencies, services, jobs, resources, photos or paid features.

## API and UI

All paths below are under `/api/companies/:companyId/pallet-accounts`:

| Method | Path | Use |
| --- | --- | --- |
| GET | `/balances` | Paginated balances, optional as-of `to` |
| GET | `/entries` | Paginated journal and date filters |
| GET | `/entries/:id` | Entry, snapshot and traceability |
| POST | `/movements` | Manual inbound/outbound/correction |
| POST | `/entries/:id/reverse` | Exact reasoned reversal |
| GET | `/shipments/:id` | Declaration, version and history |
| POST | `/shipments/:id` | Replace draft declaration atomically |

Frontend: Pallemellemværender navigation, balance direction, movement history, party/type/date filters, confirmed commands, exact retry payload after uncertain response. Shipment detail includes editable draft returnables and dispatch confirmation includes the debt consequence. Role editor includes the new permissions. No design polishing.

## Verification evidence

- `npm run check`: 225 unit/API/database/helper tests PASS, 14 real PostgreSQL concurrency cases skipped locally because no local server; typechecks and API/web builds PASS.
- One additional rollback/cancellation security test subsequently added: targeted pallet API suite **7 PASS**, typechecks PASS. Thus 226 tests covered cumulatively, with no unrelated rerun after that addition.
- Tests cover signed integer debts, positive/negative balance, separate customer/supplier accounts, as-of filtering, immutable snapshots, idempotency mismatch, one-time reversal, invalid input, foreign references, read-only/tenant boundaries, column/function/browser grants, declaration versions/duplicates, dispatch atomicity/deduplication and no physical double debit. Permission-denied dispatch and cancellation preserve debt and inventory correctly.
- Added real PostgreSQL concurrency case: duplicate ledger write, competing reversals, declaration versus plan, duplicate shipment dispatch with declared packaging. Must run in existing CI disposable PostgreSQL; not claimed locally.
- Added browser tests across existing desktop/tablet/mobile projects for balance direction, company switch, read-only UI and confirmed identical-payload retry. Local Chromium unavailable; no repeated installation attempts. Existing CI can run these with standard runner.
- `scripts/verify-pallet-accounts.cjs`: read-only operator login/isolation helper; hidden credentials, status-only output and session cleanup. Two helper tests PASS. Empty hosted journal explicitly reports `PALLET_ACCOUNT_EXISTING_RECORD: NOT_RUN`; no fixture is created.
- Hosted migration, advisors/access checks, Railway route checks and real authenticated verification **not yet run**.

## Economic / release boundary

Local work uses existing tools/resources. Public GitHub repository and unchanged `ubuntu-latest` workflow verified. Working-branch CI has expected/worst-case additional runner cost 0 DKK under GitHub's public standard-runner policy; no artifact upload or paid runner. Existing npm cache uses unchanged lockfile/configuration. No main deployment authorized yet.

Main publication normally triggers Railway: prior comparable estimate 0–0.30 DKK expected, 1–3 DKK realistic worst-case, one-off build/startup overlap. Duration/included allowance cannot establish <=1 DKK with confidence, so obtain approval before main publication. No manual deployment or resource changes.

### Publication approval gate

Automatic approval review rejected uploading the Phase 19 tree to the working branch: it requires explicit authorization to publish/share the implementation, despite the implementation task and verified 0 DKK CI estimate. No GitHub tree, branch, main update, hosted migration or deployment was performed. Implementation commit is `242d3c3`; explicit approval for working-branch publication and existing CI is required to continue. Do not bypass the review rejection. Existing local test evidence stands; no additional reruns.
