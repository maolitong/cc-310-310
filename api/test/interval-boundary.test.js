const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app, pool;
before(async () => ({ app, pool } = await h.setup()));
after(() => h.teardown());

test('间隔边界：恰好等于间隔放行，差一秒拒绝，乱序同样适用', async () => {
  const visitor = await h.createVisitor(app, { height_cm: 160 });
  const band = await h.issueWristband(app, visitor.id);
  const { devices } = await h.createRideWithRules(app, pool, {
    min_height_cm: 100,
    allowed_age_bands: ['child', 'teen', 'adult'],
    requires_health_ack: false,
    guardian_required_for_age_bands: [],
    interval_seconds: 300,
    window_minutes: 60,
    window_capacity: 100,
    max_entries_per_day: 0,
  });
  const gate = devices[0].id;
  const T = '2026-09-16T12:00:00Z';

  const at = (offsetSec) => new Date(Date.parse(T) + offsetSec * 1000).toISOString();

  // 首次乘坐
  assert.deepEqual(await h.scan(app, { deviceId: gate, publicId: band.public_id, at: T }), {
    decision: 'allow',
    reason_code: null,
  });

  // T+299：间隔不足
  assert.deepEqual(await h.scan(app, { deviceId: gate, publicId: band.public_id, at: at(299) }), {
    decision: 'deny',
    reason_code: 'INTERVAL_TOO_SOON',
  });

  // T+300：恰好等于间隔，放行
  assert.deepEqual(await h.scan(app, { deviceId: gate, publicId: band.public_id, at: at(300) }), {
    decision: 'allow',
    reason_code: null,
  });

  // 离线乱序补传：T-299 与首次记录相距不足，拒绝
  assert.deepEqual(
    await h.scan(app, { deviceId: gate, publicId: band.public_id, at: at(-299), offline: true }),
    { decision: 'deny', reason_code: 'INTERVAL_TOO_SOON' }
  );

  // T-300：恰好等于间隔，放行
  assert.deepEqual(
    await h.scan(app, { deviceId: gate, publicId: band.public_id, at: at(-300), offline: true }),
    { decision: 'allow', reason_code: null }
  );

  // T+150：位于 T 与 T+300 两条记录之间，与两者都相距不足
  assert.deepEqual(await h.scan(app, { deviceId: gate, publicId: band.public_id, at: at(150) }), {
    decision: 'deny',
    reason_code: 'INTERVAL_TOO_SOON',
  });
});
