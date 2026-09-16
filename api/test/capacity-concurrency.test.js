const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app, pool;
before(async () => ({ app, pool } = await h.setup()));
after(() => h.teardown());

test('容量并发：两处闸机并发验票不突破时段容量', async () => {
  const CAPACITY = 3;
  const { ride, devices } = await h.createRideWithRules(
    app,
    pool,
    {
      min_height_cm: 100,
      allowed_age_bands: ['child', 'teen', 'adult'],
      requires_health_ack: false,
      guardian_required_for_age_bands: [],
      interval_seconds: 0,
      window_minutes: 30,
      window_capacity: CAPACITY,
      max_entries_per_day: 0,
    },
    { gates: 2 }
  );

  // 10 名游客在同一时段窗口内、经两个闸机并发验票
  const visitors = await Promise.all(Array.from({ length: 10 }, () => h.createVisitor(app)));
  const bands = await Promise.all(visitors.map((v) => h.issueWristband(app, v.id)));
  const at = '2026-09-16T10:05:00Z';

  const results = await Promise.all(
    bands.map((b, i) =>
      h.scan(app, {
        deviceId: devices[i % 2].id,
        publicId: b.public_id,
        at,
        eventId: `cap-${i}`,
      })
    )
  );

  const allowed = results.filter((r) => r.decision === 'allow');
  const denied = results.filter((r) => r.decision === 'deny');
  assert.equal(allowed.length, CAPACITY, '放行数恰好等于容量');
  assert.equal(denied.length, 10 - CAPACITY);
  for (const d of denied) assert.equal(d.reason_code, 'CAPACITY_FULL');

  const { rows } = await pool.query(
    'SELECT used FROM capacity_windows WHERE ride_id = $1',
    [ride.id]
  );
  assert.equal(rows.length, 1);
  assert.equal(rows[0].used, CAPACITY, '容量计数不超卖');

  // 下一时段窗口恢复可入
  const r = await h.scan(app, {
    deviceId: devices[0].id,
    publicId: bands[0].public_id,
    at: '2026-09-16T10:35:00Z',
    eventId: 'cap-next-window',
  });
  assert.deepEqual(r, { decision: 'allow', reason_code: null });
});
