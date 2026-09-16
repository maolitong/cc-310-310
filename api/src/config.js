module.exports = {
  port: parseInt(process.env.PORT || '3000', 10),
  databaseUrl: process.env.DATABASE_URL || 'postgres://park:park@localhost:5432/park',
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379/0',
  seedDemo: process.env.SEED_DEMO !== '0',
};
