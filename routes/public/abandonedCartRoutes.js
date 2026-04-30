const express = require('express');
const router = express.Router();
const { createAbandonedCart } = require('../../controllers/abandonedCartController');
const abandonedCartQueue = require("../../queues/abandonedCart.queue");
// Abandoned cart routes
router.post('/', createAbandonedCart);
router.get("/debug/queue", async (req, res) => {
  const jobs = await abandonedCartQueue.getJobs([
    "waiting",
    "delayed",
    "active",
  ]);
  res.json(
    jobs.map((job) => ({
      id: job.id,
      name: job.name,
      data: job.data,
      delay: job.opts.delay,
      timestamp: new Date(job.timestamp),
    }))
  );
});
module.exports = router; 