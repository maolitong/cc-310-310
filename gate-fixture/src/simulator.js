// 闸机模拟器：演示在线验票、离线缓存乱序补传、补发后旧带记录上传。
// 所有 client_event_id 均为确定性取值，重复运行幂等。
const API = process.env.API_URL || 'http://localhost:3000';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function req(method, path, body) {
  const res = await fetch(API + path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

async function waitHealthy() {
  for (let i = 0; i < 60; i++) {
    try {
      await req('GET', '/healthz');
      console.log('[fixture] api healthy');
      return;
    } catch {
      await sleep(1000);
    }
  }
  throw new Error('api not healthy in time');
}

function show(tag, res) {
  console.log(`[fixture] ${tag} -> ${res.decision}${res.reason_code ? ' (' + res.reason_code + ')' : ''}`);
}

async function scan(eventId, deviceId, publicId, occurredAt, offline = false) {
  return req('POST', '/api/gates/verify', {
    client_event_id: eventId,
    device_id: deviceId,
    wristband_public_id: publicId,
    occurred_at: occurredAt,
    offline,
  });
}

async function main() {
  await waitHealthy();

  const [rides, devices, visitors] = await Promise.all([
    req('GET', '/api/rides'),
    req('GET', '/api/devices'),
    req('GET', '/api/visitors'),
  ]);
  const coaster = rides.find((r) => r.code === 'coaster');
  const coasterGates = devices.filter((d) => d.ride_id === coaster.id && d.status === 'active');
  if (coasterGates.length < 2) throw new Error('expected two active coaster gates');
  const [gateA, gateB] = coasterGates;

  // ---- 场景 1：在线验票（两个闸机轮流）----
  console.log('[fixture] --- 在线验票 ---');
  let n = 0;
  for (const v of visitors.filter((x) => x.wristband_public_id)) {
    const gate = n % 2 === 0 ? gateA : gateB;
    const res = await scan(`fixture-online-${n}`, gate.id, v.wristband_public_id, new Date().toISOString());
    show(`在线 ${v.name} @${gate.name}`, res);
    n++;
  }

  // ---- 场景 2：离线缓存，恢复后乱序补传 ----
  console.log('[fixture] --- 离线乱序补传 ---');
  const dayong = visitors.find((v) => v.name === '陈大勇');
  const base = Date.now() - 2 * 3600 * 1000; // 两小时前离线缓存
  const offlineEvents = [0, 1, 2].map((i) => ({
    id: `fixture-offline-${i}`,
    at: new Date(base + i * 301 * 1000).toISOString(), // 间隔 301s，满足 300s 连续乘坐间隔
  }));
  for (const e of [...offlineEvents].reverse()) {
    const res = await scan(e.id, gateB.id, dayong.wristband_public_id, e.at, true);
    show(`离线补传 ${e.id}`, res);
  }
  // 重复补传第一条：应返回首次结果且不重复扣减
  const dup = await scan(offlineEvents[0].id, gateB.id, dayong.wristband_public_id, offlineEvents[0].at, true);
  show(`重复补传 ${offlineEvents[0].id}`, dup);

  // ---- 场景 3：补发腕带后，旧带的离线记录仍上传保存 ----
  console.log('[fixture] --- 补发后旧带记录 ---');
  const xiaochen = visitors.find((v) => v.name === '陈晓风');
  const oldBand = xiaochen.wristband_public_id;
  const staleEvent = {
    id: 'fixture-stale-0',
    at: new Date(Date.now() - 30 * 60000).toISOString(),
  };
  await req('POST', `/api/visitors/${xiaochen.id}/wristbands`); // 服务台补发，旧带立即停用
  const stale = await scan(staleEvent.id, gateA.id, oldBand, staleEvent.at, true);
  show('旧带离线记录（应保存为拒绝）', stale);

  console.log('[fixture] 场景演示完成');
}

main().catch((e) => {
  console.error('[fixture] failed:', e.message);
  process.exit(1);
});
