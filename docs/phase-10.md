# Phase 10 — Production order planning

Continues from approved main `952dde2`. Phase 11 has not started. Hosted photos remain disabled.

## Scope and behavior

Production orders have stable internal IDs, company-unique case-insensitive order numbers, product, optional customer/machine, planned quantity, start/deadline, priority and notes. Create defaults come from existing product data and explicitly marked default BOM/packing recipes. No business data is seeded. A product cannot be changed on an existing order.

Drafts may lack unit/BOM/packing/machine and display missing-data warnings. Planning requires a stock unit and a published compatible BOM. Marking ready additionally requires machine, packing and no open problem. Ready is an operator's planning/klargøring confirmation; it does not assert stock availability, reserve stock or start a machine. Problems remain a separate text marker, including on an already-ready order.

Phase 10 supports draft → planned → ready, planned → draft and ready → planned. Draft edits require the current version. Return explicitly to draft before changing planned data. Planning snapshots are refreshed deliberately when a draft is edited/planned; previous values remain in the audit. The full approved status vocabulary is reserved in the database, but transitions to production/reconciliation/completion are rejected until later phases implement the required workflows. No production quantities/progress are fabricated.

Selected sealed BOM and packing revisions are copied into the order snapshot with product name/code, stock unit, production defaults, customer address and machine identity. Masterdata changes never rewrite an existing order or its history. Read-only production users can read the snapshot and requirements without masterdata privileges. Creation/planning requires `production.read`, `production.manage` and `masterdata.read`. Tenant RLS and composite foreign keys apply throughout; browser roles have no business-schema access.

The existing fixed-point calculator derives component requirements, packaging counts, full/partial containers and remainder from the snapshot. No floating-point quantity math. Consumption ownership remains BOM versus packing, with duplicate components rejected. Optional order-specific packing quantities/capacities override existing lines only, are validated and snapshotted on this order, and never update a master recipe. Changes to the component structure require selecting a suitable published recipe.

## Database and transaction boundaries

New tables: `app.production_orders`, `app.production_order_audit`. New permissions: `production.read`, `production.manage`. Indexed company/code/status/date/product/customer/machine/revision references. Positive finite numeric(20,8) quantity, whole count units, deadline not before start, company-safe references and bounded text/JSON. Runtime has only explicit insert/update columns on orders and SELECT on immutable audit. No delete grants, no snapshot/identity update grants, no audit mutations.

Internal `app_owner` trigger functions validate tenant/actor/permissions before privileged snapshot reads and audit append. They are in `app_private`, have fixed search paths and no runtime/browser EXECUTE grant. Snapshot JSON quantity fields use strings to preserve exact precision in JavaScript. No exposed security-definer API.

NestJS uses existing SERIALIZABLE transactions with bounded retries for serialization/deadlock and creation-key collisions. Creation key + normalized request detects duplicate submissions and rejects changed replay. Optimistic versions prevent lost edits/status changes. UI freezes uncertain submissions for same-request retry. No journal, balance, reservation or stock ownership changes occur in this phase.

## User interface and API

Production navigation, searchable paginated table and status-grouped Kanban for the current page. Status/date/machine/customer filters, create/edit draft, selectable BOM/packing revisions, packing overrides, requirement detail, problem marker and status confirmation. Audit detail exposes previous/current order snapshots. Existing login and role editor are reused.

API prefix: `/api/companies/:companyId/production-orders`.
- GET collection, `/:id`, `/:id/history`.
- GET `/defaults/:productId` for authorized planners.
- POST collection, `/:id/status`, `/:id/problem`.
- PATCH `/:id` for draft editing with version.

## Verification status

Targeted API tests cover idempotency, decimal needs, snapshots, transitions, draft completeness, packing overrides, audit, permissions, company boundaries and forbidden direct database mutations. Real PostgreSQL concurrency test covers simultaneous creation and stale competing edits. Browser tests cover read-only isolation, defaults, uncertain retry, needs and confirmed planning on desktop/tablet/mobile. Results will be recorded after execution; missing gates are not PASS.

`scripts/verify-production-orders.cjs` is a read-only hosted operator helper with hidden local credentials, sanitized output and session cleanup. It creates no business fixtures. If no order exists, preserve `PRODUCTION_ORDER_EXISTING_RECORD: NOT_RUN` and do not claim hosted detail/write verification.

## Release and cost boundaries

No new services, dependencies, runners, resource increases, secrets or paid features. Existing public repository standard CI is free; no Railway deployment from the working branch. Main push requires its own economic assessment/approval because normal Railway usage cannot currently be bounded within 1 DKK. Hosted migration and release have not yet been performed for Phase 10.

## Deferred

Material issue (Phase 11), production registration, returns/reconciliation, finished stock release, reservations, pallets/QR, capacity scheduling and forecasting. No Phase 11 work is started. Hosted photos stay disabled.
