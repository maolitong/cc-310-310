// 监护关系：建立、查询、撤回（撤回为独立事件，后续项目重新判断）
async function guardianshipRoutes(app) {
  app.get('/api/guardianships', async () => {
    const { rows } = await app.pg.query(
      `SELECT g.id, g.status, g.created_at, g.revoked_at,
              g.guardian_id, gv.name AS guardian_name,
              g.dependent_id, dv.name AS dependent_name
         FROM guardianships g
         JOIN visitors gv ON gv.id = g.guardian_id
         JOIN visitors dv ON dv.id = g.dependent_id
        ORDER BY g.created_at DESC`
    );
    return rows;
  });

  app.post('/api/guardianships', async (req, reply) => {
    const { guardian_id, dependent_id } = req.body || {};
    if (!guardian_id || !dependent_id || guardian_id === dependent_id) {
      return reply.code(400).send({ error: 'guardian_id and dependent_id (different) required' });
    }
    const { rows: people } = await app.pg.query('SELECT id, age_band FROM visitors WHERE id = ANY($1)', [
      [guardian_id, dependent_id],
    ]);
    if (people.length !== 2) return reply.code(404).send({ error: 'visitor not found' });
    const guardian = people.find((p) => p.id === guardian_id);
    if (guardian.age_band !== 'adult') {
      return reply.code(400).send({ error: 'guardian must be an adult' });
    }
    const { rows } = await app.pg.query(
      `INSERT INTO guardianships (guardian_id, dependent_id) VALUES ($1, $2) RETURNING *`,
      [guardian_id, dependent_id]
    );
    return rows[0];
  });

  app.post('/api/guardianships/:id/revoke', async (req, reply) => {
    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE guardianships SET status = 'revoked', revoked_at = now()
          WHERE id = $1 AND status = 'active' RETURNING *`,
        [req.params.id]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'guardianship not found or already revoked' });
      }
      await client.query(
        `INSERT INTO events (type, subject_id, detail) VALUES ('guardianship_revoked', $1, $2)`,
        [rows[0].id, JSON.stringify({ guardian_id: rows[0].guardian_id, dependent_id: rows[0].dependent_id })]
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
}

module.exports = guardianshipRoutes;
