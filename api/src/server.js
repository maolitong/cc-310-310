const { Pool } = require('pg');
const Redis = require('ioredis');
const config = require('./config');
const { runMigrations } = require('./migrate');
const { seedIfEmpty } = require('./seed');
const { buildApp } = require('./app');

async function waitForDb(pool, attempts = 30) {
  for (let i = 0; i < attempts; i++) {
    try {
      await pool.query('SELECT 1');
      return;
    } catch (e) {
      await new Promise((r) => setTimeout(r, 1000));
    }
  }
  throw new Error('database not reachable');
}

async function main() {
  const pool = new Pool({ connectionString: config.databaseUrl });
  await waitForDb(pool);
  await runMigrations(pool);
  const redis = new Redis(config.redisUrl);
  if (config.seedDemo) await seedIfEmpty(pool, redis);
  const app = buildApp({ pool, redis });
  await app.listen({ port: config.port, host: '0.0.0.0' });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
