const { windowStart, currentRuleset } = require('../services/rules');

const RULE_KEYS = [
  'min_height_cm',
  'allowed_age_bands',
  'requires_health_ack',
  'guardian_required_for_age_bands',
  'interval_seconds',
  'window_minutes',
  'window_capacity',
  'max_entries_per_day',
];

// 项目：状态、规则版本、时段容量
async function rideRoutes(app) {
  app.get('/api/rides', async () => {
    const { rows: rides } = await app.pg.query('SELECT * FROM rides ORDER BY code');
    const now = new Date();
    const out = [];
    for (const ride of rides) {
      const rs = await currentRuleset(app.pg, ride.id);
      let usage = null;
      if (rs && rs.rules.window_capacity && rs.rules.window_minutes) {
        const ws = windowStart(now, rs.rules.window_minutes);
        const { rows } = await app.pg.query(
          'SELECT used FROM capacity_windows WHERE ride_id = $1 AND window_start = $2',
          [ride.id, ws]
        );
        usage = {
          window_start: ws,
          used: rows[0] ? rows[0].used : 0,
          capacity: rs.rules.window_capacity,
        };
      }
      out.push({ ...ride, current_ruleset: rs || null, current_window: usage });
    }
    return out;
  });

  // 发布新规则版本；effective_from 缺省为现在
  app.post('/api/rides/:id/rulesets', async (req, reply) => {
    const { rules, effective_from } = req.body || {};
    if (!rules || typeof rules !== 'object') {
      return reply.code(400).send({ error: 'rules object required' });
    }
    const bad = Object.keys(rules).filter((k) => !RULE_KEYS.includes(k));
    if (bad.length) return reply.code(400).send({ error: `unknown rule keys: ${bad.join(', ')}` });
    const effectiveFrom = effective_from ? new Date(effective_from) : new Date();
    if (Number.isNaN(effectiveFrom.getTime())) {
      return reply.code(400).send({ error: 'effective_from must be an ISO timestamp' });
    }
    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      const { rows: r } = await client.query('SELECT id FROM rides WHERE id = $1 FOR UPDATE', [
        req.params.id,
      ]);
      if (!r[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'ride not found' });
      }
      const { rows: v } = await client.query(
        'SELECT COALESCE(MAX(version), 0) + 1 AS next FROM ride_rulesets WHERE ride_id = $1',
        [req.params.id]
      );
      const { rows } = await client.query(
        `INSERT INTO ride_rulesets (ride_id, version, rules, effective_from)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [req.params.id, v[0].next, JSON.stringify(rules), effectiveFrom]
      );
      await client.query(
        `INSERT INTO events (type, subject_id, detail) VALUES ('ruleset_published', $1, $2)`,
        [req.params.id, JSON.stringify({ version: v[0].next, effective_from: effectiveFrom })]
      );
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.get('/api/rides/:id/rulesets', async (req) => {
    const { rows } = await app.pg.query(
      'SELECT * FROM ride_rulesets WHERE ride_id = $1 ORDER BY version DESC',
      [req.params.id]
    );
    return rows;
  });

  app.get('/api/rides/:id/capacity', async (req, reply) => {
    const { rows: r } = await app.pg.query('SELECT * FROM rides WHERE id = $1', [req.params.id]);
    if (!r[0]) return reply.code(404).send({ error: 'ride not found' });
    const { rows } = await app.pg.query(
      'SELECT window_start, used FROM capacity_windows WHERE ride_id = $1 ORDER BY window_start DESC LIMIT 24',
      [req.params.id]
    );
    return rows;
  });

  for (const action of ['close', 'open']) {
    app.post(`/api/rides/:id/${action}`, async (req, reply) => {
      const status = action === 'close' ? 'closed' : 'open';
      const client = await app.pg.connect();
      try {
        await client.query('BEGIN');
        const { rows } = await client.query(
          'UPDATE rides SET status = $1 WHERE id = $2 RETURNING *',
          [status, req.params.id]
        );
        if (!rows[0]) {
          await client.query('ROLLBACK');
          return reply.code(404).send({ error: 'ride not found' });
        }
        await client.query(`INSERT INTO events (type, subject_id, detail) VALUES ($1, $2, $3)`, [
          action === 'close' ? 'ride_closed' : 'ride_opened',
          req.params.id,
          JSON.stringify({ name: rows[0].name }),
        ]);
        await client.query('COMMIT');
        await app.redis.del(`ride:${req.params.id}`);
        return rows[0];
      } catch (e) {
        await client.query('ROLLBACK');
        throw e;
      } finally {
        client.release();
      }
    });
  }
}

module.exports = rideRoutes;
