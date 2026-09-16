// 核验流水与事件查询（服务台视角）
async function logRoutes(app) {
  app.get('/api/verifications', async (req) => {
    const { decision, ride_id } = req.query || {};
    const limit = Math.min(parseInt(req.query.limit || '100', 10) || 100, 500);
    const conds = [];
    const params = [];
    if (decision) {
      params.push(decision);
      conds.push(`v.decision = $${params.length}`);
    }
    if (ride_id) {
      params.push(ride_id);
      conds.push(`v.ride_id = $${params.length}`);
    }
    params.push(limit);
    const { rows } = await app.pg.query(
      `SELECT v.id, v.client_event_id, v.wristband_public_id, v.decision, v.reason_code,
              v.ruleset_version, v.offline, v.occurred_at, v.received_at,
              d.name AS device_name, r.name AS ride_name
         FROM verifications v
         LEFT JOIN devices d ON d.id = v.device_id
         LEFT JOIN rides r ON r.id = v.ride_id
        ${conds.length ? 'WHERE ' + conds.join(' AND ') : ''}
        ORDER BY v.received_at DESC
        LIMIT $${params.length}`,
      params
    );
    return rows;
  });

  app.get('/api/events', async (req) => {
    const limit = Math.min(parseInt((req.query || {}).limit || '100', 10) || 100, 500);
    const { rows } = await app.pg.query(
      'SELECT * FROM events ORDER BY created_at DESC LIMIT $1',
      [limit]
    );
    return rows;
  });
}

module.exports = logRoutes;
