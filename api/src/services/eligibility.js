const { windowStart, currentRuleset, staticCheck, guardianRequired } = require('./rules');

// 服务台资格解释：对每项规则给出通过/未通过及细节（工作人员可见，闸机不可见）
async function explainEligibility(client, visitor, ride, at) {
  const ruleset = await currentRuleset(client, ride.id);
  const checks = [];
  const push = (key, label, pass, detail) => checks.push({ key, label, pass, detail });

  const { rows: bandRows } = await client.query(
    `SELECT public_id FROM wristbands WHERE visitor_id = $1 AND status = 'active'`,
    [visitor.id]
  );
  push('wristband', '有效腕带', bandRows.length > 0, bandRows[0] ? bandRows[0].public_id : '无有效腕带');
  push('ride_open', '项目开放', ride.status === 'open', ride.status === 'open' ? '开放中' : '已关闭');
  push('not_exited', '在园状态', !visitor.exited_at, visitor.exited_at ? '已离园' : '在园');

  if (!ruleset) {
    return { ruleset: null, checks, decision: 'deny', reason_code: 'RULES_UNAVAILABLE' };
  }
  const rules = ruleset.rules;

  push(
    'height',
    '身高要求',
    rules.min_height_cm == null || visitor.height_cm >= rules.min_height_cm,
    rules.min_height_cm == null
      ? '不限身高'
      : `${visitor.height_cm}cm / 要求 ≥ ${rules.min_height_cm}cm`
  );
  push(
    'age_band',
    '年龄段',
    !rules.allowed_age_bands?.length || rules.allowed_age_bands.includes(visitor.age_band),
    !rules.allowed_age_bands?.length
      ? '不限年龄段'
      : `${visitor.age_band} / 允许 ${rules.allowed_age_bands.join(', ')}`
  );
  push(
    'health_ack',
    '健康提示确认',
    !rules.requires_health_ack || visitor.health_ack,
    rules.requires_health_ack ? (visitor.health_ack ? '已确认' : '未确认') : '无需确认'
  );

  if (guardianRequired(visitor, rules)) {
    const { rows: g } = await client.query(
      `SELECT v.name FROM guardianships gs JOIN visitors v ON v.id = gs.guardian_id
        WHERE gs.dependent_id = $1 AND gs.status = 'active' LIMIT 1`,
      [visitor.id]
    );
    push('guardian', '监护授权', g.length > 0, g[0] ? `监护人：${g[0].name}` : '无有效监护授权');
  } else {
    push('guardian', '监护授权', true, '该年龄段无需监护');
  }

  if (rules.max_entries_per_day) {
    const { rows: c } = await client.query(
      `SELECT count(*)::int AS n FROM ride_entries
        WHERE visitor_id = $1 AND ride_id = $2
          AND occurred_at >= date_trunc('day', $3::timestamptz)
          AND occurred_at <  date_trunc('day', $3::timestamptz) + interval '1 day'`,
      [visitor.id, ride.id, at]
    );
    push('daily_limit', '当日次数', c[0].n < rules.max_entries_per_day, `${c[0].n} / ${rules.max_entries_per_day} 次`);
  }

  if (rules.interval_seconds) {
    const { rows: last } = await client.query(
      `SELECT occurred_at FROM ride_entries
        WHERE visitor_id = $1 AND ride_id = $2
        ORDER BY occurred_at DESC LIMIT 1`,
      [visitor.id, ride.id]
    );
    const wait = last[0]
      ? rules.interval_seconds - Math.floor((at.getTime() - new Date(last[0].occurred_at).getTime()) / 1000)
      : 0;
    push(
      'interval',
      '连续乘坐间隔',
      wait <= 0,
      last[0] ? (wait > 0 ? `还需等待 ${wait}s` : '间隔已满足') : '首次乘坐'
    );
  }

  if (rules.window_capacity && rules.window_minutes) {
    const ws = windowStart(at, rules.window_minutes);
    const { rows: cap } = await client.query(
      'SELECT used FROM capacity_windows WHERE ride_id = $1 AND window_start = $2',
      [ride.id, ws]
    );
    const used = cap[0] ? cap[0].used : 0;
    push('capacity', '时段容量', used < rules.window_capacity, `${used} / ${rules.window_capacity}`);
  }

  const ORDER = {
    wristband: 'WRISTBAND_INACTIVE',
    ride_open: 'RIDE_CLOSED',
    not_exited: 'VISITOR_EXITED',
    height: 'HEIGHT_TOO_SHORT',
    age_band: 'AGE_BAND_NOT_ALLOWED',
    health_ack: 'HEALTH_ACK_REQUIRED',
    guardian: 'GUARDIAN_REQUIRED',
    daily_limit: 'DAILY_LIMIT_REACHED',
    interval: 'INTERVAL_TOO_SOON',
    capacity: 'CAPACITY_FULL',
  };
  const failed = checks.find((c) => !c.pass);
  return {
    ruleset: { version: ruleset.version, effective_from: ruleset.effective_from, rules },
    checks,
    decision: failed ? 'deny' : 'allow',
    reason_code: failed ? ORDER[failed.key] || 'DENIED' : null,
  };
}

module.exports = { explainEligibility };
