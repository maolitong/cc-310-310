const crypto = require('crypto');
const { explainEligibility } = require('../services/eligibility');

// 服务台：游客、腕带发放/补发、身高复测、中途退出、资格解释
async function visitorRoutes(app) {
  app.get('/api/visitors', async () => {
    const { rows } = await app.pg.query(
      `SELECT v.id, v.name, v.height_cm, v.age_band, v.health_ack, v.exited_at, v.created_at,
              w.public_id AS wristband_public_id
         FROM visitors v
         LEFT JOIN wristbands w ON w.visitor_id = v.id AND w.status = 'active'
        ORDER BY v.created_at`
    );
    return rows;
  });

  app.post('/api/visitors', async (req, reply) => {
    const { name, height_cm, age_band, health_ack } = req.body || {};
    if (!name || !height_cm || !['child', 'teen', 'adult'].includes(age_band)) {
      return reply.code(400).send({ error: 'name, height_cm, age_band(child|teen|adult) required' });
    }
    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO visitors (name, height_cm, age_band, health_ack) VALUES ($1,$2,$3,$4) RETURNING *`,
        [name, height_cm, age_band, !!health_ack]
      );
      await client.query(`INSERT INTO events (type, subject_id, detail) VALUES ('visitor_created', $1, $2)`, [
        rows[0].id,
        JSON.stringify({ name }),
      ]);
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // 身高复测：后续项目按新身高重新判断
  app.post('/api/visitors/:id/measure', async (req, reply) => {
    const { height_cm } = req.body || {};
    if (!height_cm || height_cm <= 0) return reply.code(400).send({ error: 'height_cm required' });
    const { rows } = await app.pg.query(
      'UPDATE visitors SET height_cm = $1 WHERE id = $2 RETURNING *',
      [height_cm, req.params.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'visitor not found' });
    return rows[0];
  });

  app.post('/api/visitors/:id/health-ack', async (req, reply) => {
    const { rows } = await app.pg.query(
      'UPDATE visitors SET health_ack = true WHERE id = $1 RETURNING *',
      [req.params.id]
    );
    if (!rows[0]) return reply.code(404).send({ error: 'visitor not found' });
    return rows[0];
  });

  // 游客中途退出：独立事件，后续验票拒绝
  app.post('/api/visitors/:id/exit', async (req, reply) => {
    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        'UPDATE visitors SET exited_at = now() WHERE id = $1 AND exited_at IS NULL RETURNING *',
        [req.params.id]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'visitor not found or already exited' });
      }
      await client.query(`INSERT INTO events (type, subject_id, detail) VALUES ('visitor_exited', $1, $2)`, [
        req.params.id,
        JSON.stringify({ name: rows[0].name }),
      ]);
      await client.query('COMMIT');
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  // 发放/补发腕带：立即停用旧带。行锁 + 部分唯一索引保证并发补发只有一条有效
  app.post('/api/visitors/:id/wristbands', async (req, reply) => {
    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      const { rows: v } = await client.query('SELECT id FROM visitors WHERE id = $1 FOR UPDATE', [
        req.params.id,
      ]);
      if (!v[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'visitor not found' });
      }
      const publicId = 'WB-' + crypto.randomBytes(8).toString('hex');
      // 先停用旧带（立即生效），再发放新带，避免同一游客出现两条有效腕带
      const { rows: old } = await client.query(
        `UPDATE wristbands
            SET status = 'deactivated', deactivated_at = now()
          WHERE visitor_id = $1 AND status = 'active'
        RETURNING id, public_id`,
        [req.params.id]
      );
      const { rows: nb } = await client.query(
        `INSERT INTO wristbands (public_id, visitor_id) VALUES ($1, $2) RETURNING *`,
        [publicId, req.params.id]
      );
      if (old.length) {
        await client.query('UPDATE wristbands SET replaced_by = $1 WHERE id = ANY($2)', [
          nb[0].id,
          old.map((o) => o.id),
        ]);
      }
      await client.query(
        `INSERT INTO events (type, subject_id, detail) VALUES ('wristband_reissued', $1, $2)`,
        [req.params.id, JSON.stringify({ new_public_id: publicId, replaced: old.map((o) => o.public_id) })]
      );
      await client.query('COMMIT');
      return nb[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });

  app.get('/api/visitors/:id/wristbands', async (req) => {
    const { rows } = await app.pg.query(
      'SELECT * FROM wristbands WHERE visitor_id = $1 ORDER BY issued_at DESC',
      [req.params.id]
    );
    return rows;
  });

  // 资格解释（服务台可见细节；闸机只见原因码）
  app.get('/api/visitors/:id/eligibility/:rideId', async (req, reply) => {
    const { rows: v } = await app.pg.query('SELECT * FROM visitors WHERE id = $1', [req.params.id]);
    const { rows: r } = await app.pg.query('SELECT * FROM rides WHERE id = $1', [req.params.rideId]);
    if (!v[0] || !r[0]) return reply.code(404).send({ error: 'visitor or ride not found' });
    const result = await explainEligibility(app.pg, v[0], r[0], new Date());
    return { visitor: v[0], ride: r[0], ...result };
  });
}

module.exports = visitorRoutes;
