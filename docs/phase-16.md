# Phase 16 — QR labels and scanning

Based on verified main `450602e`. Phase 17 is not authorized. Photos remain disabled hosted.

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
