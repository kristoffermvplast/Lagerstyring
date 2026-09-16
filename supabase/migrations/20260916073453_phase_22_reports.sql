-- Phase 22: reporting permissions and immutable generation receipts only.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('reports.read','Se rapporter'),('reports.export','Eksportere rapporter');
CREATE TABLE app.report_exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES app.companies,
 actor_id uuid NOT NULL DEFAULT app.actor_id() REFERENCES app.profiles,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 report text NOT NULL CHECK(report IN ('stock','inventory','production','consumption','waste','shipments')),
 filters jsonb NOT NULL CHECK(jsonb_typeof(filters)='object' AND octet_length(filters::text)<=5000),
 row_count integer NOT NULL CHECK(row_count BETWEEN 0 AND 2000),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX report_exports_history ON app.report_exports(company_id,actor_id,created_at DESC,id);
ALTER TABLE app.report_exports ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.report_exports FOR SELECT TO app_runtime USING(company_id=app.company_id() AND actor_id=app.actor_id() AND app.allowed('reports.read') AND app.allowed('reports.export'));
CREATE POLICY insert_receipt ON app.report_exports FOR INSERT TO app_runtime WITH CHECK(company_id=app.company_id() AND actor_id=app.actor_id() AND app.allowed('reports.read') AND app.allowed('reports.export'));
REVOKE ALL ON app.report_exports FROM PUBLIC,anon,authenticated,app_runtime;
GRANT SELECT ON app.report_exports TO app_runtime;
GRANT INSERT(company_id,report,filters,row_count,sha256) ON app.report_exports TO app_runtime;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.report_exports FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
COMMIT;
