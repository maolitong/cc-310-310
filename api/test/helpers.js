const { Pool } = require('pg');
const Redis = require('ioredis');
const { runMigrations } = require('../src/migrate');
const { buildApp } = require('../src/app');

process.env.NODE_ENV = 'test';

const DATABASE_URL = process.env.DATABASE_URL || 'postgres://park:park@localhost:5432/park_test';
const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379/1';

let ctx = null;

async function setup() {
  const pool = new Pool({ connectionString: DATABASE_URL });
  await runMigrations(pool);
  await pool.query(
    `TRUNCATE verifications, ride_entries, capacity_windows, wristbands,
              guardianships, devices, ride_rulesets, rides, visitors, events CASCADE`
  );
  const redis = new Redis(REDIS_URL);
  await redis.flushdb();
  const app = buildApp({ pool, redis });
  ctx = { app, pool, redis };
  return ctx;
}

async function teardown() {
  if (!ctx) return;
  await ctx.app.close();
  await ctx.redis.quit();
  await ctx.pool.end();
  ctx = null;
}

// ---- 造数工具 ----

async function createVisitor(app, overrides = {}) {
  const body = {
    name: overrides.name || `测试游客${Math.floor(Math.random() * 1e6)}`,
    height_cm: overrides.height_cm ?? 150,
    age_band: overrides.age_band || 'adult',
    health_ack: overrides.health_ack ?? true,
  };
  const res = await app.inject({ method: 'POST', url: '/api/visitors', payload: body });
  return res.json();
}

async function issueWristband(app, visitorId) {
  const res = await app.inject({ method: 'POST', url: `/api/visitors/${visitorId}/wristbands` });
  return res.json();
}

async function createRideWithRules(app, pool, rules, { effectiveFrom = '2026-01-01T00:00:00Z', gates = 1 } = {}) {
  const code = `ride-${Math.random().toString(36).slice(2, 10)}`;
  const { rows: r } = await pool.query('INSERT INTO rides (code, name) VALUES ($1,$2) RETURNING *', [
    code,
    code,
  ]);
  await pool.query(
    'INSERT INTO ride_rulesets (ride_id, version, rules, effective_from) VALUES ($1,1,$2,$3)',
    [r[0].id, JSON.stringify(rules), effectiveFrom]
  );
  const devices = [];
  for (let i = 0; i < gates; i++) {
    const { rows: d } = await pool.query('INSERT INTO devices (ride_id, name) VALUES ($1,$2) RETURNING *', [
      r[0].id,
      `${code}-gate-${i}`,
    ]);
    devices.push(d[0]);
  }
  return { ride: r[0], devices };
}

let seq = 0;
async function scan(app, { deviceId, publicId, at, eventId, offline }) {
  const res = await app.inject({
    method: 'POST',
    url: '/api/gates/verify',
    payload: {
      client_event_id: eventId || `t-${process.pid}-${seq++}`,
      device_id: deviceId,
      wristband_public_id: publicId,
      occurred_at: at,
      offline: !!offline,
    },
  });
  return res.json();
}

async function entryCount(pool, visitorId, rideId) {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM ride_entries WHERE visitor_id = $1 AND ride_id = $2',
    [visitorId, rideId]
  );
  return rows[0].n;
}

module.exports = {
  setup,
  teardown,
  createVisitor,
  issueWristband,
  createRideWithRules,
  scan,
  entryCount,
};
