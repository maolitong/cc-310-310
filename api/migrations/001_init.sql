-- 游乐园腕带系统初始 schema
-- 腕带只保存随机标识；身高、年龄段、健康确认、监护授权均在服务端维护。

CREATE TABLE visitors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  height_cm   int  NOT NULL CHECK (height_cm > 0),
  age_band    text NOT NULL CHECK (age_band IN ('child','teen','adult')),
  health_ack  boolean NOT NULL DEFAULT false,
  exited_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wristbands (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  public_id     text NOT NULL UNIQUE,           -- 腕带上的随机标识，不含任何个人信息
  visitor_id    uuid NOT NULL REFERENCES visitors(id),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active','deactivated')),
  issued_at     timestamptz NOT NULL DEFAULT now(),
  deactivated_at timestamptz,
  replaced_by   uuid REFERENCES wristbands(id)
);
-- 同一游客同一时刻最多一条有效腕带（补发竞态的数据库兜底）
CREATE UNIQUE INDEX wristbands_one_active ON wristbands(visitor_id) WHERE status = 'active';

CREATE TABLE guardianships (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_id  uuid NOT NULL REFERENCES visitors(id),
  dependent_id uuid NOT NULL REFERENCES visitors(id),
  status       text NOT NULL DEFAULT 'active' CHECK (status IN ('active','revoked')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  revoked_at   timestamptz,
  CHECK (guardian_id <> dependent_id)
);
CREATE INDEX guardianships_dependent_active ON guardianships(dependent_id) WHERE status = 'active';

CREATE TABLE rides (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code       text NOT NULL UNIQUE,
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 资格规则按项目版本化；核验引用 occurred_at 时刻生效的版本
CREATE TABLE ride_rulesets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id        uuid NOT NULL REFERENCES rides(id),
  version        int  NOT NULL,
  rules          jsonb NOT NULL,
  effective_from timestamptz NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ride_id, version)
);
CREATE INDEX ride_rulesets_effective ON ride_rulesets(ride_id, effective_from);

CREATE TABLE devices (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ride_id    uuid NOT NULL REFERENCES rides(id),
  name       text NOT NULL,
  status     text NOT NULL DEFAULT 'active' CHECK (status IN ('active','decommissioned')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 核验流水：每次验票（含离线补传）一条，client_event_id 幂等去重
CREATE TABLE verifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_event_id  text NOT NULL UNIQUE,
  device_id        uuid REFERENCES devices(id),
  ride_id          uuid REFERENCES rides(id),
  wristband_public_id text NOT NULL,
  visitor_id       uuid REFERENCES visitors(id),
  decision         text NOT NULL CHECK (decision IN ('allow','deny')),
  reason_code      text,
  ruleset_version  int,
  offline          boolean NOT NULL DEFAULT false,
  occurred_at      timestamptz NOT NULL,
  received_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX verifications_ride_time ON verifications(ride_id, occurred_at);

-- 放行记录：容量/间隔/当日次数只统计 allow 产生的 entry
CREATE TABLE ride_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  verification_id uuid NOT NULL UNIQUE REFERENCES verifications(id),
  visitor_id      uuid NOT NULL REFERENCES visitors(id),
  ride_id         uuid NOT NULL REFERENCES rides(id),
  window_start    timestamptz NOT NULL,
  occurred_at     timestamptz NOT NULL
);
CREATE INDEX ride_entries_visitor_ride ON ride_entries(visitor_id, ride_id, occurred_at);

-- 时段容量：原子条件自增，两个闸机并发不会超限
CREATE TABLE capacity_windows (
  ride_id      uuid NOT NULL REFERENCES rides(id),
  window_start timestamptz NOT NULL,
  used         int NOT NULL DEFAULT 0 CHECK (used >= 0),
  PRIMARY KEY (ride_id, window_start)
);

-- 设备停用 / 项目关闭 / 游客退出等均为独立事件
CREATE TABLE events (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type       text NOT NULL CHECK (type IN (
    'device_decommissioned','ride_closed','ride_opened',
    'visitor_exited','wristband_reissued','guardianship_revoked',
    'ruleset_published','visitor_created'
  )),
  subject_id uuid,
  detail     jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
