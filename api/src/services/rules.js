// 时段窗口起点：把 occurred_at 向下取整到 windowMinutes 边界
function windowStart(date, windowMinutes) {
  const ms = windowMinutes * 60000;
  return new Date(Math.floor(date.getTime() / ms) * ms);
}

// 选取 at 时刻生效的规则版本（effective_from <= at 中版本最大者）
async function selectRuleset(client, rideId, at) {
  const { rows } = await client.query(
    `SELECT id, ride_id, version, rules, effective_from
       FROM ride_rulesets
      WHERE ride_id = $1 AND effective_from <= $2
      ORDER BY version DESC
      LIMIT 1`,
    [rideId, at]
  );
  return rows[0] || null;
}

async function currentRuleset(client, rideId) {
  return selectRuleset(client, rideId, new Date());
}

// 静态资格检查（身高/年龄段/健康确认/监护授权），返回第一项失败或 null
function staticCheck(visitor, rules) {
  if (rules.min_height_cm != null && visitor.height_cm < rules.min_height_cm) {
    return 'HEIGHT_TOO_SHORT';
  }
  if (
    Array.isArray(rules.allowed_age_bands) &&
    rules.allowed_age_bands.length > 0 &&
    !rules.allowed_age_bands.includes(visitor.age_band)
  ) {
    return 'AGE_BAND_NOT_ALLOWED';
  }
  if (rules.requires_health_ack && !visitor.health_ack) {
    return 'HEALTH_ACK_REQUIRED';
  }
  return null;
}

function guardianRequired(visitor, rules) {
  return (
    Array.isArray(rules.guardian_required_for_age_bands) &&
    rules.guardian_required_for_age_bands.includes(visitor.age_band)
  );
}

module.exports = { windowStart, selectRuleset, currentRuleset, staticCheck, guardianRequired };
