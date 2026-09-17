# Phase 23 — Mobile and tablet usability

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

CI and physical-device acceptance are NOT_RUN. No new dependencies, migration, backend changes, infrastructure or hosted data changes. Photos remain disabled hosted. No Phase 24 work.

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
