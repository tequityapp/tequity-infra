import { spawnSync } from 'node:child_process';
import {
  CONNECTOR_DATABASE,
  connectorRoleSql,
} from '../src/connector-database';

const dockerAvailable =
  spawnSync('docker', ['version'], { encoding: 'utf8', timeout: 10_000 }).status === 0;
const describeWithDocker = dockerAvailable ? describe : describe.skip;
const containerName = `tequity-connector-policy-${process.pid}`;
const connectorPassword =
  '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function docker(args: string[], input?: string): string {
  const result = spawnSync('docker', args, {
    encoding: 'utf8',
    input,
    timeout: 60_000,
  });
  if (result.status !== 0) {
    throw new Error(
      `docker ${args.join(' ')} failed (${result.status}):\n${result.stdout}\n${result.stderr}`,
    );
  }
  return result.stdout.trim();
}

describeWithDocker('connector database PostgreSQL policy integration', () => {
  jest.setTimeout(120_000);

  beforeAll(() => {
    docker([
      'run',
      '--rm',
      '--detach',
      '--name',
      containerName,
      '-e',
      'POSTGRES_PASSWORD=test-admin-only',
      '-e',
      `POSTGRES_DB=${CONNECTOR_DATABASE.database}`,
      CONNECTOR_DATABASE.clientImage,
    ]);

    let ready = false;
    let consecutiveReadyChecks = 0;
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const result = spawnSync(
        'docker',
        [
          'exec',
          containerName,
          'pg_isready',
          '-U',
          'postgres',
          '-d',
          CONNECTOR_DATABASE.database,
        ],
        { encoding: 'utf8', timeout: 5_000 },
      );
      if (result.status === 0) {
        consecutiveReadyChecks += 1;
        if (consecutiveReadyChecks >= 2) {
          ready = true;
          break;
        }
      } else {
        consecutiveReadyChecks = 0;
      }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500);
    }
    if (!ready) {
      throw new Error('ephemeral PostgreSQL did not become ready');
    }

    const seedSql = `
      create table storage_connection(id int primary key, tenant_id text not null);
      create table storage_token(id int primary key, tenant_id text not null);
      create table audit_event(id int primary key);
      create table outbox(id int primary key);
      create table user_account(id int primary key, email text);
      create function escalate() returns int language sql as 'select 1';
      insert into storage_connection values (1, 'tenant-a'), (2, 'tenant-b');
      alter table storage_connection enable row level security;
      alter table storage_connection force row level security;
      create policy tenant_isolation on storage_connection
        using (tenant_id = current_setting('app.tenant_id', true))
        with check (tenant_id = current_setting('app.tenant_id', true));
      grant all on database tequity to public;
      grant all on schema public to public;
      grant all on all tables in schema public to public;
      grant all on all functions in schema public to public;
      grant select(email) on user_account to public;
    `;
    docker(
      [
        'exec',
        '-i',
        containerName,
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'postgres',
        '-d',
        CONNECTOR_DATABASE.database,
      ],
      seedSql,
    );
    docker(
      [
        'exec',
        '-i',
        '-e',
        `CONNECTOR_DATABASE_PASSWORD=${connectorPassword}`,
        containerName,
        'psql',
        '-v',
        'ON_ERROR_STOP=1',
        '-U',
        'postgres',
        '-d',
        CONNECTOR_DATABASE.database,
      ],
      connectorRoleSql,
    );
  });

  afterAll(() => {
    spawnSync('docker', ['stop', containerName], {
      encoding: 'utf8',
      timeout: 30_000,
    });
  });

  it('removes PUBLIC-derived privileges and preserves tenant RLS', () => {
    const query = `
      set app.tenant_id = 'tenant-a';
      select string_agg(id::text, ',') from storage_connection;
      select
        has_database_privilege(current_user, current_database(), 'CONNECT'),
        has_database_privilege(current_user, current_database(), 'CREATE'),
        has_database_privilege(current_user, current_database(), 'TEMP');
      select
        has_schema_privilege(current_user, 'public', 'USAGE'),
        has_schema_privilege(current_user, 'public', 'CREATE');
      select
        has_table_privilege(current_user, 'public.user_account', 'SELECT'),
        has_any_column_privilege(current_user, 'public.user_account', 'SELECT'),
        has_function_privilege(current_user, 'public.escalate()', 'EXECUTE');
      set app.tenant_id = 'tenant-b';
      select string_agg(id::text, ',') from storage_connection;
    `;
    const output = docker([
      'exec',
      '-e',
      `PGPASSWORD=${connectorPassword}`,
      containerName,
      'psql',
      '-v',
      'ON_ERROR_STOP=1',
      '-At',
      '-U',
      CONNECTOR_DATABASE.roleName,
      '-d',
      CONNECTOR_DATABASE.database,
      '-c',
      query,
    ]);

    expect(output.split('\n')).toEqual([
      'SET',
      '1',
      't|f|f',
      't|f',
      'f|f|f',
      'SET',
      '2',
    ]);
  });
});
