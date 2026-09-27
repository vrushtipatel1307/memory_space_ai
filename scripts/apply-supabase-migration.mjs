import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import pg from 'pg'

const root = resolve('.')
const envFile = resolve(root, '.env.local')
if (existsSync(envFile)) {
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/)
    if (!match) continue
    const [, key, rawValue] = match
    const value = rawValue.replace(/^(['"])(.*)\1$/, '$2').trim()
    if (process.env[key] === undefined) process.env[key] = value
  }
}

const connectionString = process.env.SUPABASE_DB_URL
if (!connectionString || /\[(?:YOUR-)?PASSWORD\]/i.test(connectionString) || /your-database-password/i.test(connectionString)) {
  throw new Error('Set SUPABASE_DB_URL with the database password in .env.local before applying the migration.')
}

const connection = new URL(connectionString)
if (!/^db\.[a-z0-9-]+\.supabase\.co$/i.test(connection.hostname) || connection.username !== 'postgres' || connection.pathname !== '/postgres') {
  throw new Error('SUPABASE_DB_URL must use a direct Supabase host, the postgres user, and the postgres database.')
}

const migrationDirectory = resolve(root, 'supabase/migrations')
const migrationFiles = readdirSync(migrationDirectory).filter((name) => name.endsWith('.sql')).sort()
if (!migrationFiles.length) throw new Error('No Supabase migrations were found.')
const caPath = process.env.SUPABASE_DB_CA_CERT
  ? resolve(root, process.env.SUPABASE_DB_CA_CERT)
  : undefined
const ssl = caPath
  ? { rejectUnauthorized: true, ca: readFileSync(caPath, 'utf8') }
  : { rejectUnauthorized: true }
const client = new pg.Client({ connectionString, ssl })

try {
  await client.connect()
  await client.query('begin')
  for (const migration of migrationFiles) {
    await client.query(readFileSync(resolve(migrationDirectory, migration), 'utf8'))
    console.log(`[Supabase] Applied ${migration}`)
  }
  await client.query('commit')
  const { rows } = await client.query(`
    select c.relname as table_name, c.relrowsecurity as rls_enabled
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname in ('profiles', 'memories', 'people', 'groups', 'group_members', 'group_invitations', 'memory_people', 'memory_groups')
    order by c.relname
  `)
  if (rows.length !== 8 || rows.some((row) => !row.rls_enabled)) {
    throw new Error('Migration verification failed: profiles, memories, people, groups, memberships, invitations, and join tables must all have row-level security enabled.')
  }
  const { rows: buckets } = await client.query(`select id, public from storage.buckets where id in ('memory-photos','memory-audio','people-photos','group-images','profile-photos') order by id`)
  if (buckets.length !== 5 || buckets.some((bucket) => bucket.public)) throw new Error('Migration verification failed: all five photo/audio buckets must exist and remain private.')
  console.log('[Supabase] Migration applied. Table RLS status:', rows)
  console.log('[Supabase] Private Storage buckets verified:', buckets)
} catch (error) {
  await client.query('rollback').catch(() => undefined)
  console.error('[Supabase] Migration failed.', error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await client.end().catch(() => undefined)
}
