const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app, pool;
before(async () => ({ app, pool } = await h.setup()));
after(() => h.teardown());

test('信息最小化：闸机响应只有放行结果或原因码，不泄露个人数据', async () => {
  const visitor = await h.createVisitor(app, {
    name: '隐私测试员',
    height_cm: 100,
    age_band: 'child',
    health_ack: false,
  });
  const band = await h.issueWristband(app, visitor.id);
  const { devices } = await h.createRideWithRules(app, pool, {
    min_height_cm: 140,
    allowed_age_bands: ['teen', 'adult'],
    requires_health_ack: true,
    guardian_required_for_age_bands: ['child'],
    interval_seconds: 0,
    window_minutes: 30,
    window_capacity: 100,
    max_entries_per_day: 0,
  });

  // 拒绝场景
  const deny = await h.scan(app, {
    deviceId: devices[0].id,
    publicId: band.public_id,
    at: '2026-09-16T10:00:00Z',
  });
  assert.deepEqual(Object.keys(deny).sort(), ['decision', 'reason_code']);
  assert.equal(deny.decision, 'deny');
  assert.equal(deny.reason_code, 'HEIGHT_TOO_SHORT');
  const raw = JSON.stringify(deny);
  for (const leak of ['100', 'child', '隐私', 'health', 'height', 'age_band', 'visitor']) {
    assert.ok(!raw.includes(leak), `闸机响应不得包含 ${leak}`);
  }

  // 放行场景同样只有两个字段
  const tall = await h.createVisitor(app, { height_cm: 180, age_band: 'adult', health_ack: true });
  const tallBand = await h.issueWristband(app, tall.id);
  const allow = await h.scan(app, {
    deviceId: devices[0].id,
    publicId: tallBand.public_id,
    at: '2026-09-16T10:01:00Z',
  });
  assert.deepEqual(allow, { decision: 'allow', reason_code: null });

  // 未知腕带也不泄露任何信息
  const unknown = await h.scan(app, {
    deviceId: devices[0].id,
    publicId: 'WB-does-not-exist',
    at: '2026-09-16T10:02:00Z',
  });
  assert.deepEqual(unknown, { decision: 'deny', reason_code: 'WRISTBAND_UNKNOWN' });
});
