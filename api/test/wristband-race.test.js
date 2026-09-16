const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app, pool;
before(async () => ({ app, pool } = await h.setup()));
after(() => h.teardown());

test('补带竞态：并发补发后只有一条有效腕带，旧带立即停用', async () => {
  const visitor = await h.createVisitor(app);
  const first = await h.issueWristband(app, visitor.id);

  // 并发补发 6 次
  const results = await Promise.all(
    Array.from({ length: 6 }, () =>
      app.inject({ method: 'POST', url: `/api/visitors/${visitor.id}/wristbands` })
    )
  );
  for (const r of results) assert.equal(r.statusCode, 200);

  const { rows: active } = await pool.query(
    `SELECT * FROM wristbands WHERE visitor_id = $1 AND status = 'active'`,
    [visitor.id]
  );
  assert.equal(active.length, 1, '同一时刻只能有一条有效腕带');

  const { rows: all } = await pool.query(
    'SELECT * FROM wristbands WHERE visitor_id = $1',
    [visitor.id]
  );
  assert.equal(all.length, 7);
  assert.equal(all.filter((w) => w.status === 'deactivated').length, 6);

  // 旧带（含首发带）验票一律拒绝，但记录仍保存
  const { ride, devices } = await h.createRideWithRules(app, pool, {
    min_height_cm: 100,
    allowed_age_bands: ['child', 'teen', 'adult'],
    requires_health_ack: false,
    guardian_required_for_age_bands: [],
    interval_seconds: 0,
    window_minutes: 30,
    window_capacity: 100,
    max_entries_per_day: 0,
  });
  const res = await h.scan(app, {
    deviceId: devices[0].id,
    publicId: first.public_id,
    at: '2026-09-16T10:00:00Z',
  });
  assert.deepEqual(res, { decision: 'deny', reason_code: 'WRISTBAND_INACTIVE' });

  const { rows: logs } = await pool.query(
    `SELECT * FROM verifications WHERE wristband_public_id = $1`,
    [first.public_id]
  );
  assert.equal(logs.length, 1, '旧带记录仍需保存');
  assert.equal(logs[0].decision, 'deny');
  assert.equal(logs[0].visitor_id, visitor.id);

  // 新带可以正常核验
  const ok = await h.scan(app, {
    deviceId: devices[0].id,
    publicId: active[0].public_id,
    at: '2026-09-16T10:01:00Z',
  });
  assert.deepEqual(ok, { decision: 'allow', reason_code: null });
  assert.equal(await h.entryCount(pool, visitor.id, ride.id), 1);
});
