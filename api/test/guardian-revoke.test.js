const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app, pool;
before(async () => ({ app, pool } = await h.setup()));
after(() => h.teardown());

test('监护撤回：撤回后后续项目重新判断为拒绝', async () => {
  const child = await h.createVisitor(app, { name: '测试儿童', height_cm: 130, age_band: 'child' });
  const parent = await h.createVisitor(app, { name: '测试家长', height_cm: 170, age_band: 'adult' });
  const band = await h.issueWristband(app, child.id);

  const { devices } = await h.createRideWithRules(app, pool, {
    min_height_cm: 120,
    allowed_age_bands: ['child', 'teen', 'adult'],
    requires_health_ack: false,
    guardian_required_for_age_bands: ['child'],
    interval_seconds: 0,
    window_minutes: 30,
    window_capacity: 100,
    max_entries_per_day: 0,
  });
  const gate = devices[0].id;
  const at = (min) => new Date(Date.parse('2026-09-16T09:00:00Z') + min * 60000).toISOString();

  // 无监护授权 → 拒绝
  assert.deepEqual(await h.scan(app, { deviceId: gate, publicId: band.public_id, at: at(0) }), {
    decision: 'deny',
    reason_code: 'GUARDIAN_REQUIRED',
  });

  // 建立监护关系 → 放行
  const created = await app.inject({
    method: 'POST',
    url: '/api/guardianships',
    payload: { guardian_id: parent.id, dependent_id: child.id },
  });
  assert.equal(created.statusCode, 200);
  const guardianship = created.json();
  assert.deepEqual(await h.scan(app, { deviceId: gate, publicId: band.public_id, at: at(1) }), {
    decision: 'allow',
    reason_code: null,
  });

  // 撤回授权 → 后续验票重新判断为拒绝
  const revoked = await app.inject({
    method: 'POST',
    url: `/api/guardianships/${guardianship.id}/revoke`,
  });
  assert.equal(revoked.statusCode, 200);
  assert.deepEqual(await h.scan(app, { deviceId: gate, publicId: band.public_id, at: at(2) }), {
    decision: 'deny',
    reason_code: 'GUARDIAN_REQUIRED',
  });

  // 撤回是独立事件
  const { rows: events } = await pool.query(
    `SELECT * FROM events WHERE type = 'guardianship_revoked' AND subject_id = $1`,
    [guardianship.id]
  );
  assert.equal(events.length, 1);
});
