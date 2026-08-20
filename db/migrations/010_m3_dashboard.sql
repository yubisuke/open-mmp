ALTER TABLE control.admin_keys
  DROP CONSTRAINT admin_keys_tenant_id_app_id_fkey,
  ALTER COLUMN app_id DROP NOT NULL;

ALTER TABLE control.admin_key_states
  DROP CONSTRAINT admin_key_states_tenant_id_app_id_fkey,
  ALTER COLUMN app_id DROP NOT NULL;

CREATE TABLE ephemeral.dashboard_sessions (
  session_id control.identifier PRIMARY KEY,
  tenant_id control.identifier NOT NULL,
  admin_key_id control.identifier NOT NULL REFERENCES control.admin_keys (key_id),
  token_digest text NOT NULL CHECK (token_digest ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL,
  expires_at timestamptz NOT NULL,
  CHECK (expires_at > created_at),
  UNIQUE (token_digest)
);

CREATE INDEX dashboard_sessions_expiry_idx
  ON ephemeral.dashboard_sessions (expires_at);

CREATE INDEX metric_runs_superseded_idx
  ON ledger.metric_runs (tenant_id, app_id, supersedes_metric_run_id)
  WHERE supersedes_metric_run_id IS NOT NULL;

CREATE INDEX metric_runs_dashboard_keyset_idx
  ON ledger.metric_runs (tenant_id, app_id, metric_name, grouping_digest, metric_run_id);

ALTER TABLE ephemeral.dashboard_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ephemeral.dashboard_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY dashboard_sessions_tenant ON ephemeral.dashboard_sessions
  USING (tenant_id = current_setting('open_mmp.tenant_id', true))
  WITH CHECK (tenant_id = current_setting('open_mmp.tenant_id', true));

ALTER TABLE ledger.audit_logs DROP CONSTRAINT audit_logs_target_scope_check;
ALTER TABLE ledger.audit_logs ADD CONSTRAINT audit_logs_target_scope_check
  CHECK (target_scope IN (
    'tenant', 'app', 'record', 'privacy_request', 'metric_run', 'import_source',
    'admin_key', 'sdk_key', 'installation', 'tracking_link', 'ingest_batch', 'session'
  ));

REVOKE ALL ON ephemeral.dashboard_sessions FROM PUBLIC;
GRANT SELECT, INSERT, DELETE ON ephemeral.dashboard_sessions TO openmmp_app;
GRANT USAGE ON SCHEMA ephemeral TO openmmp_reader;
GRANT SELECT ON ephemeral.dashboard_sessions TO openmmp_reader;
GRANT TRUNCATE ON ephemeral.dashboard_sessions TO openmmp_seed;
