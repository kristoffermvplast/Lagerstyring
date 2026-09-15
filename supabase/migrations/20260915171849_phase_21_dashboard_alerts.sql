-- Personal, immutable acknowledgements; source data remains authoritative.
BEGIN;
SET LOCAL ROLE app_owner;
INSERT INTO app.permissions VALUES ('dashboard.read','Se dashboard og advarsler'),('dashboard.acknowledge','Kvittere egne advarsler');
CREATE TABLE app.alert_acknowledgements (
 company_id uuid NOT NULL REFERENCES app.companies,
 actor_id uuid NOT NULL DEFAULT app.actor_id() REFERENCES app.profiles,
 alert_key text NOT NULL CHECK(length(alert_key) BETWEEN 1 AND 160),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[0-9a-f]{64}$'),
 acknowledged_at timestamptz NOT NULL DEFAULT statement_timestamp(),
 PRIMARY KEY(company_id,actor_id,alert_key,fingerprint)
);
ALTER TABLE app.alert_acknowledgements ENABLE ROW LEVEL SECURITY;
CREATE POLICY read ON app.alert_acknowledgements FOR SELECT TO app_runtime
 USING(company_id=app.company_id() AND actor_id=app.actor_id() AND app.allowed('dashboard.read'));
CREATE POLICY acknowledge ON app.alert_acknowledgements FOR INSERT TO app_runtime
 WITH CHECK(company_id=app.company_id() AND actor_id=app.actor_id() AND app.allowed('dashboard.read') AND app.allowed('dashboard.acknowledge'));
REVOKE ALL ON app.alert_acknowledgements FROM PUBLIC,anon,authenticated,app_runtime;
GRANT SELECT ON app.alert_acknowledgements TO app_runtime;
GRANT INSERT(company_id,alert_key,fingerprint) ON app.alert_acknowledgements TO app_runtime;
CREATE TRIGGER immutable BEFORE UPDATE OR DELETE ON app.alert_acknowledgements FOR EACH ROW EXECUTE FUNCTION app_private.inventory_immutable();
COMMIT;
