const Fastify = require('fastify');

function buildApp({ pool, redis }) {
  const app = Fastify({ logger: process.env.NODE_ENV !== 'test' });
  app.decorate('pg', pool);
  app.decorate('redis', redis);

  app.get('/healthz', async () => {
    await pool.query('SELECT 1');
    await redis.ping();
    return { ok: true };
  });

  app.register(require('./routes/gates'));
  app.register(require('./routes/visitors'));
  app.register(require('./routes/guardianships'));
  app.register(require('./routes/rides'));
  app.register(require('./routes/devices'));
  app.register(require('./routes/logs'));

  return app;
}

module.exports = { buildApp };
