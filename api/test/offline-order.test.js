const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app, pool;
before(async () => ({ app, pool } = await h.setup()));
after(() => h.teardown());

test('离线乱序：乱序上传按发生时刻判定，重复上传不重复扣减', async () => {
  const visitor = await h.createVisitor(app, { height_cm: 160 });
  const band = await h.issueWristband(app, visitor.id);
  const { ride, devices } = await h.createRideWithRules(app, pool, {
    min_height_cm: 100,
    allowed_age_bands: ['child', 'teen', 'adult'],
    requires_health_ack: false,
    guardian_required_for_age_bands: [],
    interval_seconds: 60,
    window_minutes: 30,
    window_capacity: 10,
    max_entries_per_day: 10,
  });

  // 闸机离线缓存了 3 条记录，恢复后乱序上传
  const events = [
    { id: 'off-1', at: '2026-09-16T08:00:00Z' },
    { id: 'off-2', at: '2026-09-16T08:02:00Z' },
    { id: 'off-3', at: '2026-09-16T08:04:00Z' },
  ];
  for (const e of [events[2], events[0], events[1]]) {
    const res = await h.scan(app, {
      deviceId: devices[0].id,
      publicId: band.public_id,
      at: e.at,
      eventId: e.id,
      offline: true,
    });
    assert.deepEqual(res, { decision: 'allow', reason_code: null });
  }
  assert.equal(await h.entryCount(pool, visitor.id, ride.id), 3);

  // 重复上传同一事件：返回首次结果，不重复扣减
  const dup = await h.scan(app, {
    deviceId: devices[0].id,
    publicId: band.public_id,
    at: events[0].at,
    eventId: 'off-1',
    offline: true,
  });
  assert.deepEqual(dup, { decision: 'allow', reason_code: null });
  assert.equal(await h.entryCount(pool, visitor.id, ride.id), 3);
  const { rows: v } = await pool.query(
    `SELECT count(*)::int AS n FROM verifications WHERE client_event_id = 'off-1'`
  );
  assert.equal(v[0].n, 1);

  // 补发腕带后，离线闸机稍后上传的旧带记录仍保存，但不产生 entry、不扣容量
  await h.issueWristband(app, visitor.id);
  const stale = await h.scan(app, {
    deviceId: devices[0].id,
    publicId: band.public_id,
    at: '2026-09-16T08:06:00Z',
    eventId: 'off-4',
    offline: true,
  });
  assert.deepEqual(stale, { decision: 'deny', reason_code: 'WRISTBAND_INACTIVE' });
  assert.equal(await h.entryCount(pool, visitor.id, ride.id), 3, '旧带记录不扣减次数');

  const { rows: saved } = await pool.query(
    `SELECT * FROM verifications WHERE client_event_id = 'off-4'`
  );
  assert.equal(saved.length, 1, '旧带离线记录已保存');
  assert.equal(saved[0].offline, true);

  const { rows: cap } = await pool.query(
    'SELECT used FROM capacity_windows WHERE ride_id = $1',
    [ride.id]
  );
  assert.equal(cap.reduce((s, r) => s + r.used, 0), 3, '容量未被旧带记录占用');
});
