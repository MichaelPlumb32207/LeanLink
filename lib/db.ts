import { attachDatabasePool } from '@vercel/functions';
import { Pool, type PoolClient, type QueryResultRow } from 'pg';

const globalForPg = globalThis as typeof globalThis & { pgPool?: Pool };

function createPool() {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: true },
    max: 10,
  });
  attachDatabasePool(pool);
  return pool;
}

export const pool = globalForPg.pgPool ?? createPool();

if (process.env.NODE_ENV !== 'production') {
  globalForPg.pgPool = pool;
}

export async function withUserDb<T>(
  userEmail: string,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(`SELECT set_config('app.current_user', $1, true)`, [userEmail]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

export async function queryAsUser<T extends QueryResultRow>(
  userEmail: string,
  text: string,
  params?: unknown[],
) {
  return withUserDb(userEmail, (client) => client.query<T>(text, params));
}