# Phase 23 — Mobile and tablet usability

Status: **Functionally closed by operator acceptance, 2026-09-21**, within the limitations in the final acceptance below. Earlier open/blocked checkpoints are historical. Follow-up changes remain local and unpublished; this closure is not a new release verification. Phase 24 is not started.

Started from main `c7f58773a236fe19e8494596122ba6f3c92a8401`, where Phase 22 is closed. The existing approved roadmap calls this phase “Samlet mobil- og tabletoptimering” with acceptance “Centrale flows afprøvet med faktiske brugere”. Phase 24 import/export is separate and is not started. General visual redesign remains deferred.

## Functional changes

- At widths up to 1,000 CSS pixels, workspace navigation becomes a bounded scrollable grid (35% of the small viewport height), keeping the operational screen accessible without traversing the entire menu. All existing permission-filtered navigation remains available. Navigation and company changes focus the main workspace; a touch-visible return button focuses the menu.
- Form controls have at least 44px height and 16px text; fieldsets can shrink, QR images fit their container, long references wrap and preformatted content scrolls locally. Tables retain horizontal scrolling. Decimal input modes and exact quantities remain unchanged. No zoom restriction is added.
- A browser online/offline indicator describes possible stale data and uncertain command completion. Reconnection is a browser signal, not a backend health guarantee. Existing query-library read refreshes may occur, but no command queue or automatic write replay is introduced.
- The shared JSON transport makes one attempt. When the browser reports offline, it sends no business request. Network errors, truncated successful write responses and server 5xx write responses explicitly say that the command may already have committed. Users retain the existing form and its existing idempotency key/payload for manual retry. Authentication, session handling, server authorization and business command semantics are unchanged.
- QR text entry disables autocapitalization/spellcheck and labels the enter action. A failed lookup offers a manual retry of the same in-memory reference, running the same permission and response checks again. No automatic stock action or new image upload. Existing camera stop/cleanup on page hiding, navigation and details collapse remains in place.

## Verification checkpoint

Local results: 10 new transport tests PASS; frontend typecheck PASS; frontend production build PASS; diff whitespace check PASS. Transport tests cover offline suppression, single attempt, unchanged command/signal, safe read errors, uncertain committed-write responses, non-echoed provider errors, existing HTTP status handling and exact decimal strings.

Added four browser cases across desktop/tablet/mobile (12 new executions). They cover bounded touch navigation/focus/company switching; 320px portrait and 844px landscape form sizing/overflow/decimal input; a simulated committed receipt with a lost response followed by exact manual retry and no reconnect-triggered write; and QR lookup retry without rescanning. Browser collection succeeds (30 cases across the two selected files including existing QR cases). Collection is not an execution pass. Browser runtime is unavailable locally as previously established; execute in the unchanged existing CI. Full CI is justified by the shared workspace navigation/CSS and request transport change; no old suites were rerun manually.

At the initial local checkpoint, CI and physical-device acceptance were NOT_RUN; the subsequent CI result is recorded below. Physical-device acceptance remains NOT_RUN. No new dependencies, migration, backend changes, infrastructure or hosted data changes. Photos remain disabled hosted. No Phase 24 work.

## Actual-user acceptance — required before closure

Use the verified Phase 23 frontend build in an authorized environment. Record date, frontend commit/build, device/OS/browser and user role. Use a phone and tablet, portrait and landscape, with actual intended users. Browser emulation does not replace these observations.

1. Navigate to stock, receiving, production, shipments and reports using the user's permitted areas. Change company and confirm the previous company's work is gone. Check menu reachability, focus, touch targets, table scrolling and operation with the software keyboard open.
2. Enter a precise decimal quantity in an authorized test workflow. Check that comma entry and displayed units remain correct. Do not create hosted business fixtures or postings merely to test without explicit authorization; use disposable/local fixtures or a separately approved real operation.
3. Test the existing QR camera on a secure origin, keyboard scanner/manual reference entry, camera denial, wrong-company code rejection and camera cleanup when leaving/hiding the page. Failed lookup must be manually retried without a stock mutation. This is local QR scanning, not enabling hosted item photos.
4. In a disposable test environment, interrupt the response after a command commits, reconnect, then retry from the same open form. Verify one journal posting and identical idempotency key/payload. Confirm reconnect alone sends no write. Do not induce network failures on live operations without separate authorization.
5. Record PASS/FAIL and concrete obstacles per flow; remedy functional obstacles within Phase 23. Missing devices/users or an unexercised flow remains NOT_RUN. Do not claim full closure before actual-user acceptance is received.

## Publication and economic boundary

Local implementation/test/documentation: no new external service charge. Existing public GitHub CI on standard runners: expected 0 DKK, realistic worst-case 0 DKK, unchanged workflow/resources. The earlier automatic approval review required explicit authorization to publish newly implemented phase content to the public repository; any new rejection must be reported rather than bypassed.

Do not update main or deploy while only preparing the working branch. Main publication may cause an automatic Railway build/start and container overlap: previously documented expected 0–0.30 DKK / realistic worst-case 1–3 DKK on unchanged resources. Stop for separate acceptance before that action. No manual deployments, new environment, paid service, resource/limit change or migration is needed or proposed by this implementation.

## Authorized working-branch publication and CI correction — 2026-09-17

The user authorized publication of `1ab3c4a` to a Phase 23 working branch and the unchanged existing CI on standard GitHub runners, accepting expected/worst-case new charges of 0 DKK. No main update, deployment, hosted migration or resource changes were authorized.

Published branch `phase23-mobile`, initial GitHub commit `c0d2344a25f1ec73f3c99a843cf9f958faa398a8`, tree `95ae685acccce390ac05af322fe343ae4c7075ac`, exactly matches local implementation `1ab3c4a1857be16b2f1c61495b19de34e852dba4` and is based on main `c7f58773a236fe19e8494596122ba6f3c92a8401`.

First CI run `35230067737` passed 273 unit/API/database/helper tests, 19 real PostgreSQL concurrency tests, typechecks/builds and 221 browser tests. One existing mobile browser assertion failed: the role selector in the access table measured 80px instead of the required minimum 170px. The new general control sizing had overridden the existing table-specific minimum width. Runtime-image/TLS steps were skipped after that browser failure and are not claimed passed on this initial commit.

A targeted CSS correction restores a 170px minimum for role selectors inside the horizontally scrollable access table. No behavior, permissions or other code was changed. Local fix `a41f8afce0177490ecf53cffc4117f5836b6a695` was published on the same working branch as `dd487fab5471a05660218e745be912daedd57c8c`; tree `ceb4e2c6ae085c37d90d4146a8f77df68e9e4096` matches exactly. Existing CI run `35230954142` verifies the correction. This repeat is specifically justified by the failing mobile regression, not an optional rerun of old tests.

The first correction did not resolve the regression: run `35230954142` again passed 273 tests, 19 PostgreSQL concurrency tests and 221 browser tests, but the same role-selector width assertion failed. The general `:is(...)` selector inherited the specificity of two attribute exclusions, exceeding the attempted override. Runtime/TLS steps were again skipped. The final targeted correction removes `min-width:0` from the general control rule and removes the ineffective override, preserving the pre-existing table-specific 170px minimum. Local commit `6798fec405139cb7a8dd294cb7a03b9e5f79b261` matches working-branch commit `35fe05d80e4675f8cb787eadcba901e97ec6092c` exactly at tree `1b97a9468a33e305302000eb1c899e151339d5ae`. Run `35231833769` checks this correction using the unchanged workflow.


## Final working-branch CI result — 2026-09-17

[CI run 35231833769](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/35231833769) completed SUCCESS on `35fe05d80e4675f8cb787eadcba901e97ec6092c` (`phase23-mobile`). Verified results:

- 273 unit/API/database/helper tests pass (55 suites).
- 19 real PostgreSQL concurrency tests pass in their dedicated step; their skips in the general test step are intentional.
- All 222 browser tests pass, including the formerly failing mobile role-selector assertion and all 12 new Phase 23 executions.
- Typechecks, builds, backend runtime-image build, diagnostic loading without secrets and strict TLS/CA materialization pass.

`PHASE_23_CI_VERIFICATION: PASS`

Remote main was read back as `c7f58773a236fe19e8494596122ba6f3c92a8401`, unchanged. No main update, Railway deployment, hosted migration, resource change or photo-setting change was performed. Photos remain disabled hosted. The CI workflow and standard runners were unchanged, within the authorized expected/worst-case new external charge of 0 DKK.

`PHASE_23_ACTUAL_USER_ACCEPTANCE: NOT_RUN`

Working-branch implementation and automated verification are complete. Full Phase 23 closure remains pending publication/authorized frontend availability and the actual-user phone/tablet checklist above. CI browser emulation does not establish real-device usability, real camera/scanner operation or actual-user sign-off. No hosted writes or new fixtures were created. Before any main publication that may trigger Railway, obtain the required separate approval under the existing cost rule; no such publication is included in this CI-only authorization. Phase 24 is not started.


## Authorized main release and hosted checkpoint — 2026-09-18

User approved publishing exactly `35fe05d` to main and its normal automatic Railway deployment on unchanged resources, accepting expected 0–0.30 DKK and realistic worst-case 1–3 DKK. GitHub main was fast-forwarded without force and read back as `35fe05d80e4675f8cb787eadcba901e97ec6092c`. No documentation-only commit was included in this publication.

Railway connection confirms automatic deployment `1c41255e-bcd7-40dd-bef4-407b33448d6f`, branch main, exact commit above, SUCCESS at 2026-09-18T18:05:24Z. Existing repository/branch and `apps/api/Dockerfile` remain configured, with one replica. No manual deployment, migration, service/environment, resource or variable change was performed. `ITEM_PHOTOS_ENABLED` is absent from service configuration; the unchanged application default is false, so hosted photos remain disabled.

Targeted online requests to the existing Railway origin returned:

- `/api/health/live`: 200.
- `/api/health/ready`: 200, `{"status":"ready"}`.
- `/api/me` without authentication: 401.
- `/`: 404, consistent with an API-only service.

`PHASE_23_BACKEND_RELEASE_CHECK: PASS`

`PHASE_23_HOSTED_FRONTEND_VERIFICATION: BLOCKED (no verified deployed frontend URL)`

The Railway project lists only the existing API service. Its Dockerfile builds/copies only the backend, not the Phase 23 React frontend. Thus deployment success does not establish that mobile changes are available online. No existing hosted frontend URL was found in the targeted release documentation. Authenticated frontend/session, connectivity notices, QR retry and real-device flows were not exercised online. Existing CI evidence remains valid and was not rerun manually. Full Phase 23 online verification and actual-user acceptance remain pending; do not record overall PASS or closure.

### Short phone/tablet checklist once the verified frontend is available

1. Open the supplied HTTPS frontend URL on a real phone and tablet; record device, browser, date, user and build `35fe05d`.
2. Log in. Open permitted stock, receiving, production, shipments and reports screens. Reach every menu item and use “Gå til menu”.
3. Rotate portrait/landscape. Open the keyboard and enter a decimal in a form without submitting; check labels, units and buttons. Scroll wide tables inside their container.
4. If authorized for two companies, switch company and confirm the previous company's content disappears.
5. Scan an existing QR, inspect the correct record and leave the scanner; confirm the camera stops. A failed read can be retried manually without a stock action. No item-photo upload is enabled.
6. With no transaction being submitted, disable connectivity and check the offline notice; reconnect and check the notice updates. Do not provoke uncertain live postings or submit test business data.
7. Log out. Report PASS/FAIL/NOT_RUN per step and device. Production writes/lost-response retries require a disposable setup or a separately approved real operation; CI already covers simulated retries.

The subsequent local HTTPS checkpoint below supersedes the frontend-URL request. No public frontend hosting was created. No Phase 24 work.


## Local HTTPS and real iPhone checkpoint — 2026-09-21

User-authorized local mkcert HTTPS on their Mac provides the existing Vite frontend over the same Wi-Fi, proxying API requests to the local backend. The iPhone trusts the local CA; no private key was shared. Public frontend auth settings were configured locally. No hosted settings, deployments, migrations or resources were changed in this checkpoint. Hosted photos remain disabled. Local setup has no new external service charge.

User-reported checks on iPhone (base code `35fe05d`, followed by the CSS correction below):

- Login, company selection, stock, production and shipments screens work.
- Receiving loads; landscape and form access with the keyboard open work. Decimal input was exercised without saving.
- Reports search for `test123` returns zero rows without error on Mac and iPhone. A zero-row result alone does not prove matching against populated data.
- QR camera starts with permission and its indicator disappears after leaving for Stock. Actual QR lookup NOT_RUN: no existing code available; no fixture created.
- Logout returns to the login screen.
- Tablet NOT_RUN, explicitly deferred by user because no tablet is available. Company-switch isolation and offline/reconnect checks are not established by this manual session.

### Functional field visibility correction

Inputs outside access cards lacked visible borders/backgrounds. This made the reports search and exact-ID fields difficult to distinguish. The existing general content-control CSS rule now gives text inputs, selects and textareas block layout, border, white background, padding and bottom spacing, preserving existing minimum widths and excluding checkbox/radio inputs.

The user applied exactly this rule locally with a timestamped CSS backup. They confirmed visible reports search/ID fields, successful empty-result search, visible receiving search, and reachable receiving form controls with the iPhone keyboard open. The receiving form was closed without saving. The same rule is now recorded in this repository. This is functional visibility work, not a broader visual redesign. Earlier CI results predate this correction; no new CI PASS is claimed.

### Unresolved intermittent error

A generic failure initially appeared during reports testing. Subsequent Chrome Network evidence showed report requests `stock?q=test123&page=1` and `stock?q=test1234&page=1` succeeding with 200, while separate `access` requests intermittently returned 500 after approximately 10 seconds. The failure affected Mac as well as iPhone. It cannot currently be attributed to the report filter or mobile browser.

A temporary local backend launcher logs only sanitized PostgreSQL query error codes, not SQL, credentials or data. No such error was logged during the observed access failure; this does not exclude connection acquisition, auth, proxy or other errors. The failed response body was unavailable in Chrome. Later refreshes/access and report searches succeeded; no root cause or permanent fix has been established. The diagnostic launcher modifies only that running process, not repository files.

“Gå til menu” remained unclear to the user while the menu was already visible; actual return-navigation usability remains open. The intermittent access error also remains open. Phase 23 is NOT closed. No Phase 24 work, business-data writes or hosted fixtures were performed in this manual test.

## Focused follow-up after `5edfb62` — 2026-09-21

- QR evidence corrected: Phase 16 final operator acceptance (2026-09-14) explicitly records `PHYSICAL_QR_CAMERA_SCAN: PASS`, correct-record lookup and no automatic stock mutation. Reuse this existing basic physical lookup evidence together with the current iPhone camera start/navigation-stop checks. No repeat basic scan is required merely because no label is available today. A fresh end-to-end lookup on the current Phase 23 build is NOT_RUN; do not mislabel the old acceptance as a new device/build test.
- Actual tablet hardware remains `NOT_RUN` by user decision. Browser viewport emulation is supplementary and cannot certify physical tablet Safari/camera/keyboard behavior.
- “Gå til menu” previously only focused the containing aside, potentially leaving its internal scroll position at the bottom and producing no clear visual return. It now resets the menu's internal scroll, focuses it without implicit scrolling, and explicitly scrolls the page to its start. No navigation redesign or business behavior change.
- Access failure diagnosis: the existing PostgreSQL query-only monkey patch cannot see pool acquisition errors or exceptions outside queries. The API exception filter now emits an `ACCESS_FAILURE` diagnostic only for failed GET company-access requests (5xx). It logs only the server-generated request ID, response status and a fixed error category; no URLs, company/user identifiers, SQL, raw exception text or credentials. Response status/body and auth/tenancy checks are unchanged. This is diagnostic coverage, NOT a claimed fix for the observed intermittent failure. Evidence from a new failing request on the user's Mac is still required before choosing a root-cause correction.
- No push, hosted deployment, migration, resource adjustment or photo-setting change. Local preparation/testing incurs no new external service charge. Phase 23 remains open pending access diagnosis and appropriate verification; Phase 24 is not started.

### Deferred final UI/UX requirements (user request)

After the functional phases, simplify creation of customers, items, orders and similar records as one coordinated UI/UX effort. Require substantially fewer manually entered details; show only essential fields by default. Hide advanced/secondary fields or make them optional wherever business correctness permits. Reduce information density and make workflows more intuitive. Preserve necessary validation, security and auditability. This requirement is recorded now, not implemented as part of Phase 23.

Validation for this follow-up: both workspace typechecks PASS; 2 targeted diagnostic classification/privacy tests PASS. The 4 selected mobile/tablet navigation/form browser cases could not start because the available local Chromium executable returned EACCES. No browser PASS is claimed for these changes. Existing prior CI evidence is not rerun or reclassified. The new log/menu changes are not yet installed on the user's Mac or published.

### Operator follow-up on local Mac/iPhone — 2026-09-21

The operator installed the exact menu-handler replacement locally with a timestamped backup and confirmed on iPhone that “Gå til menu” returns to the beginning of the menu with the company selector visible. `PHASE_23_IPHONE_MENU_RETURN: PASS` (operator evidence). This closes the specific menu-return usability issue; it does not change the blocked automated browser-run result above.

The Mac backend was restarted with a temporary exception-filter diagnostic wrapper, covering access failures outside PostgreSQL queries as well. A page reload and a browser-tab return both completed without a reported error or `ACCESS_FAILURE` line. These limited successful attempts do not establish the root cause or resolution of the earlier intermittent 500. Repetitive attempts were stopped; the local diagnostic process was left running to capture a recurrence. No speculative timeout, retry, authentication or database changes were made.

The menu and field fixes are locally applied on the user's Mac and recorded in this repository, but not published. Phase 23 remains open solely with respect to unresolved requirements/verification, especially the intermittent access error; actual tablet hardware remains NOT_RUN. Prior Phase 16 physical QR lookup evidence is reused as documented above. No Phase 24 work.


## Final operator acceptance — 2026-09-21

The operator reports normal use without recurrence of the intermittent company-access HTTP 500 and explicitly authorizes closing Phase 23 on that basis.

`PHASE_23_ACCESS_500: NOT_REPRODUCED`

Existing diagnostic coverage is retained. This status means the previously observed failure was not reproduced during the operator's subsequent normal use; it does not assert a root cause, a permanent correction, or that recurrence is impossible. No duration or request count was supplied. Do not continue broad investigation or repeated reproduction attempts without a concrete new `ACCESS_FAILURE:` result; investigate only that event if supplied.

`PHASE_23_FUNCTIONAL_ACCEPTANCE: CLOSED (operator-approved scope)`

Acceptance combines the recorded CI for `35fe05d`, local follow-up typechecks and two diagnostic tests, and operator checks on Mac/iPhone. The field-visibility and menu-return fixes are confirmed on the real iPhone, including receiving-form access with the keyboard open. Login/company selection, the recorded page reads, empty-result report search, camera start/stop and logout were exercised as described above. Phase 16's documented successful physical QR lookup is reused; no duplicate physical lookup is required for this closure.

Explicit coverage limits:

- `PHASE_23_PHYSICAL_TABLET: NOT_RUN` — no tablet available, deferred by operator. Earlier browser emulation is not physical-device acceptance.
- `PHASE_23_CURRENT_BUILD_PHYSICAL_QR_LOOKUP: NOT_RUN` — basic physical lookup is covered by reused Phase 16 evidence, with current iPhone camera lifecycle checks.
- Follow-up automated navigation/form browser execution was blocked by local Chromium EACCES; the real iPhone menu/form checks are the available follow-up evidence. No new CI/browser PASS is claimed.
- No additional manual company-isolation, offline/reconnect or live-write checks are claimed beyond the evidence already recorded. Existing automated coverage remains separately identified.

The local follow-up commits `5edfb62`, `75a2636` and `300d0ad` contain the field/menu corrections, bounded diagnostics and acceptance documentation. They have not been pushed or deployed. Closing the phase does not imply these follow-ups are present on remote main/Railway. This final step changes documentation only; no tests rerun, migration, public hosting, deployment, resource change or external charge. Photos remain disabled hosted. The deferred final UI/UX simplification requirements above remain recorded for after the functional phases. Phase 24 is not started and work stops here.
