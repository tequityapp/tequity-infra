import {
  CONNECTOR_DATABASE,
  assertConnectorRolePolicy,
  buildConnectorExternalSecretArgs,
  buildConnectorRoleConfigMapArgs,
  buildConnectorRoleCronJobArgs,
  connectorRoleSql,
} from '../src/connector-database';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('connector database role policy', () => {
  it('enforces a dedicated login role with no privilege or RLS bypass flags', () => {
    expect(() => assertConnectorRolePolicy(connectorRoleSql)).not.toThrow();
    expect(connectorRoleSql).toMatch(/\blogin\b[\s\S]*\bnosuperuser\b[\s\S]*\bnobypassrls\b/i);
    expect(connectorRoleSql).toMatch(
      /\bnocreatedb\b[\s\S]*\bnocreaterole\b[\s\S]*\bnoinherit\b[\s\S]*\bnoreplication\b/i,
    );
    expect(connectorRoleSql).toContain('revoke all privileges on all tables in schema public');
    expect(connectorRoleSql).toContain(
      'grant select, insert, update, delete on public.storage_connection',
    );
    expect(connectorRoleSql).toContain(
      'grant select, insert, update, delete on public.storage_token',
    );
    expect(connectorRoleSql).toContain('grant select, insert on public.audit_event');
    expect(connectorRoleSql).toContain('grant insert on public.outbox');
    expect(connectorRoleSql).toContain("to_regclass('public.storage_connection')");
    expect(connectorRoleSql).toContain("to_regclass('public.storage_token')");
    expect(connectorRoleSql).toContain("to_regclass('public.audit_event')");
    expect(connectorRoleSql).toContain("to_regclass('public.outbox')");
    expect(connectorRoleSql).toMatch(/\bbegin;[\s\S]*\bcommit;/i);
    expect(connectorRoleSql).not.toMatch(/\bgrant all\b/i);
  });

  it.each([
    ['superuser', connectorRoleSql.replace(/\bnosuperuser\b/i, 'SUPERUSER')],
    ['BYPASSRLS', connectorRoleSql.replace(/\bnobypassrls\b/i, 'BYPASSRLS')],
    ['role membership', `${connectorRoleSql}\ngrant pg_read_all_data to tequity_connector;`],
  ])('rejects unsafe %s SQL before a Pulumi preview can register resources', (_case, sql) => {
    expect(() => buildConnectorRoleConfigMapArgs('tequity', sql)).toThrow(/unsafe connector role/i);
  });
});

describe('connector database credential flow', () => {
  it('syncs only the dedicated Helm Secret from a Vault reference', () => {
    const args = buildConnectorExternalSecretArgs('tequity');
    const metadata = args.metadata as Record<string, any>;
    const spec = args.spec as Record<string, any>;

    expect(metadata.name).toBe(CONNECTOR_DATABASE.secretName);
    expect(spec.secretStoreRef).toEqual({ kind: 'ClusterSecretStore', name: 'tequity-vault' });
    expect(spec.data).toEqual([
      {
        secretKey: 'password',
        remoteRef: {
          key: CONNECTOR_DATABASE.vaultPath,
          property: 'password',
        },
      },
    ]);
    expect(spec.target.name).toBe(CONNECTOR_DATABASE.secretName);
    expect(spec.target.template.data.CONNECTOR_DATABASE_URL).toContain('{{ .password }}');
    expect(spec.target.template.data.CONNECTOR_DATABASE_PASSWORD).toBe('{{ .password }}');
    expect(JSON.stringify(args)).not.toContain('tequity-secrets');
  });

  it('serializes references and templates, never a generated credential', () => {
    const resources = [
      buildConnectorExternalSecretArgs('tequity'),
      buildConnectorRoleConfigMapArgs('tequity'),
      buildConnectorRoleCronJobArgs('tequity'),
    ];
    const serialized = JSON.stringify(resources);

    expect(serialized).toContain(CONNECTOR_DATABASE.vaultPath);
    expect(serialized).toContain('{{ .password }}');
    expect(serialized).not.toMatch(/postgresql:\/\/tequity_connector:(?!\{\{)/);
    expect(serialized).not.toMatch(/["']password["']\s*:\s*["'][a-f0-9]{32,}["']/i);
  });

  it('reconciles from Secret references with a pinned, restricted client image', () => {
    const args = buildConnectorRoleCronJobArgs('tequity');
    const spec = args.spec as Record<string, any>;
    const podSpec = spec.jobTemplate.spec.template.spec;
    const container = podSpec.containers[0];
    const envByName = Object.fromEntries(
      container.env.map((entry: { name: string }) => [entry.name, entry]),
    ) as Record<string, any>;

    expect(spec.concurrencyPolicy).toBe('Forbid');
    expect(container.image).toMatch(/^postgres:17\.2-alpine3\.21@sha256:[a-f0-9]{64}$/);
    expect(container.securityContext).toMatchObject({
      allowPrivilegeEscalation: false,
      readOnlyRootFilesystem: true,
      runAsNonRoot: true,
      capabilities: { drop: ['ALL'] },
    });
    expect(envByName.PGPASSWORD.valueFrom.secretKeyRef).toEqual({
      name: CONNECTOR_DATABASE.adminSecretName,
      key: CONNECTOR_DATABASE.adminSecretKey,
      optional: false,
    });
    expect(envByName.CONNECTOR_DATABASE_PASSWORD.valueFrom.secretKeyRef).toEqual({
      name: CONNECTOR_DATABASE.secretName,
      key: 'CONNECTOR_DATABASE_PASSWORD',
      optional: false,
    });
    expect(envByName.PGPASSWORD).not.toHaveProperty('value');
    expect(envByName.CONNECTOR_DATABASE_PASSWORD).not.toHaveProperty('value');
    expect(container.args[0]).toContain('${#CONNECTOR_DATABASE_PASSWORD}" -eq 64');
    expect(container.args[0]).not.toContain('echo "$CONNECTOR_DATABASE_PASSWORD"');
  });

  it('generates rotation material locally and sends it to Vault only through stdin', () => {
    const script = readFileSync(
      resolve(__dirname, '../scripts/rotate-connector-database-password.ps1'),
      'utf8',
    );

    expect(script).toContain('RandomNumberGenerator]::Fill');
    expect(script).toContain('password=-');
    expect(script).not.toMatch(/vault.+password=\$password/i);
    expect(script).not.toMatch(/Write-(Host|Output).*\$password/i);
  });
});
