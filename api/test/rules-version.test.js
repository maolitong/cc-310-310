const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const h = require('./helpers');

let app, pool;
before(async () => ({ app, pool } = await h.setup()));
after(() => h.teardown());

test('规则换版：核验引用发生时刻的规则版本，身高复测后重新判断', async () => {
  const visitor = await h.createVisitor(app, { height_cm: 110, age_band: 'teen' });
  const band = await h.issueWristband(app, visitor.id);

  const baseRules = {
    min_height_cm: 100,
    allowed_age_bands: ['teen', 'adult'],
    requires_health_ack: false,
    guardian_required_for_age_bands: [],
    interval_seconds: 0,
    window_minutes: 30,
    window_capacity: 100,
    max_entries_per_day: 0,
  };
  const { ride, devices } = await h.createRideWithRules(app, pool, baseRules, {
    effectiveFrom: '2026-01-01T00:00:00Z',
  });
  const gate = devices[0].id;

  // v1（身高 ≥ 100）：110cm 放行
  const r1 = await h.scan(app, { deviceId: gate, publicId: band.public_id, at: '2026-06-01T10:00:00Z' });
  assert.deepEqual(r1, { decision: 'allow', reason_code: null });

  // 发布 v2：2026-07-01 起身高要求提高到 120
  await app.inject({
    method: 'POST',
    url: `/api/rides/${ride.id}/rulesets`,
    payload: { rules: { ...baseRules, min_height_cm: 120 }, effective_from: '2026-07-01T00:00:00Z' },
  });

  // 换版后：110cm 拒绝，且引用 v2
  const r2 = await h.scan(app, { deviceId: gate, publicId: band.public_id, at: '2026-08-01T10:00:00Z' });
  assert.deepEqual(r2, { decision: 'deny', reason_code: 'HEIGHT_TOO_SHORT' });

  // 离线补传换版前发生的事件：仍按 v1 判定并引用 v1
  const r3 = await h.scan(app, {
    deviceId: gate,
    publicId: band.public_id,
    at: '2026-06-15T10:00:00Z',
    offline: true,
  });
  assert.deepEqual(r3, { decision: 'allow', reason_code: null });

  const { rows: logs } = await pool.query(
    `SELECT ruleset_version, decision FROM verifications
      WHERE visitor_id = $1 AND ride_id = $2 ORDER BY occurred_at`,
    [visitor.id, ride.id]
  );
  assert.deepEqual(
    logs.map((l) => [l.ruleset_version, l.decision]),
    [
      [1, 'allow'],
      [1, 'allow'],
      [2, 'deny'],
    ],
    '每条核验引用其发生时刻的规则版本'
  );

  // 身高复测后按新身高重新判断
  await app.inject({
    method: 'POST',
    url: `/api/visitors/${visitor.id}/measure`,
    payload: { height_cm: 125 },
  });
  const r4 = await h.scan(app, { deviceId: gate, publicId: band.public_id, at: '2026-08-01T11:00:00Z' });
  assert.deepEqual(r4, { decision: 'allow', reason_code: null });
});
