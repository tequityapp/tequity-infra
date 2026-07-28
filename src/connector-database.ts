import * as k8s from '@pulumi/kubernetes';
import type { Settings } from './config';

export const CONNECTOR_DATABASE = Object.freeze({
  roleName: 'tequity_connector',
  database: 'tequity',
  host: 'postgres',
  port: 5432,
  secretName: 'tequity-connector-database',
  vaultPath: 'tequity/connector-database',
  adminSecretName: 'postgres',
  adminSecretKey: 'postgres-password',
  reconcileSchedule: '*/5 * * * *',
  externalSecretRefreshInterval: '5m',
  // Multi-architecture manifest digest verified from Docker Hub. A mutable tag
  // alone is not acceptable for a privileged database bootstrap workload.
  clientImage:
    'postgres:17.2-alpine3.21@sha256:7e5df973a74872482e320dcbdeb055e178d6f42de0558b083892c50cda833c96',
});

/**
 * Idempotent reconciliation for the connector-only runtime role.
 *
 * The password enters psql only through CONNECTOR_DATABASE_PASSWORD and
 * \getenv; it is never a command argument, ConfigMap value, or Pulumi input.
 * DDL/migrations remain owned by the admin connection. This script only
 * reconciles the login role and the exact runtime grants the connector needs.
 */
export const connectorRoleSql = String.raw`\set ON_ERROR_STOP on
\getenv connector_password CONNECTOR_DATABASE_PASSWORD

begin;

select 'create role tequity_connector'
where not exists (select 1 from pg_roles where rolname = 'tequity_connector')
\gexec

alter role tequity_connector with
  login
  nosuperuser
  nobypassrls
  nocreatedb
  nocreaterole
  noinherit
  noreplication
  password :'connector_password';

do $$
declare
  parent_role record;
begin
  for parent_role in
    select parent.rolname
    from pg_auth_members membership
    join pg_roles member on member.oid = membership.member
    join pg_roles parent on parent.oid = membership.roleid
    where member.rolname = 'tequity_connector'
  loop
    execute format('revoke %I from tequity_connector', parent_role.rolname);
  end loop;
end
$$;

select format(
  'revoke all privileges on database %I from tequity_connector',
  current_database()
)
\gexec
select format(
  'grant connect on database %I to tequity_connector',
  current_database()
)
\gexec

revoke all privileges on schema public from tequity_connector;
revoke all privileges on all tables in schema public from tequity_connector;
revoke all privileges on all sequences in schema public from tequity_connector;
revoke all privileges on all functions in schema public from tequity_connector;

-- PostgreSQL's PUBLIC pseudo-role is inherited by every login and cannot be
-- denied for one role. Remove its default paths before granting the connector
-- allowlist; object owners retain their implicit privileges.
select format('revoke all privileges on database %I from public', current_database())
\gexec
revoke all privileges on schema public from public;
revoke all privileges on all tables in schema public from public;
revoke all privileges on all sequences in schema public from public;
revoke all privileges on all functions in schema public from public;

-- Remove any historical column-level grants, which table-level REVOKE does not
-- necessarily clear.
do $$
declare
  column_record record;
begin
  for column_record in
    select table_schema, table_name, column_name
    from information_schema.columns
    where table_schema = 'public'
  loop
    execute format(
      'revoke select (%1$I), insert (%1$I), update (%1$I), references (%1$I) on table %2$I.%3$I from tequity_connector, public',
      column_record.column_name,
      column_record.table_schema,
      column_record.table_name
    );
  end loop;
end
$$;

grant usage on schema public to tequity_connector;

-- Pulumi can provision PostgreSQL before the worker migrations have created
-- these tables. Reconcile only existing allowlisted relations; the CronJob
-- grants them after migrations without ever broadening the allowlist.
do $$
begin
  if to_regclass('public.storage_connection') is not null then
    execute 'grant select, insert, update, delete on public.storage_connection to tequity_connector';
  end if;
  if to_regclass('public.storage_token') is not null then
    execute 'grant select, insert, update, delete on public.storage_token to tequity_connector';
  end if;
  if to_regclass('public.audit_event') is not null then
    execute 'grant select, insert on public.audit_event to tequity_connector';
  end if;
  if to_regclass('public.outbox') is not null then
    execute 'grant insert on public.outbox to tequity_connector';
  end if;
end
$$;

do $$
declare
  role_record record;
  relation_record record;
  function_record record;
begin
  select rolsuper, rolbypassrls, rolcreatedb, rolcreaterole, rolinherit, rolreplication
    into strict role_record
    from pg_roles
    where rolname = 'tequity_connector';

  if role_record.rolsuper
    or role_record.rolbypassrls
    or role_record.rolcreatedb
    or role_record.rolcreaterole
    or role_record.rolinherit
    or role_record.rolreplication
  then
    raise exception 'unsafe connector role attributes; refusing reconciliation';
  end if;

  if not has_database_privilege('tequity_connector', current_database(), 'CONNECT')
    or has_database_privilege('tequity_connector', current_database(), 'CREATE')
    or has_database_privilege('tequity_connector', current_database(), 'TEMP')
    or not has_schema_privilege('tequity_connector', 'public', 'USAGE')
    or has_schema_privilege('tequity_connector', 'public', 'CREATE')
  then
    raise exception 'unsafe connector database or schema privileges';
  end if;

  for relation_record in
    select c.oid, c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'f', 'S')
  loop
    if relation_record.relkind = 'S' then
      if has_sequence_privilege('tequity_connector', relation_record.oid, 'USAGE')
        or has_sequence_privilege('tequity_connector', relation_record.oid, 'SELECT')
        or has_sequence_privilege('tequity_connector', relation_record.oid, 'UPDATE')
      then
        raise exception 'unsafe connector sequence privilege on %', relation_record.relname;
      end if;
    elsif relation_record.relname in ('storage_connection', 'storage_token') then
      if not has_table_privilege('tequity_connector', relation_record.oid, 'SELECT')
        or not has_table_privilege('tequity_connector', relation_record.oid, 'INSERT')
        or not has_table_privilege('tequity_connector', relation_record.oid, 'UPDATE')
        or not has_table_privilege('tequity_connector', relation_record.oid, 'DELETE')
        or has_table_privilege('tequity_connector', relation_record.oid, 'TRUNCATE')
        or has_table_privilege('tequity_connector', relation_record.oid, 'REFERENCES')
        or has_table_privilege('tequity_connector', relation_record.oid, 'TRIGGER')
      then
        raise exception 'incorrect connector storage privilege on %', relation_record.relname;
      end if;
    elsif relation_record.relname = 'audit_event' then
      if not has_table_privilege('tequity_connector', relation_record.oid, 'SELECT')
        or not has_table_privilege('tequity_connector', relation_record.oid, 'INSERT')
        or has_table_privilege('tequity_connector', relation_record.oid, 'UPDATE')
        or has_table_privilege('tequity_connector', relation_record.oid, 'DELETE')
        or has_table_privilege('tequity_connector', relation_record.oid, 'TRUNCATE')
        or has_table_privilege('tequity_connector', relation_record.oid, 'REFERENCES')
        or has_table_privilege('tequity_connector', relation_record.oid, 'TRIGGER')
      then
        raise exception 'incorrect connector audit privilege';
      end if;
    elsif relation_record.relname = 'outbox' then
      if not has_table_privilege('tequity_connector', relation_record.oid, 'INSERT')
        or has_table_privilege('tequity_connector', relation_record.oid, 'SELECT')
        or has_table_privilege('tequity_connector', relation_record.oid, 'UPDATE')
        or has_table_privilege('tequity_connector', relation_record.oid, 'DELETE')
        or has_table_privilege('tequity_connector', relation_record.oid, 'TRUNCATE')
        or has_table_privilege('tequity_connector', relation_record.oid, 'REFERENCES')
        or has_table_privilege('tequity_connector', relation_record.oid, 'TRIGGER')
      then
        raise exception 'incorrect connector outbox privilege';
      end if;
    elsif has_table_privilege('tequity_connector', relation_record.oid, 'SELECT')
      or has_table_privilege('tequity_connector', relation_record.oid, 'INSERT')
      or has_table_privilege('tequity_connector', relation_record.oid, 'UPDATE')
      or has_table_privilege('tequity_connector', relation_record.oid, 'DELETE')
      or has_table_privilege('tequity_connector', relation_record.oid, 'TRUNCATE')
      or has_table_privilege('tequity_connector', relation_record.oid, 'REFERENCES')
      or has_table_privilege('tequity_connector', relation_record.oid, 'TRIGGER')
      or has_any_column_privilege('tequity_connector', relation_record.oid, 'SELECT')
      or has_any_column_privilege('tequity_connector', relation_record.oid, 'INSERT')
      or has_any_column_privilege('tequity_connector', relation_record.oid, 'UPDATE')
      or has_any_column_privilege('tequity_connector', relation_record.oid, 'REFERENCES')
    then
      raise exception 'unsafe connector privilege on unallowlisted relation %', relation_record.relname;
    end if;
  end loop;

  for function_record in
    select p.oid, p.proname
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
  loop
    if has_function_privilege('tequity_connector', function_record.oid, 'EXECUTE') then
      raise exception 'unsafe connector function privilege on %', function_record.proname;
    end if;
  end loop;
end
$$;

commit;
`;

const requiredRoleSql = [
  'login',
  'nosuperuser',
  'nobypassrls',
  'nocreatedb',
  'nocreaterole',
  'noinherit',
  'noreplication',
  "revoke all privileges on database %i from public",
  'revoke all privileges on schema public from public',
  'revoke all privileges on all tables in schema public from public',
  'revoke all privileges on all sequences in schema public from public',
  'revoke all privileges on all functions in schema public from public',
  'revoke all privileges on all tables in schema public from tequity_connector',
  "to_regclass('public.storage_connection')",
  'grant select, insert, update, delete on public.storage_connection to tequity_connector',
  "to_regclass('public.storage_token')",
  'grant select, insert, update, delete on public.storage_token to tequity_connector',
  "to_regclass('public.audit_event')",
  'grant select, insert on public.audit_event to tequity_connector',
  "to_regclass('public.outbox')",
  'grant insert on public.outbox to tequity_connector',
] as const;

/** Fail Pulumi preview before registering an unsafe role bootstrap resource. */
export function assertConnectorRolePolicy(sql: string): void {
  const normalized = sql.toLowerCase();
  const unsafeAttribute = /(^|\s)(superuser|bypassrls|createdb|createrole|inherit|replication)(?=\s|;)/i;
  const roleMembership = /\bgrant\s+[a-z_][a-z0-9_]*\s+to\s+tequity_connector\b/i;

  if (unsafeAttribute.test(normalized)) {
    throw new Error('Unsafe connector role SQL: privileged role attribute is forbidden.');
  }
  if (roleMembership.test(normalized)) {
    throw new Error('Unsafe connector role SQL: role membership is forbidden.');
  }
  if (/\bgrant\s+all\b/i.test(normalized)) {
    throw new Error('Unsafe connector role SQL: GRANT ALL is forbidden.');
  }

  const allowedGrants = new Set([
    'grant connect on database %i to tequity_connector',
    'grant usage on schema public to tequity_connector',
    'grant select, insert, update, delete on public.storage_connection to tequity_connector',
    'grant select, insert, update, delete on public.storage_token to tequity_connector',
    'grant select, insert on public.audit_event to tequity_connector',
    'grant insert on public.outbox to tequity_connector',
  ]);
  const grants = [
    ...normalized.matchAll(
      /\bgrant\s+[^'";\n]+?\s+to\s+tequity_connector\b(?<trailing>[^'";\n]*)/g,
    ),
  ];
  const canonicalGrants = grants.map((grant) => grant[0].replace(/\s+/g, ' ').trim());
  if (
    canonicalGrants.length !== allowedGrants.size ||
    grants.some((grant) => grant.groups?.trailing.trim() !== '') ||
    canonicalGrants.some((grant) => !allowedGrants.has(grant)) ||
    [...allowedGrants].some((grant) => !canonicalGrants.includes(grant))
  ) {
    throw new Error('Unsafe connector role SQL: grants must exactly match the structural allowlist.');
  }
  for (const required of requiredRoleSql) {
    if (!normalized.includes(required)) {
      throw new Error(`Unsafe connector role SQL: missing required policy fragment: ${required}`);
    }
  }
}

export function buildConnectorRoleConfigMapArgs(
  namespace: string,
  sql: string = connectorRoleSql,
): k8s.core.v1.ConfigMapArgs {
  assertConnectorRolePolicy(sql);
  return {
    metadata: {
      name: 'tequity-connector-role-sql',
      namespace,
      labels: { 'app.kubernetes.io/part-of': 'tequity' },
    },
    data: { 'reconcile.sql': sql },
  };
}

export function buildConnectorExternalSecretArgs(
  namespace: string,
): k8s.apiextensions.CustomResourceArgs {
  return {
    apiVersion: 'external-secrets.io/v1beta1',
    kind: 'ExternalSecret',
    metadata: {
      name: CONNECTOR_DATABASE.secretName,
      namespace,
      labels: { 'app.kubernetes.io/part-of': 'tequity' },
    },
    spec: {
      refreshInterval: CONNECTOR_DATABASE.externalSecretRefreshInterval,
      secretStoreRef: { kind: 'ClusterSecretStore', name: 'tequity-vault' },
      target: {
        name: CONNECTOR_DATABASE.secretName,
        creationPolicy: 'Owner',
        deletionPolicy: 'Retain',
        template: {
          engineVersion: 'v2',
          type: 'Opaque',
          data: {
            CONNECTOR_DATABASE_URL:
              `postgresql://${CONNECTOR_DATABASE.roleName}:{{ .password }}` +
              `@${CONNECTOR_DATABASE.host}:${CONNECTOR_DATABASE.port}/${CONNECTOR_DATABASE.database}`,
            CONNECTOR_DATABASE_PASSWORD: '{{ .password }}',
          },
        },
      },
      data: [
        {
          secretKey: 'password',
          remoteRef: {
            key: CONNECTOR_DATABASE.vaultPath,
            property: 'password',
          },
        },
      ],
    },
  };
}

function connectorRolePodTemplate(
  namespace: string,
): k8s.types.input.core.v1.PodTemplateSpec {
  return {
    metadata: {
      namespace,
      labels: {
        'app.kubernetes.io/name': 'tequity-connector-role-reconcile',
        'app.kubernetes.io/part-of': 'tequity',
      },
    },
    spec: {
      automountServiceAccountToken: false,
      restartPolicy: 'OnFailure',
      securityContext: {
        runAsNonRoot: true,
        runAsUser: 70,
        runAsGroup: 70,
        fsGroup: 70,
        seccompProfile: { type: 'RuntimeDefault' },
      },
      containers: [
        {
          name: 'reconcile',
          image: CONNECTOR_DATABASE.clientImage,
          imagePullPolicy: 'IfNotPresent',
          command: ['/bin/sh', '-ec'],
          args: [
            'case "${CONNECTOR_DATABASE_PASSWORD:-}" in ' +
              '(*[!0-9a-f]*|"") echo "connector database password must be lowercase hex" >&2; exit 1;; esac; ' +
              '[ "${#CONNECTOR_DATABASE_PASSWORD}" -eq 64 ] || ' +
              '{ echo "connector database password must encode 32 random bytes" >&2; exit 1; }; ' +
              'exec psql --no-psqlrc --set=ON_ERROR_STOP=1 --file=/bootstrap/reconcile.sql',
          ],
          env: [
            { name: 'PGHOST', value: CONNECTOR_DATABASE.host },
            { name: 'PGPORT', value: String(CONNECTOR_DATABASE.port) },
            { name: 'PGDATABASE', value: CONNECTOR_DATABASE.database },
            { name: 'PGUSER', value: 'postgres' },
            {
              name: 'PGPASSWORD',
              valueFrom: {
                secretKeyRef: {
                  name: CONNECTOR_DATABASE.adminSecretName,
                  key: CONNECTOR_DATABASE.adminSecretKey,
                  optional: false,
                },
              },
            },
            {
              name: 'CONNECTOR_DATABASE_PASSWORD',
              valueFrom: {
                secretKeyRef: {
                  name: CONNECTOR_DATABASE.secretName,
                  key: 'CONNECTOR_DATABASE_PASSWORD',
                  optional: false,
                },
              },
            },
          ],
          resources: {
            requests: { cpu: '10m', memory: '32Mi' },
            limits: { cpu: '100m', memory: '128Mi' },
          },
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ['ALL'] },
            readOnlyRootFilesystem: true,
            runAsNonRoot: true,
            runAsUser: 70,
            runAsGroup: 70,
          },
          volumeMounts: [
            { name: 'bootstrap-sql', mountPath: '/bootstrap', readOnly: true },
            { name: 'tmp', mountPath: '/tmp' },
          ],
        },
      ],
      volumes: [
        {
          name: 'bootstrap-sql',
          configMap: {
            name: 'tequity-connector-role-sql',
            defaultMode: 0o440,
          },
        },
        { name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: '16Mi' } },
      ],
    },
  };
}

export function buildConnectorRoleCronJobArgs(
  namespace: string,
): k8s.batch.v1.CronJobArgs {
  return {
    metadata: {
      name: 'tequity-connector-role-reconcile',
      namespace,
      labels: { 'app.kubernetes.io/part-of': 'tequity' },
    },
    spec: {
      schedule: CONNECTOR_DATABASE.reconcileSchedule,
      concurrencyPolicy: 'Forbid',
      startingDeadlineSeconds: 120,
      successfulJobsHistoryLimit: 1,
      failedJobsHistoryLimit: 3,
      jobTemplate: {
        spec: {
          backoffLimit: 3,
          activeDeadlineSeconds: 300,
          template: connectorRolePodTemplate(namespace),
        },
      },
    },
  };
}

export function buildConnectorRoleBootstrapJobArgs(
  namespace: string,
): k8s.batch.v1.JobArgs {
  return {
    metadata: {
      name: 'tequity-connector-role-bootstrap',
      namespace,
      labels: { 'app.kubernetes.io/part-of': 'tequity' },
    },
    spec: {
      backoffLimit: 6,
      activeDeadlineSeconds: 900,
      template: connectorRolePodTemplate(namespace),
    },
  };
}

export interface ConnectorDatabaseDependencies {
  postgresql: k8s.helm.v3.Release;
  externalSecrets: k8s.helm.v3.Release;
  vaultStore: k8s.apiextensions.CustomResource;
}

export interface ConnectorDatabaseResources {
  configMap: k8s.core.v1.ConfigMap;
  externalSecret: k8s.apiextensions.CustomResource;
  bootstrapJob: k8s.batch.v1.Job;
  reconcileCronJob: k8s.batch.v1.CronJob;
}

export function deployConnectorDatabase(
  provider: k8s.Provider,
  cfg: Settings,
  dependencies: ConnectorDatabaseDependencies,
): ConnectorDatabaseResources {
  const configMap = new k8s.core.v1.ConfigMap(
    'connector-role-sql',
    buildConnectorRoleConfigMapArgs(cfg.appNamespace),
    { provider },
  );
  const externalSecret = new k8s.apiextensions.CustomResource(
    'connector-database-secret',
    buildConnectorExternalSecretArgs(cfg.appNamespace),
    {
      provider,
      dependsOn: [dependencies.externalSecrets, dependencies.vaultStore],
    },
  );
  const resourceDependencies = [dependencies.postgresql, configMap, externalSecret];

  const bootstrapJob = new k8s.batch.v1.Job(
    'connector-role-bootstrap',
    buildConnectorRoleBootstrapJobArgs(cfg.appNamespace),
    { provider, dependsOn: resourceDependencies },
  );
  const reconcileCronJob = new k8s.batch.v1.CronJob(
    'connector-role-reconcile',
    buildConnectorRoleCronJobArgs(cfg.appNamespace),
    { provider, dependsOn: resourceDependencies },
  );

  return { configMap, externalSecret, bootstrapJob, reconcileCronJob };
}
