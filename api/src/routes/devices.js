// 设备状态与停用（停用为独立事件，停用后验票拒绝）
async function deviceRoutes(app) {
  app.get('/api/devices', async () => {
    const { rows } = await app.pg.query(
      `SELECT d.*, r.name AS ride_name, r.code AS ride_code
         FROM devices d JOIN rides r ON r.id = d.ride_id
        ORDER BY r.code, d.name`
    );
    return rows;
  });

  app.post('/api/devices/:id/decommission', async (req, reply) => {
    const client = await app.pg.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `UPDATE devices SET status = 'decommissioned' WHERE id = $1 AND status = 'active' RETURNING *`,
        [req.params.id]
      );
      if (!rows[0]) {
        await client.query('ROLLBACK');
        return reply.code(404).send({ error: 'device not found or already decommissioned' });
      }
      await client.query(
        `INSERT INTO events (type, subject_id, detail) VALUES ('device_decommissioned', $1, $2)`,
        [rows[0].id, JSON.stringify({ name: rows[0].name })]
      );
      await client.query('COMMIT');
      await app.redis.del(`device:${req.params.id}`);
      return rows[0];
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  });
}

module.exports = deviceRoutes;
