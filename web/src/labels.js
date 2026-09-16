// 原因码 → 中文说明（闸机只返回原因码，文案在服务台侧映射）
export const REASON_LABELS = {
  DEVICE_UNKNOWN: '未知设备',
  DEVICE_DECOMMISSIONED: '设备已停用',
  RIDE_CLOSED: '项目已关闭',
  WRISTBAND_UNKNOWN: '未知腕带',
  WRISTBAND_INACTIVE: '腕带已停用',
  VISITOR_EXITED: '游客已离园',
  RULES_UNAVAILABLE: '规则不可用',
  HEIGHT_TOO_SHORT: '身高不足',
  AGE_BAND_NOT_ALLOWED: '年龄段不符',
  HEALTH_ACK_REQUIRED: '未确认健康提示',
  GUARDIAN_REQUIRED: '需要监护授权',
  DAILY_LIMIT_REACHED: '超出当日次数',
  INTERVAL_TOO_SOON: '间隔不足',
  CAPACITY_FULL: '时段已满',
};

export const AGE_BAND_LABELS = {
  child: '儿童',
  teen: '青少年',
  adult: '成人',
};

export const EVENT_LABELS = {
  device_decommissioned: '设备停用',
  ride_closed: '项目关闭',
  ride_opened: '项目开放',
  visitor_exited: '游客离园',
  wristband_reissued: '腕带补发',
  guardianship_revoked: '监护撤回',
  ruleset_published: '规则发布',
  visitor_created: '游客登记',
};

export function reasonLabel(code) {
  return code ? REASON_LABELS[code] || code : '—';
}

export function fmtTime(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('zh-CN', { hour12: false });
}
