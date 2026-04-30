const IORedis = require("ioredis");

let redis;

if (process.env.REDIS_URL) {
  // ✅ Cloud Redis (RedisLabs, Upstash, etc.)
  console.log("📡 Connecting to Redis via REDIS_URL");

  redis = new IORedis(process.env.REDIS_URL, {
  maxRetriesPerRequest: null,
  retryStrategy: (times) => Math.min(times * 50, 2000),
  tls: {} // <-- THIS is what you're missing
});

} else {
  // ✅ Local Redis fallback
  const REDIS_HOST = process.env.REDIS_HOST || "127.0.0.1";
  const REDIS_PORT = parseInt(process.env.REDIS_PORT || "6379", 10);

  console.log(`📡 Connecting to local Redis at ${REDIS_HOST}:${REDIS_PORT}`);

  redis = new IORedis({
    host: REDIS_HOST,
    port: REDIS_PORT,
    password: process.env.REDIS_PASSWORD || undefined,
    maxRetriesPerRequest: null,
    retryStrategy: (times) => Math.min(times * 50, 2000),
  });
}

// Logs
redis.on("connect", () => {
  console.log("✅ Redis connected");
});

redis.on("ready", () => {
  console.log("🚀 Redis ready to accept commands");
});

redis.on("error", (err) => {
  if (err.code === "ECONNREFUSED") {
    console.error("❌ Redis connection refused");
  } else {
    console.error("❌ Redis error:", err.message);
  }
});

module.exports = redis;
