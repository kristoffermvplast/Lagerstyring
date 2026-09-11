# Project rules

- Implement only the phase explicitly authorized by the user. Phase 4 (items, materials and packaging master data) is authorized. Do not implement Phase 5 BOM/packing or later workflows.
- React/TypeScript/Vite frontend; NestJS backend; Supabase PostgreSQL/Auth/Storage.
- All business reads and writes go through NestJS. Never introduce browser Data API writes or privileged browser credentials.
- No hardcoded business master data. Fixtures belong only in tests.
- Tenant boundaries, inventory ownership, immutable journals, decimal precision, snapshots and idempotent inventory commands are mandatory in their respective phases.
- Negative physical stock is never allowed in version 1.
- Production registration and inventory release are distinct; reservations do not change physical stock.
- Packaging has exactly one consumption owner per usage: BOM or packing.
- Migration SQL is versioned under supabase/migrations. Review before applying; never reset a hosted database.
- Keep secrets out of Git, frontend bundles, logs and test output.
- Run npm run check and npm run test:e2e for foundation changes. Keep verification evidence honest about unavailable hosted credentials.
- Read docs/architecture.md and docs/phase-1.md before extending this foundation.

- Economic boundary: 0 DKK in new/increased external charges without explicit approval. No plan/resource/limit changes, new paid services or credits. Before push/hosted migration/deploy, establish that no extra charge can result or ask approval. Use local test fixtures; never create hosted test tenants without approval.

- Work token-efficiently: continue from recorded state; do not repeat passed tests, broad repository reads or analysis without a concrete new reason. Keep progress reports concise.
