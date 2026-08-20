CREATE TABLE control.apple_app_registrations (
  tenant_id control.identifier NOT NULL,
  app_id control.identifier NOT NULL,
  apple_app_adam_id bigint NOT NULL CHECK (apple_app_adam_id > 0),
  apple_bundle_id text CHECK (
    apple_bundle_id IS NULL OR apple_bundle_id ~ '^[A-Za-z0-9][A-Za-z0-9.-]{2,254}$'
  ),
  registered_at control.canonical_timestamp NOT NULL,
  artifact jsonb NOT NULL,
  PRIMARY KEY (tenant_id, app_id),
  UNIQUE (apple_app_adam_id),
  FOREIGN KEY (tenant_id, app_id) REFERENCES control.apps (tenant_id, app_id)
);

CREATE TABLE control.conversion_schemas (
  conversion_schema_id control.identifier PRIMARY KEY,
  tenant_id control.identifier NOT NULL,
  app_id control.identifier NOT NULL,
  schema_version text NOT NULL CHECK (schema_version ~ '^[0-9]+\.[0-9]+\.[0-9]+$'),
  schema_digest text NOT NULL CHECK (schema_digest ~ '^[a-f0-9]{64}$'),
  definition jsonb NOT NULL,
  created_at control.canonical_timestamp NOT NULL,
  artifact jsonb NOT NULL,
  UNIQUE (tenant_id, app_id, schema_version),
  UNIQUE (tenant_id, app_id, conversion_schema_id),
  FOREIGN KEY (tenant_id, app_id) REFERENCES control.apps (tenant_id, app_id)
);

CREATE TABLE control.conversion_schema_states (
  conversion_schema_state_seq bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  conversion_schema_id control.identifier NOT NULL,
  tenant_id control.identifier NOT NULL,
  app_id control.identifier NOT NULL,
  status text NOT NULL CHECK (status IN ('active', 'retired')),
  changed_at control.canonical_timestamp NOT NULL,
  artifact jsonb NOT NULL,
  FOREIGN KEY (tenant_id, app_id) REFERENCES control.apps (tenant_id, app_id),
  FOREIGN KEY (tenant_id, app_id, conversion_schema_id)
    REFERENCES control.conversion_schemas (tenant_id, app_id, conversion_schema_id)
);

CREATE VIEW control.conversion_schemas_current
WITH (security_invoker = true)
AS
SELECT DISTINCT ON (schema.conversion_schema_id)
  schema.*, state.status, state.changed_at AS status_changed_at
FROM control.conversion_schemas AS schema
JOIN control.conversion_schema_states AS state
  USING (conversion_schema_id, tenant_id, app_id)
ORDER BY schema.conversion_schema_id, state.conversion_schema_state_seq DESC;

CREATE TABLE ephemeral.adservices_lookups (
  lookup_id uuid PRIMARY KEY,
  tenant_id control.identifier NOT NULL,
  app_id control.identifier NOT NULL,
  install_record_id control.identifier NOT NULL,
  token_ref text NOT NULL,
  token_created_at timestamptz NOT NULL,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 3),
  next_attempt_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL,
  artifact jsonb NOT NULL,
  UNIQUE (tenant_id, app_id, install_record_id),
  FOREIGN KEY (tenant_id, app_id) REFERENCES control.apps (tenant_id, app_id),
  FOREIGN KEY (tenant_id, app_id, install_record_id)
    REFERENCES ledger.raw_records (tenant_id, app_id, record_id)
);

-- Unregistered Apple application identifiers do not have a tenant scope. Keep a
-- deployment-scoped, digest-only audit trail instead of inventing a tenant or
-- retaining the raw ADAM ID. The application role can insert but cannot read it.
CREATE TABLE control.public_postback_audits (
  public_postback_audit_id uuid PRIMARY KEY,
  occurred_at control.canonical_timestamp NOT NULL,
  postback_kind text NOT NULL CHECK (postback_kind IN ('skadnetwork', 'adattributionkit')),
  action text NOT NULL CHECK (action = 'postback_receive'),
  outcome text NOT NULL CHECK (outcome = 'ignored'),
  reason_code text NOT NULL CHECK (reason_code = 'apple_app_not_registered'),
  adam_id_digest text NOT NULL CHECK (adam_id_digest ~ '^[a-f0-9]{64}$'),
  request_digest text NOT NULL CHECK (request_digest ~ '^[a-f0-9]{64}$'),
  artifact jsonb NOT NULL
);

ALTER TABLE control.apple_app_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE control.apple_app_registrations FORCE ROW LEVEL SECURITY;
CREATE POLICY apple_app_registrations_tenant ON control.apple_app_registrations
  USING (
    tenant_id = current_setting('open_mmp.tenant_id', true)
    OR current_user = 'openmmp_owner'
  )
  WITH CHECK (
    tenant_id = current_setting('open_mmp.tenant_id', true)
    OR current_user = 'openmmp_owner'
  );

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('control', 'conversion_schemas'),
      ('control', 'conversion_schema_states'),
      ('ephemeral', 'adservices_lookups')
    ) AS values_to_secure(table_schema, table_name)
  LOOP
    EXECUTE format('ALTER TABLE %I.%I ENABLE ROW LEVEL SECURITY', item.table_schema, item.table_name);
    EXECUTE format('ALTER TABLE %I.%I FORCE ROW LEVEL SECURITY', item.table_schema, item.table_name);
    EXECUTE format(
      'CREATE POLICY %I_tenant ON %I.%I USING (tenant_id = current_setting(''open_mmp.tenant_id'', true)) WITH CHECK (tenant_id = current_setting(''open_mmp.tenant_id'', true))',
      item.table_name,
      item.table_schema,
      item.table_name
    );
  END LOOP;
END
$$;

CREATE FUNCTION control.resolve_apple_app_adam_id(_apple_app_adam_id bigint)
RETURNS TABLE (tenant_id control.identifier, app_id control.identifier)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, control
AS $$
  SELECT registration.tenant_id, registration.app_id
  FROM control.apple_app_registrations AS registration
  WHERE registration.apple_app_adam_id = _apple_app_adam_id
$$;

CREATE FUNCTION control.list_apple_postback_tenants()
RETURNS SETOF control.identifier
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, control
AS $$
  SELECT DISTINCT registration.tenant_id
  FROM control.apple_app_registrations AS registration
  ORDER BY registration.tenant_id
$$;

DO $$
DECLARE
  item record;
BEGIN
  FOR item IN
    SELECT * FROM (VALUES
      ('control', 'apple_app_registrations'),
      ('control', 'conversion_schemas'),
      ('control', 'conversion_schema_states'),
      ('control', 'public_postback_audits')
    ) AS append_only(table_schema, table_name)
  LOOP
    EXECUTE format(
      'CREATE TRIGGER %I_append_only BEFORE UPDATE OR DELETE ON %I.%I FOR EACH ROW EXECUTE FUNCTION ledger.reject_append_only_mutation()',
      item.table_name,
      item.table_schema,
      item.table_name
    );
  END LOOP;
END
$$;

ALTER TABLE ledger.audit_logs DROP CONSTRAINT audit_logs_actor_type_check;
ALTER TABLE ledger.audit_logs ADD CONSTRAINT audit_logs_actor_type_check
  CHECK (actor_type IN (
    'admin_key', 'system_job', 'sdk_key', 'sdk_installation', 'apple_postback'
  ));
ALTER TABLE ledger.audit_logs DROP CONSTRAINT audit_logs_target_scope_check;
ALTER TABLE ledger.audit_logs ADD CONSTRAINT audit_logs_target_scope_check
  CHECK (target_scope IN (
    'tenant', 'app', 'record', 'privacy_request', 'metric_run', 'import_source',
    'admin_key', 'sdk_key', 'installation', 'tracking_link', 'ingest_batch', 'session',
    'apple_app_registration', 'conversion_schema', 'postback'
  ));

REVOKE ALL ON
  control.apple_app_registrations,
  control.conversion_schemas,
  control.conversion_schema_states,
  control.public_postback_audits,
  ephemeral.adservices_lookups
FROM PUBLIC;

-- Default privileges grant later control tables to the application and reader
-- roles. This tenant-less audit sink is intentionally write-only to the app.
REVOKE ALL ON control.public_postback_audits FROM openmmp_app, openmmp_reader;

GRANT SELECT, INSERT ON
  control.apple_app_registrations,
  control.conversion_schemas,
  control.conversion_schema_states
TO openmmp_app;

GRANT SELECT, INSERT, UPDATE, DELETE ON ephemeral.adservices_lookups TO openmmp_app;
GRANT INSERT ON control.public_postback_audits TO openmmp_app;

GRANT SELECT ON
  control.apple_app_registrations,
  control.conversion_schemas,
  control.conversion_schema_states,
  ephemeral.adservices_lookups
TO openmmp_reader;

GRANT USAGE, SELECT ON SEQUENCE control.conversion_schema_states_conversion_schema_state_seq_seq
TO openmmp_app;
GRANT SELECT ON SEQUENCE control.conversion_schema_states_conversion_schema_state_seq_seq
TO openmmp_reader;

REVOKE ALL ON FUNCTION control.resolve_apple_app_adam_id(bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control.resolve_apple_app_adam_id(bigint) TO openmmp_app;
REVOKE ALL ON FUNCTION control.list_apple_postback_tenants() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION control.list_apple_postback_tenants() TO openmmp_app;

GRANT TRUNCATE ON
  control.public_postback_audits,
  ephemeral.adservices_lookups
TO openmmp_seed;
GRANT USAGE ON SCHEMA control, ephemeral TO openmmp_seed;
