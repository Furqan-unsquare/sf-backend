require("../models/Event");
const { Worker } = require("bullmq");
const redis = require("../config/redis");
const AbandonedCart = require("../models/AbandonedCart");
const Booking = require("../models/Booking");
const mongoose = require("mongoose");
const { sendWhatsAppTicket } = require("../utils/infobipService");
const path = require("path");

// Load env
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

// MongoDB connection
mongoose
  .connect(process.env.MONGODB_URI)
  .then(() => console.log("✅ MongoDB connected"))
  .catch((err) => console.error("❌ MongoDB connection error:", err));

console.log("⚙️ Initializing Abandoned Cart Worker...");

const worker = new Worker(
  "notifications",
  async (job) => {
    console.log(`🚀 Processing job ${job.id} (${job.name})`);
    const { cartId } = job.data;

    const cart = await AbandonedCart.findById(cartId).populate("event");

    if (!cart || cart.status !== "active") {
      console.log(`⚠️ Cart ${cartId} not found or inactive. Skipping.`);
      return;
    }

    const phone = cart.contactInfo?.phone;
    if (!phone) {
      console.error(`❌ No phone number for cart ${cartId}`);
      return;
    }

    // ✅ CHECK FOR EXISTING SUCCESSFUL BOOKING
    // Search for a confirmed booking for the same phone, event, date, and time
    const existingBooking = await Booking.findOne({
      "contactInfo.phone": phone,
      event: cart.event._id,
      date: cart.date,
      time: cart.time,
      status: "confirmed",
      paymentStatus: "paid"
    });

    if (existingBooking) {
      console.log(`🎉 [Abandoned Cart] Booking already exists for ${phone} on ${cartId}. Marking as recovered.`);
      cart.status = "recovered";
      cart.recoveredAt = new Date();
      cart.recoveredBookingId = existingBooking._id;
      await cart.save();
      return;
    }

    // Format date
    const dateFormatted = cart.date
      ? new Date(cart.date).toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "short",
        year: "numeric",
      })
      : "N/A";

    // Checkout URL
    // const checkoutUrl = cart.event?.isSpecial
    //   ? `/special-event/${cart.event._id}`
    //   : `/event/${cart.event._id}`;

    const checkoutUrl = cart.event?.isSpecial
      ? `special-event/${cart.event._id}`
      : `event/${cart.event._id}`;

    let templateName;
    let variables = [];

    // =========================
    // TEMPLATE LOGIC
    // =========================

    // ⏱️ 15-Minute Reminder
    if (job.name === "abandoned-cart-15min") {
      // Skip if reminder already sent for this cart
      if (cart.remindersSent) {
        console.log(`ℹ️ Reminder already sent for cart ${cartId}. Skipping.`);
        return;
      }

      templateName = "booking_abandonedcarts";

      variables = [
        cart.contactInfo?.name || "Guest", // {{1}} Name
        cart.event?.name || "Event",       // {{2}} Event Name
        dateFormatted,                     // {{3}} Date
        cart.time || "N/A"               // {{4}} Time
      ];
    }

    // 📅 Follow-up Reminder
    else if (job.name === "abandoned-cart-next-day") {
      // Skip if follow-up already sent
      if (cart.followupSent) {
        console.log(`ℹ️ Follow-up already sent for cart ${cartId}. Skipping.`);
        return;
      }

      templateName = "booking_abandonedcartsfollowup";

      variables = [
        cart.contactInfo?.name || "Guest", // {{1}} Name
        cart.event?.name || "Event"       // {{2}} Event Name
      ];
    }

    else {
      console.log(`⚠️ Unknown job type: ${job.name}`);
      return;
    }

    console.log(
      `📱 Sending WhatsApp | Template=${templateName} | Phone=${phone} | Variables=${JSON.stringify(variables)}`
    );

    console.log("📤 WhatsApp payload:", {
      phone,
      templateName,
      variables,
      checkoutUrl
    });

    const response = await sendWhatsAppTicket(
      phone,
      templateName,
      variables,
      checkoutUrl
    );

    console.log("📥 WhatsApp response:", response);

    if (response?.success) {
      console.log(`✅ WhatsApp sent for cart ${cartId} (Job: ${job.name})`);

      if (job.name === "abandoned-cart-next-day") {
        cart.followupSent = true;
      } else {
        cart.remindersSent = true;
      }

      cart.lastReminderSent = new Date();
      await cart.save();
    } else {
      console.log("INFOBIP_BASE_URL =", process.env);
      console.error(`❌ WhatsApp failed for cart ${cartId} (Job: ${job.name}). Error:`, response?.error);
      throw new Error(
        typeof response?.error === "string"
          ? response.error
          : JSON.stringify(response?.error)
      );
    }
  },
  {
    connection: redis,
    concurrency: 5,
  }
);

worker.on("active", (job) => {
  console.log(`🏃 Job ${job.id} is now active`);
});

worker.on("completed", (job) => {
  console.log(`✅ Job ${job.id} has completed`);
});

worker.on("failed", (job, err) => {
  console.error(`❌ Job ${job?.id} failed with error:`, err);
});

console.log("✅ Abandoned Cart Worker is ready and listening for jobs on queue 'notifications'");
