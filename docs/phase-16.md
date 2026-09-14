# Phase 16 — QR labels and scanning

Status: Phase 16 complete. Implementation and automated verification are complete, based on verified main `450602e`; main publication is verified at `94f3789479e67247287c53fd302007716bbabf60`. The operator has now reported `PHYSICAL_QR_CAMERA_SCAN: PASS`; see final acceptance below. Earlier progress entries are historical evidence, not outstanding camera-test requirements. Phase 17 is not authorized. Photos remain disabled hosted.

## Implementation and boundaries

- QR PNG labels for individual pallets, locations, production orders and machines; generated locally with pinned MIT `qrcode` 1.5.4. No QR service, upload, bucket or database migration.
- Versioned payload `lager:v1:<company UUID>:<pallet|location|order|machine>:<object UUID>`. No credentials, mutable quantities, business names, URL redirects or commands. UUID references are not secrets or authorization.
- Keyboard/scanner input and explicit opt-in camera scanning with pinned MIT `qr-scanner` 1.4.2. Worker is included by Vite, without a runtime CDN. Camera needs HTTPS or localhost and user permission. It stops after a result, on navigation/unmount, or when the page becomes hidden. No image is sent to any server or stored.
- Strict length/type/UUID/version/company validation before authenticated lookup. Existing NestJS endpoints and tenant guards remain authoritative. No new backend route or database grant is necessary. Nonmembers and revoked sessions cannot obtain access by possessing a label.
- The Scan QR page opens existing detail workflows after lookup. Company changes clear the scan result. Location selectors can accept a location code; inactive/non-storage/excluded placements are rejected as appropriate, with final backend validation retained.
- Scanning only selects a reference. Existing movement confirmation, idempotency and inventory protections remain unchanged. No automatic stock write, reservation or shipment workflow.
- Labels can be downloaded as PNG. Phone system-camera URL opening is not provided: use the app's Scan QR action or a keyboard scanner. Physical label/printer and real device camera acceptance require operator testing; no printer service is added.

## Verification

Local `npm run check`: 200 tests PASS, 11 existing PostgreSQL concurrency tests skipped locally (no local PostgreSQL connection); typecheck and builds PASS. Eight new parser tests cover four entity types, foreign company, wrong type, untrusted URL/traversal/version/length and scanner whitespace. Browser checks cover denial without requests, existing machine navigation, local QR rendering, company reset and denied camera fallback. Browser execution status is recorded below when available. No already-verified hosted business writes are repeated.

## References

- https://github.com/soldair/node-qrcode — local browser PNG generation.
- https://github.com/nimiq/qr-scanner — worker fallback, camera start/destroy and options.

## Release boundary

Working-branch CI uses the existing standard ubuntu-latest workflow in the verified public repository (expected 0 DKK), without Railway main deployment. Main push is separate: prior expected incremental Railway cost 0–0.30 DKK, realistic worst-case 1–3 DKK one-off depending on build duration/deployment overlap/included usage; needs approval if not confidently bounded at 1 DKK. No service, environment, compute, replica, spend limit or photo setting changes.


## CI evidence

Initial working-branch CI `34879507099` on `bdef4eb8d889b8de247b217cd2f38b691e0925e2` succeeded: 200 unit/API/helper tests, 11 real PostgreSQL concurrency tests, 150 browser tests and existing container diagnostics passed. Local Chromium installation failed due to download/network errors; no locally executed browser PASS is claimed.

Follow-up revision `aba95c2310b9bb82dc7bbaf7e71af37fe893f7e9` adds genuine image decode round-trip, camera track-release and location selector tests. It also ensures a previous QR image is not rendered under a changed reference, and older asynchronous location scans cannot override a later manual/scan choice. Its final CI status follows below.

## Operator acceptance after approved publication

Use the existing local frontend with the existing backend. In a company with authorized existing records, open a machine/location/order/pallet and select Vis QR. Download or display the PNG, then use Scan QR with a keyboard scanner or the camera. Confirm the matching record opens. For a pallet move, scan a destination in the existing location selector, review and explicitly confirm only an intended business move. Do not create hosted fixtures or perform inventory writes just to pass a read-only test. A camera must be tested on a real permitted HTTPS/localhost device; the CI canvas stream does not substitute for hardware acceptance. References from another company and arbitrary web URLs must be rejected without lookup.

No new online API route exists in this phase. Existing backend authentication and tenancy are reused; photos stay disabled. Neither main publication nor real camera hardware acceptance is claimed here. Phase 17 has not started.


CI `34879822859`, job `104096046002`, revision `aba95c2310b9bb82dc7bbaf7e71af37fe893f7e9`: SUCCESS. All 200 unit/API/helper tests, 11 PostgreSQL concurrency tests and 159 browser tests passed, including 18 QR tests across desktop/tablet/mobile. QR PNG decode round-trip uses the real decoder; camera lifecycle uses a local canvas media stream. Existing build/runtime/TLS diagnostics also passed. A cache-save collision after successful tests did not affect the job result.

Final camera-panel cleanup change explicitly stops scanning when a containing details panel closes; the selector test now verifies track release on collapse before proceeding with scan validation. No business behavior or API contracts were changed by this cleanup.


## Final automated verification — 2026-09-14

CI [34880414365](https://github.com/kristoffermvplast/Lagerstyring/actions/runs/34880414365), job `104098030176`, commit `e3ad8301adef1fa07aae874aa7a6050ad63b87c4`, tree `8d5975742c06b464aadcf0097d7d706225cb97e5`: SUCCESS. 200 unit/API/helper tests, all 11 real PostgreSQL concurrency tests and all 159 desktop/tablet/mobile browser tests PASS. This includes camera release both on navigation and scan-panel collapse, real QR image decoding, permissions, company boundaries and selector integration. Builds and existing runtime/TLS diagnostics PASS. Only documentation follows this verified implementation.

No migrations were created or applied, no hosted business fixtures were created, and no main push/manual deployment/resource or photo-setting change was performed. Main publication remains subject to the documented economic approval. Actual camera/physical scanner/printer acceptance is not claimed by simulated device profiles. Phase 17 has not started.


## Approved publication and online probes — 2026-09-14

Main was advanced without force to exactly the user-approved `94f3789479e67247287c53fd302007716bbabf60` and the GitHub ref was read back successfully. Only the normal automatic workflow/deployment is authorized; no manual deployment, migration or resource change was performed.

Read-only online results: `/api/health/live` HTTP 200; `/api/health/ready` HTTP 200; anonymous detail GETs for handling-units, locations, production-orders and masterdata/machines each HTTP 401. These reuse existing routes and therefore do not prove the active deployment revision. Railway tools are unavailable here. Operator can safely check `node -e 'console.log(process.env.RAILWAY_GIT_COMMIT_SHA || "COMMIT_UNAVAILABLE")'` in the Railway container and compare with the approved SHA. No secret is printed.

Previously successful CI `34880414365` remains the automated evidence for the identical implementation; it was not manually rerun. No live authenticated QR lookup or physical-device result is claimed. These require the operator's local login and existing authorized records; credentials must not be shared.

### Physical acceptance on the existing Mac setup

1. Update the existing local main with fast-forward only, run `npm ci`, then `npm run dev` using the existing local environment configuration. Do not overwrite env files. Open http://localhost:5173 in Chrome and log in. If the existing setup is missing configuration, complete that setup before testing.
2. Open an existing authorized machine/location/order/pallet and choose Vis QR. Download the PNG and display it on another screen or existing printed label. Do not create fixtures solely for this check. If no record exists, report NOT_RUN.
3. Open Scan QR, choose Start kamera, allow camera, and scan that image. Confirm matching identity and Åbn registrering. Confirm camera stops after recognition, navigation and closing any expanded scan panel. Images stay local.
4. For a keyboard scanner, focus Scan QR and scan the same label. Verify the same record opens with no automatic stock change. Without physical scanner hardware, report that hardware check NOT_RUN.
5. With an existing pallet and a destination label, verify destination scanning selects the intended location. Do not confirm an actual inventory move unless it is intended business work. This read-only acceptance does not require stock writes.

Photos remain disabled hosted. Verification is complete as far as the current available tools and nonphysical tests permit; active deployment and operator/device acceptance are outstanding and are not marked PASS. Phase 17 has not started.


## Final operator acceptance — 2026-09-14

Operator-reported result: `PHYSICAL_QR_CAMERA_SCAN: PASS`.

- The QR code could be displayed and scanned with a physical camera.
- The system found the correct record.
- Scanning alone triggered no automatic inventory or other data change.

This closes the outstanding basic physical-camera acceptance and completes Phase 16 together with the recorded automated and public online verification. No previously passed tests were rerun. The report is operator evidence; no credentials or camera images were collected.

Coverage limits remain explicit: physical keyboard-scanner and printer checks are NOT_RUN. The operator report does not independently establish camera release on every lifecycle event, every entity/device combination, or an actual inventory move. Recorded automated tests remain the evidence for those covered scenarios; no hosted fixtures or business writes were added for acceptance. No new claim about Railway commit inspection is inferred from a successful scan.

This closure changes documentation only. No push, migration, deployment, resource change or photo-setting change is performed as part of closure. Photos remain disabled hosted. Phase 17 has not started.
