# Phase 16 — QR labels and scanning

Status: implementation and automated verification complete on `phase16-qr`, based on verified main `450602e`. Main publication and physical-device acceptance remain pending. Phase 17 is not authorized. Photos remain disabled hosted.

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
