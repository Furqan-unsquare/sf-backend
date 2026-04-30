const { Queue } = require("bullmq");
const redis = require("../config/redis");

const abandonedCartNotificationQueue = new Queue("notifications", {
  connection: redis,
});

module.exports = abandonedCartNotificationQueue;
