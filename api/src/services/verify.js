const { windowStart, selectRuleset, staticCheck, guardianRequired } = require('./rules');

// 闸机响应只包含放行结果或拒绝原因码（信息最小化），不含身高/年龄等个人数据
function gateReply(decision, reasonCode) {
  return { decision, reason_code: reasonCode };
}

/**
 * 处理一次闸机验票。
 * - client_event_id 幂等：重复上传直接返回首次结果，不重复扣减容量/次数
 * - 离线乱序：以 occurred_at 选择当时生效的规则版本、容量窗口与间隔判断
 * - 容量：capacity_windows 原子条件自增，两闸机并发不超限
 * - 间隔/当日次数：同一游客+项目 advisory 锁串行化
 */
async function processVerification(pool, redis, payload) {
  const clientEventId = payload.client_event_id;
  const occurredAt = new Date(payload.occurred_at || Date.now());
  const offline = !!payload.offline;

  // 幂等：已处理过的事件直接返回首次判定
  const existing = await pool.query(
    'SELECT decision, reason_code FROM verifications WHERE client_event_id = $1',
    [clientEventId]
  );
  if (existing.rows[0]) return gateReply(existing.rows[0].decision, existing.rows[0].reason_code);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const device = await getDevice(client, redis, payload.device_id);
    const base = {
      clientEventId,
      publicId: payload.wristband_public_id,
      occurredAt,
      offline,
      deviceId: device ? device.id : null,
      rideId: device ? device.ride_id : null,
    };

    if (!device) return await recordDeny(client, base, 'DEVICE_UNKNOWN');
    if (device.status !== 'active') return await recordDeny(client, base, 'DEVICE_DECOMMISSIONED');

    const ride = await getRide(client, redis, device.ride_id);
    if (!ride || ride.status !== 'open') return await recordDeny(client, base, 'RIDE_CLOSED');

    const { rows: bandRows } = await client.query(
      'SELECT * FROM wristbands WHERE public_id = $1',
      [payload.wristband_public_id]
    );
    const band = bandRows[0];
    if (!band) return await recordDeny(client, base, 'WRISTBAND_UNKNOWN');
    // 补发后旧带立即停用；离线补传的旧带记录仍保存，但不产生 entry、不扣容量
    if (band.status !== 'active') {
      return await recordDeny(client, { ...base, visitorId: band.visitor_id }, 'WRISTBAND_INACTIVE');
    }

    const { rows: visitorRows } = await client.query('SELECT * FROM visitors WHERE id = $1', [
      band.visitor_id,
    ]);
    const visitor = visitorRows[0];
    const withVisitor = { ...base, visitorId: visitor.id };
    if (visitor.exited_at) return await recordDeny(client, withVisitor, 'VISITOR_EXITED');

    // 规则按 occurred_at 时刻的版本判定
    const ruleset = await selectRuleset(client, ride.id, occurredAt);
    if (!ruleset) return await recordDeny(client, withVisitor, 'RULES_UNAVAILABLE');
    const rules = ruleset.rules;
    const scoped = { ...withVisitor, rulesetVersion: ruleset.version };

    const staticFail = staticCheck(visitor, rules);
    if (staticFail) return await recordDeny(client, scoped, staticFail);

    if (guardianRequired(visitor, rules)) {
      const { rows: g } = await client.query(
        `SELECT 1 FROM guardianships WHERE dependent_id = $1 AND status = 'active' LIMIT 1`,
        [visitor.id]
      );
      if (!g[0]) return await recordDeny(client, scoped, 'GUARDIAN_REQUIRED');
    }

    // 同一游客在同一项目上的间隔/次数判断串行化，防止两处闸机并发同时通过
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
      `${visitor.id}:${ride.id}`,
    ]);

    if (rules.max_entries_per_day) {
      const { rows: c } = await client.query(
        `SELECT count(*)::int AS n FROM ride_entries
          WHERE visitor_id = $1 AND ride_id = $2
            AND occurred_at >= date_trunc('day', $3::timestamptz)
            AND occurred_at <  date_trunc('day', $3::timestamptz) + interval '1 day'`,
        [visitor.id, ride.id, occurredAt]
      );
      if (c[0].n >= rules.max_entries_per_day) {
        return await recordDeny(client, scoped, 'DAILY_LIMIT_REACHED');
      }
    }

    if (rules.interval_seconds) {
      // 与任一已放行记录相距不足 interval 即拒绝；恰好等于 interval 放行（边界含等号）
      const { rows: near } = await client.query(
        `SELECT 1 FROM ride_entries
          WHERE visitor_id = $1 AND ride_id = $2
            AND occurred_at >  $3::timestamptz - make_interval(secs => $4)
            AND occurred_at <  $3::timestamptz + make_interval(secs => $4)
          LIMIT 1`,
        [visitor.id, ride.id, occurredAt, rules.interval_seconds]
      );
      if (near[0]) return await recordDeny(client, scoped, 'INTERVAL_TOO_SOON');
    }

    let ws = occurredAt;
    if (rules.window_capacity && rules.window_minutes) {
      ws = windowStart(occurredAt, rules.window_minutes);
      // 原子占用一个容量名额；超限时更新不生效、返回空
      const { rows: cap } = await client.query(
        `INSERT INTO capacity_windows (ride_id, window_start, used) VALUES ($1, $2, 1)
         ON CONFLICT (ride_id, window_start) DO UPDATE
            SET used = capacity_windows.used + 1
          WHERE capacity_windows.used < $3
        RETURNING used`,
        [ride.id, ws, rules.window_capacity]
      );
      if (!cap[0]) return await recordDeny(client, scoped, 'CAPACITY_FULL');
    }

    const { rows: v } = await client.query(
      `INSERT INTO verifications
         (client_event_id, device_id, ride_id, wristband_public_id, visitor_id,
          decision, reason_code, ruleset_version, offline, occurred_at)
       VALUES ($1,$2,$3,$4,$5,'allow',NULL,$6,$7,$8)
       RETURNING id`,
      [
        clientEventId,
        base.deviceId,
        base.rideId,
        base.publicId,
        scoped.visitorId,
        ruleset.version,
        offline,
        occurredAt,
      ]
    );
    await client.query(
      `INSERT INTO ride_entries (verification_id, visitor_id, ride_id, window_start, occurred_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [v[0].id, visitor.id, ride.id, ws, occurredAt]
    );
    await client.query('COMMIT');
    return gateReply('allow', null);
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    // 并发重复上传同一 client_event_id：回滚本次占用，返回首次结果
    if (e.code === '23505' && String(e.constraint || '').includes('client_event_id')) {
      const again = await pool.query(
        'SELECT decision, reason_code FROM verifications WHERE client_event_id = $1',
        [clientEventId]
      );
      if (again.rows[0]) return gateReply(again.rows[0].decision, again.rows[0].reason_code);
    }
    throw e;
  } finally {
    client.release();
  }
}

async function recordDeny(client, scope, reasonCode) {
  await client.query(
    `INSERT INTO verifications
       (client_event_id, device_id, ride_id, wristband_public_id, visitor_id,
        decision, reason_code, ruleset_version, offline, occurred_at)
     VALUES ($1,$2,$3,$4,$5,'deny',$6,$7,$8,$9)`,
    [
      scope.clientEventId,
      scope.deviceId || null,
      scope.rideId || null,
      scope.publicId,
      scope.visitorId || null,
      reasonCode,
      scope.rulesetVersion || null,
      scope.offline,
      scope.occurredAt,
    ]
  );
  await client.query('COMMIT');
  return gateReply('deny', reasonCode);
}

// 设备/项目状态走 Redis 缓存，变更端点负责失效
async function getDevice(client, redis, id) {
  if (!id) return null;
  const key = `device:${id}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  const { rows } = await client.query('SELECT * FROM devices WHERE id = $1', [id]);
  if (rows[0]) await redis.set(key, JSON.stringify(rows[0]), 'EX', 60);
  return rows[0] || null;
}

async function getRide(client, redis, id) {
  const key = `ride:${id}`;
  const cached = await redis.get(key);
  if (cached) return JSON.parse(cached);
  const { rows } = await client.query('SELECT * FROM rides WHERE id = $1', [id]);
  if (rows[0]) await redis.set(key, JSON.stringify(rows[0]), 'EX', 60);
  return rows[0] || null;
}

module.exports = { processVerification };
