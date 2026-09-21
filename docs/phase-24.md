# Phase 24 — Import/export

## Scope and implementation

Continued from remote main `888bc2f99e8a6a36a104bc842e53ba545580917f` and local preparation `c9628d2`, on `phase24-import-export`. Phase 23's unpublished code commits are not included.

The requested five import types are implemented in NestJS and the Import workspace:

| Type | Required CSV columns | Optional CSV columns |
| --- | --- | --- |
| Customers | `code`, `name` | `address`, `contact_name`, `phone`, `email`, `notes` |
| Suppliers | `code`, `name` | contact columns above, `lead_time_days` |
| Products | `code`, `name` | `unit_code`, `customer_code`, `description`, `notes`, `color` |
| Materials | `code`, `name` | `unit_code`, `supplier_code`, `description`, `notes`, `color` |
| Opening stock | `item_code`, `owner_code`, `location_code`, `quantity` | none |

Optional `supplier_code` on a material import identifies the existing supplier; it is not the supplier's article number. Reference codes are resolved within the selected company. Existing units, owners and storage locations are prerequisites for opening stock. Products/materials can be created without a unit, but cannot receive opening stock until they have an active unit.

Order: customers/suppliers → products/materials → opening stock. Use the downloadable minimal template. Optional columns are described under a collapsed section. Upload, inspect the preview and row errors, then explicitly confirm. Invalid files cannot be confirmed. Nothing is silently skipped or overwritten. Replacing the file or company clears the preview. An uncertain confirmation can be retried against the same job ID.

## Deliberate format and size limits

- CSV UTF-8 (optional BOM), comma or semicolon delimiter; quoted separators, quotes and multiline cells supported. Header names are exact and closed; malformed columns/files are rejected.
- Excel is supported by **Save as CSV UTF-8**. Native `.xlsx`/`.xls` parsing is **not implemented**; no spreadsheet parser or paid service was added. Formula cells are never evaluated by the importer.
- At most 100 data records and 32 KiB CSV per file. Decimal quantities remain strings, with a dot and at most eight decimal places; count/package units require integers. Zero and negative opening quantities are rejected.
- This phase does not expand the supported masterdata fields to every advanced edit-screen option. Those can still be changed through existing authorized screens.
- Phase 22's existing bounded, audited report CSV exports remain the export workflow. No new external export/storage service.

## Correctness, security and traceability

- Existing masterdata schemas validate imported contacts/items. Business writes go only through NestJS and `DatabaseService.asActor` with its existing active-session, RLS and SERIALIZABLE transaction boundaries.
- Masterdata imports require `masterdata.read` + `masterdata.manage`. Opening stock additionally uses `inventory.read` + `inventory.adjust` instead of masterdata manage. No new permission codes.
- Valid preview creates an immutable import job, not business data. It stores the bounded source rows and validated/resolved values, filename, actor, time and SHA-256 of canonical kind/rows. The fingerprint describes normalized import content, not original file bytes. No raw binary uploads, Storage bucket or background worker is necessary for these bounded synchronous jobs.
- Confirmation is restricted to the preview's actor/company/type and expires after 24 hours. It revalidates all rows, rejects changed reference targets and saves all rows and the receipt in one transaction. A receipt failure rolls back business writes.
- Codes are checked case-insensitively within the file and company, including inactive records and shared product/material codes. Existing database unique indexes protect racing masterdata writes. An immutable unique receipt by company/type/content protects retries and equivalent files. Reordered CSV columns produce the same fingerprint. Concurrent conflicts require retry or a fresh preview; no automatic partial import.
- Opening stock inserts one ordinary inventory correction request through the **existing journal kernel**, which owns line/balance changes, snapshots and locks. The journal reference points to the import job. No direct writes to `stock_balances` or `inventory_lines` are added. Existing history for the item/owner/location blocks opening stock, even if its current balance is zero. New files are not an escape from that rule.
- Jobs and receipts have RLS, company foreign keys, column-specific inserts and immutable triggers. Browser roles receive no privileges. History exposes the latest 20 receipts for the authorized company/type, including actor/time, source fingerprint and row-to-created-record/journal IDs. Existing masterdata audit remains intact.
- Preview jobs are retained as audit material; expiry prevents late confirmation, not automatic deletion. No cleanup service or permanent resource increase is created.

## Migration and publication boundary

New local migration: `20260921172039_phase_24_imports.sql`, created with the installed Supabase CLI. It adds two empty tables, indexes, RLS, grants and immutable triggers. No existing business data is migrated and no old migration is rerun. Readiness now requires the two import tables.

Hosted migration, main publication and Railway deployment are **NOT_RUN**. Hosted photos remain disabled. No hosted fixture or resource change was performed. A hosted rollout must apply this phase's migration once before the new readiness check can pass.

## Verification

- TypeScript checks and API/frontend builds: PASS locally.
- Targeted import/API/database tests: **18 PASS** locally (13 import/parser/API cases and 5 migration/database cases). Browser test discovery: 9 cases found; execution still requires CI.
- Browser cases added for preview-before-write, row-error blocking, replacing files, company reset, permissions and retrying the same confirmation after a lost response. Nine cases across the existing desktop/tablet/mobile projects.
- Two real PostgreSQL concurrency cases added to the existing CI suite: same-job confirmations and distinct opening jobs racing for the same stock key.
- Local browser execution is blocked: Chromium download timed out/returned HTTP 502. No local standard PostgreSQL server is installed, so the real concurrency cases require CI. These are not represented as local passes.
- Existing CI is unchanged, on standard `ubuntu-latest`. Repository visibility was read back as public. Expected and realistic worst-case incremental external charge for this work-branch CI: **0 DKK**, based on [GitHub's standard-runner public-repository rule](https://docs.github.com/en/billing/concepts/product-billing/github-actions). No new artifact upload or cache configuration was introduced.
- CI status pending work-branch publication; no Phase 24 completion/hosted sign-off is claimed yet.

## Preserved boundaries

Phase 23 access-500 remains `NOT_REPRODUCED`; do not investigate without a concrete `ACCESS_FAILURE:`. Physical tablet remains `NOT_RUN`, and the previous physical QR verification remains reused.

Deferred final UI/UX requirements remain: fewer mandatory fields, essential fields visible by default, secondary/advanced fields hidden or optional where safe, simpler creation flows and navigation, lower information density. No broad redesign in this phase.

Phase 25 is not authorized and has not started.
