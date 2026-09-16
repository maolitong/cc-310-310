# 游乐园腕带核验系统

腕带只保存随机标识；票种相关数据（身高、年龄段、健康提示确认、监护授权）全部在服务端维护。资格规则按项目版本化，每次核验引用**发生时刻**生效的规则版本；身高复测或监护授权撤回后，后续项目实时重新判断。闸机端只收到「放行 / 拒绝原因码」，不接触任何个人数据。

## 启动

```bash
docker compose up --build
```

自动完成：数据库迁移 → 生成虚构演示游客/项目/闸机 → 健康检查 → 闸机模拟器跑一遍演示场景（在线验票、离线乱序补传、补发后旧带记录上传）。

- 服务台页面：http://localhost:8080 （腕带服务台 / 监护关系 / 资格解释 / 项目容量 / 设备状态 / 核验流水）
- API：http://localhost:3000 （`GET /healthz`）

## 测试

```bash
docker compose --profile test up --build --abort-on-container-exit test
```

覆盖：补带竞态、离线乱序、规则换版（含身高复测）、容量并发、间隔边界、监护撤回、信息最小化。

## 架构

```
web (Vue3 + nginx) ──► api (Fastify) ──► PostgreSQL（核验、容量、流水、事件）
gate-fixture (模拟闸机) ──► api          └─► Redis（设备/项目状态缓存）
```

### 关键设计

| 需求 | 实现 |
| --- | --- |
| 腕带只存随机标识 | `wristbands.public_id` 随机 hex，个人数据在 `visitors` |
| 规则版本化 | `ride_rulesets(version, effective_from)`，核验按 `occurred_at` 选版 |
| 信息最小化 | `POST /api/gates/verify` 响应仅 `{decision, reason_code}` |
| 补带竞态 | 游客行锁 + `wristbands_one_active` 部分唯一索引；旧带立即停用 |
| 离线乱序 | `client_event_id` 唯一约束幂等去重；旧带记录保存但不产生 entry、不占容量 |
| 时段容量并发 | `capacity_windows` 原子条件自增（`ON CONFLICT ... WHERE used < cap`），两闸机不超限 |
| 连续乘坐间隔 | 同游客+项目 advisory 锁串行化；与任一记录相距 `< interval` 拒绝，`=` 放行 |
| 单独事件 | `events` 表：设备停用 / 项目关闭开放 / 游客离园 / 补带 / 监护撤回 / 规则发布 |

### 主要接口

- `POST /api/gates/verify` — 闸机验票（幂等，支持离线补传 `occurred_at` + `offline`）
- `GET/POST /api/visitors`、`POST /api/visitors/:id/wristbands`（发放/补发）、`/measure`（身高复测）、`/exit`（离园）
- `GET/POST /api/guardianships`、`POST /api/guardianships/:id/revoke`
- `GET /api/rides`、`POST /api/rides/:id/rulesets`（新版本）、`/close`、`/open`、`GET /api/rides/:id/capacity`
- `GET /api/devices`、`POST /api/devices/:id/decommission`
- `GET /api/visitors/:id/eligibility/:rideId` — 资格解释（服务台可见明细）
- `GET /api/verifications`、`GET /api/events`

### 拒绝原因码

`WRISTBAND_UNKNOWN/INACTIVE`、`DEVICE_UNKNOWN/DECOMMISSIONED`、`RIDE_CLOSED`、`VISITOR_EXITED`、`RULES_UNAVAILABLE`、`HEIGHT_TOO_SHORT`、`AGE_BAND_NOT_ALLOWED`、`HEALTH_ACK_REQUIRED`、`GUARDIAN_REQUIRED`、`DAILY_LIMIT_REACHED`、`INTERVAL_TOO_SOON`、`CAPACITY_FULL`
