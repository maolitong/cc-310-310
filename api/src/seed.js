const crypto = require('crypto');
const { processVerification } = require('./services/verify');

// 演示数据：游客均为虚构。仅在 visitors 为空时生成。
async function seedIfEmpty(pool, redis) {
  const { rows } = await pool.query('SELECT 1 FROM visitors LIMIT 1');
  if (rows.length) return;
  console.log('[seed] creating demo data...');
  const client = await pool.connect();
  const ids = {};
  try {
    await client.query('BEGIN');

    const addVisitor = async (name, height, band, ack) => {
      const { rows: v } = await client.query(
        'INSERT INTO visitors (name, height_cm, age_band, health_ack) VALUES ($1,$2,$3,$4) RETURNING id',
        [name, height, band, ack]
      );
      const publicId = 'WB-' + crypto.randomBytes(8).toString('hex');
      await client.query('INSERT INTO wristbands (public_id, visitor_id) VALUES ($1,$2)', [
        publicId,
        v[0].id,
      ]);
      return { id: v[0].id, publicId };
    };

    ids.amei = await addVisitor('林阿梅', 165, 'adult', true);
    ids.xiaojie = await addVisitor('林小杰', 118, 'child', true);
    ids.niuniu = await addVisitor('赵妞妞', 126, 'child', false);
    ids.dayong = await addVisitor('陈大勇', 158, 'teen', true);
    ids.laowang = await addVisitor('王守财', 172, 'adult', false);
    ids.xiaochen = await addVisitor('陈晓风', 160, 'adult', true);

    await client.query(
      'INSERT INTO guardianships (guardian_id, dependent_id) VALUES ($1,$2)',
      [ids.amei.id, ids.xiaojie.id]
    );

    const addRide = async (code, name) => {
      const { rows: r } = await client.query(
        'INSERT INTO rides (code, name) VALUES ($1,$2) RETURNING id',
        [code, name]
      );
      return r[0].id;
    };
    const carousel = await addRide('carousel', '旋转木马');
    const coaster = await addRide('coaster', '云霄飞车');
    const rapids = await addRide('rapids', '激流勇进');
    ids.rides = { carousel, coaster, rapids };

    const addRuleset = (rideId, version, rules, effectiveFrom) =>
      client.query(
        'INSERT INTO ride_rulesets (ride_id, version, rules, effective_from) VALUES ($1,$2,$3,$4)',
        [rideId, version, JSON.stringify(rules), effectiveFrom]
      );

    await addRuleset(carousel, 1, {
      min_height_cm: 90,
      allowed_age_bands: ['child', 'teen', 'adult'],
      requires_health_ack: false,
      guardian_required_for_age_bands: [],
      interval_seconds: 0,
      window_minutes: 30,
      window_capacity: 40,
      max_entries_per_day: 0,
    }, '2026-01-01T00:00:00Z');

    // 云霄飞车：v1 身高 140，v2 自 2026-09-01 起放宽到 130（演示规则换版）
    await addRuleset(coaster, 1, {
      min_height_cm: 140,
      allowed_age_bands: ['teen', 'adult'],
      requires_health_ack: true,
      guardian_required_for_age_bands: [],
      interval_seconds: 300,
      window_minutes: 30,
      window_capacity: 4,
      max_entries_per_day: 6,
    }, '2026-01-01T00:00:00Z');
    await addRuleset(coaster, 2, {
      min_height_cm: 130,
      allowed_age_bands: ['teen', 'adult'],
      requires_health_ack: true,
      guardian_required_for_age_bands: [],
      interval_seconds: 300,
      window_minutes: 30,
      window_capacity: 4,
      max_entries_per_day: 6,
    }, '2026-09-01T00:00:00Z');

    await addRuleset(rapids, 1, {
      min_height_cm: 120,
      allowed_age_bands: ['child', 'teen', 'adult'],
      requires_health_ack: true,
      guardian_required_for_age_bands: ['child'],
      interval_seconds: 120,
      window_minutes: 15,
      window_capacity: 6,
      max_entries_per_day: 4,
    }, '2026-01-01T00:00:00Z');

    const addDevice = async (rideId, name) => {
      const { rows: d } = await client.query(
        'INSERT INTO devices (ride_id, name) VALUES ($1,$2) RETURNING id',
        [rideId, name]
      );
      return d[0].id;
    };
    ids.devices = {
      carouselA: await addDevice(carousel, '木马闸机A'),
      coasterA: await addDevice(coaster, '飞车闸机A'),
      coasterB: await addDevice(coaster, '飞车闸机B'),
      rapidsA: await addDevice(rapids, '激流闸机A'),
    };

    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }

  // 演示核验流水：通过真实核验逻辑产生（含放行与拒绝）
  const scans = [
    ['seed-1', ids.devices.coasterA, ids.dayong.publicId, -50],
    ['seed-2', ids.devices.coasterB, ids.xiaochen.publicId, -45],
    ['seed-3', ids.devices.coasterA, ids.laowang.publicId, -40], // 未确认健康提示 → 拒绝
    ['seed-4', ids.devices.rapidsA, ids.xiaojie.publicId, -30], // 118cm < 120 → 拒绝
    ['seed-5', ids.devices.rapidsA, ids.niuniu.publicId, -25], // 未确认健康提示 → 拒绝
    ['seed-6', ids.devices.carouselA, ids.xiaojie.publicId, -20],
  ];
  for (const [eventId, deviceId, publicId, offsetMin] of scans) {
    await processVerification(pool, redis, {
      client_event_id: eventId,
      device_id: deviceId,
      wristband_public_id: publicId,
      occurred_at: new Date(Date.now() + offsetMin * 60000).toISOString(),
    });
  }
  console.log('[seed] demo data ready');
}

module.exports = { seedIfEmpty };
