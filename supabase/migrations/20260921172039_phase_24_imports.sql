-- Bounded synchronous import jobs. No Storage bucket or external worker is needed.
BEGIN;
SET LOCAL ROLE app_owner;
CREATE TABLE app.import_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES app.companies,
 actor_id uuid NOT NULL DEFAULT app.actor_id() REFERENCES app.profiles,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 kind text NOT NULL CHECK(kind IN ('customers','suppliers','products','materials','opening_stock')),
 filename text NOT NULL CHECK(length(filename) BETWEEN 1 AND 120),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 rows jsonb NOT NULL CHECK(jsonb_typeof(rows)='array' AND jsonb_array_length(rows) BETWEEN 1 AND 100 AND octet_length(rows::text)<=65536),
 prepared jsonb NOT NULL CHECK(jsonb_typeof(prepared)='array' AND jsonb_array_length(prepared) BETWEEN 1 AND 100 AND octet_length(prepared::text)<=262144),
 UNIQUE(company_id,id)
);
CREATE TABLE app.import_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 company_id uuid NOT NULL REFERENCES app.companies,
 job_id uuid NOT NULL,
 actor_id uuid NOT NULL DEFAULT app.actor_id() REFERENCES app.profiles,
 created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 kind text NOT NULL CHECK(kind IN ('customers','suppliers','products','materials','opening_stock')),
 sha256 text NOT NULL CHECK(sha256 ~ '^[0-9a-f]{64}$'),
 result jsonb NOT NULL CHECK(jsonb_typeof(result)='array' AND jsonb_array_length(result) BETWEEN 1 AND 100),
 FOREIGN KEY(company_id,job_id) REFERENCES app.import_jobs(company_id,id),
 UNIQUE(company_id,job_id), UNIQUE(company_id,kind,sha256)
);
CREATE INDEX import_jobs_history ON app.import_jobs(company_id,created_at DESC);
CREATE INDEX import_receipts_history ON app.import_receipts(company_id,created_at DESC);
ALTER TABLE app.import_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE app.import_receipts ENABLE ROW LEVEL SECURITY;
DO $$ DECLARE t text; predicate text; BEGIN
 predicate := 'company_id=app.company_id() AND app.allowed(''masterdata.read'') AND CASE WHEN kind=''opening_stock'' THEN app.allowed(''inventory.read'') AND app.allowed(''inventory.adjust'') ELSE app.allowed(''masterdata.manage'') END';
 FOREACH t IN ARRAY ARRAY['import_jobs','import_receipts'] LOOP
  EXECUTE format('CREATE POLICY read ON app.%I FOR SELECT TO app_runtime USING (%s)',t,predicate);
  EXECUTE format('CREATE POLICY insert ON app.%I FOR INSERT TO app_runtime WITH CHECK (%s AND actor_id=app.actor_id())',t,predicate);
  EXECUTE format('REVOKE ALL ON app.%I FROM PUBLIC,anon,authenticated,app_runtime',t);
  EXECUTE format('GRANT SELECT ON app.%I TO app_runtime',t);
  EXECUTE format('CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.%I FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable()',t);
 END LOOP;
END $$;
GRANT INSERT(company_id,kind,filename,sha256,rows,prepared) ON app.import_jobs TO app_runtime;
GRANT INSERT(company_id,job_id,kind,sha256,result) ON app.import_receipts TO app_runtime;
COMMIT;
