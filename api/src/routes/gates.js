const { processVerification } = require('../services/verify');

// 闸机端点：响应只有 decision + reason_code，绝不返回游客个人数据
async function gateRoutes(app) {
  app.post('/api/gates/verify', async (req, reply) => {
    const b = req.body || {};
    if (!b.client_event_id || !b.device_id || !b.wristband_public_id) {
      return reply.code(400).send({ error: 'client_event_id, device_id, wristband_public_id required' });
    }
    if (b.occurred_at && Number.isNaN(Date.parse(b.occurred_at))) {
      return reply.code(400).send({ error: 'occurred_at must be an ISO timestamp' });
    }
    const result = await processVerification(app.pg, app.redis, b);
    return result;
  });
}

module.exports = gateRoutes;
