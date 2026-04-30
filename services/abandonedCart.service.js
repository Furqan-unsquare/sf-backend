const abandonedCartQueue = require("../queues/abandonedCart.queue");

exports.scheduleAbandonedCartNotifications = async (cart) => {
  const now = Date.now();

  // ⏱️ 1-minute reminder (for testing: 15 minute)
  await abandonedCartQueue.add(
    "abandoned-cart-15min",
    {
      cartId: cart._id.toString(),
    },
    {
      delay: 15 * 60 * 1000, // 1 minute
      jobId: `abandoned-15min-${cart._id}`,
      attempts: 3,
      removeOnComplete: true,
    }
  );

  console.log("⏳ Scheduled first reminder for", cart._id);

  // ⏱️ Follow-up reminder (use 20 hr for testing; change to 24*60*60*1000 for 24-hour)
  const followupDelay = 20 * 60 * 60 * 1000; // 2 minutes (testing)

  await abandonedCartQueue.add(
    "abandoned-cart-next-day",
    {
      cartId: cart._id.toString(),
    },
    {
      delay: followupDelay,
      jobId: `abandoned-nextday-${cart._id}`,
      attempts: 3,
      removeOnComplete: true,
    }
  );

  console.log(`⏳ Scheduled follow-up reminder (next-day) for ${cart._id} (delay ${followupDelay}ms)`);
};