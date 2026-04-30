const AbandonedCart = require("../models/AbandonedCart");
const { scheduleAbandonedCartNotifications } = require("../services/abandonedCart.service");

// Create or update abandoned cart
exports.createAbandonedCart = async (req, res) => {
  try {
    const {
      sessionId,
      event,
      tickets,
      totalAmount,
      contactInfo,
      seats, // NEW
      date, // NEW
      time, // NEW
      language, // NEW
    } = req.body;

    console.log("Received abandoned cart request:", {
      sessionId,
      event,
      tickets,
      totalAmount,
      contactInfo,
      seats,
      date,
      time,
      language,
    });

    // Validations
    if (!sessionId) {
      return res
        .status(400)
        .json({ success: false, message: "Session ID required" });
    }
    if (!event) {
      return res
        .status(400)
        .json({ success: false, message: "Event ID required" });
    }
    if (!tickets || tickets.length === 0) {
      return res
        .status(400)
        .json({ success: false, message: "Tickets required" });
    }
    if (!totalAmount || totalAmount <= 0) {
      return res
        .status(400)
        .json({ success: false, message: "Valid total amount required" });
    }
    if (!date) {
      return res
        .status(400)
        .json({ success: false, message: "Event date required" });
    }
    if (!time) {
      return res
        .status(400)
        .json({ success: false, message: "Event time required" });
    }

    // Validation for contact info (Name and Number)
    if (!contactInfo?.name || !contactInfo?.phone) {
      return res.status(400).json({
        success: false,
        message: "Please fill details (Name and Number are required)",
      });
    }

    // Search for existing active cart for this user and event
    // Search for existing active cart for this user and event
    const queryConditions = [
      { event: event },
      { status: "active" }
    ];

    if (contactInfo && contactInfo.phone) {
      // If phone is provided:
      // 1. Match exisiting cart with SAME phone
      // 2. OR Match existing ANONYMOUS cart with same sessionId (claiming it)
      queryConditions.push({
        $or: [
          { "contactInfo.phone": contactInfo.phone },
          {
            sessionId: sessionId,
            $or: [
              { "contactInfo.phone": { $exists: false } },
              { "contactInfo.phone": null },
              { "contactInfo.phone": "" }
            ]
          }
        ]
      });
    } else {
      // If no phone provided (Anonymous browsing):
      // Only match by sessionId
      queryConditions.push({ sessionId: sessionId });
    }

    let cartCheck = await AbandonedCart.findOne({
      $and: queryConditions
    });

    // Create or update abandoned cart with ALL details
    const cart = await AbandonedCart.findOneAndUpdate(
      cartCheck ? { _id: cartCheck._id } : { sessionId, event, status: "active" },
      {
        sessionId,
        event,
        tickets,
        totalAmount,
        contactInfo,
        seats: seats || [],
        date: new Date(date),
        time,
        language: language || "none",
        status: "active",
        remindersSent: false, // Reset on any update
        followupSent: false,  // Reset on any update
        updatedAt: new Date(),
        user: req.user ? req.user._id : undefined,
      },
      {
        upsert: true,
        new: true,
        setDefaultsOnInsert: true,
      }
    );

    // Schedule notifications if it's considered "fresh" or significant update
    // For now, keep the isNew logic or always re-schedule (Queue handles jobId uniqueness)
    scheduleAbandonedCartNotifications(cart);

    console.log(
      "✅ AbandonedCart saved with seat/date/time:",
      JSON.stringify(cart, null, 2)
    );
    res.status(201).json({ success: true, data: cart });
  } catch (error) {
    console.error("AbandonedCart save error:", error);
    res.status(400).json({ success: false, message: error.message });
  }
};

// Get all abandoned carts
exports.getAllAbandonedCarts = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      search,
      status,
      startDate,
      endDate,
    } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { "contactInfo.name": { $regex: search, $options: "i" } },
        { "contactInfo.email": { $regex: search, $options: "i" } },
        { "contactInfo.phone": { $regex: search, $options: "i" } },
      ];
    }
    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const carts = await AbandonedCart.find(query)
      .populate("event", "name")
      .skip((page - 1) * limit)
      .limit(parseInt(limit))
      .sort({ updatedAt: -1 });

    const totalCount = await AbandonedCart.countDocuments(query);
    const pagination = {
      currentPage: parseInt(page),
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
      limit: parseInt(limit),
      hasNextPage: page * limit < totalCount,
      hasPrevPage: page > 1,
    };

    res.json({ success: true, data: { carts, pagination } });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Get abandoned cart by ID
exports.getAbandonedCartById = async (req, res) => {
  try {
    const cart = await AbandonedCart.findById(req.params.id)
      .populate("user", "name email phone")
      .populate("event", "title description dateTime location pricing")
      .lean();

    if (!cart) {
      return res.status(404).json({
        success: false,
        message: "Abandoned cart not found",
      });
    }

    res.json({
      success: true,
      data: cart,
    });
  } catch (error) {
    console.error("Get abandoned cart error:", error);
    res.status(500).json({
      success: false,
      message: "Failed to fetch abandoned cart",
      error: error.message,
    });
  }
};

// Delete abandoned cart
exports.deleteAbandonedCart = async (req, res) => {
  try {
    const cart = await AbandonedCart.findByIdAndDelete(req.params.id);
    if (!cart) {
      return res
        .status(404)
        .json({ success: false, message: "Cart not found" });
    }
    res.json({ success: true, message: "Cart deleted successfully" });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

// Export abandoned carts as CSV
exports.exportAbandonedCartsCSV = async (req, res) => {
  try {
    const { search, status, startDate, endDate } = req.query;
    const query = {};

    if (search) {
      query.$or = [
        { "contactInfo.name": { $regex: search, $options: "i" } },
        { "contactInfo.email": { $regex: search, $options: "i" } },
        { "contactInfo.phone": { $regex: search, $options: "i" } },
      ];
    }
    if (status) query.status = status;
    if (startDate || endDate) {
      query.createdAt = {};
      if (startDate) query.createdAt.$gte = new Date(startDate);
      if (endDate) query.createdAt.$lte = new Date(endDate);
    }

    const carts = await AbandonedCart.find(query).populate("event", "name");
    const csvData = carts.map((cart) => ({
      CartID: cart._id,
      CustomerName: cart.contactInfo?.name || "Anonymous",
      Email: cart.contactInfo?.email || "",
      Phone: cart.contactInfo?.phone || "",
      Event: cart.event?.name || "Unknown Event",
      Tickets: cart.tickets
        .map(
          (t) =>
            `${t.quantity} ${t.type.charAt(0).toUpperCase() + t.type.slice(1)}${t.quantity > 1 ? (t.type === "child" ? "ren" : "s") : ""
            } @ ₹${t.price.toLocaleString("en-IN")}`
        )
        .join(", "),
      TotalAmount: `₹${cart.totalAmount.toLocaleString("en-IN")}`,
      Status: cart.status.charAt(0).toUpperCase() + cart.status.slice(1),
      CreatedAt: new Date(cart.createdAt).toLocaleString("en-IN"),
      LastActivity: cart.updatedAt
        ? new Date(cart.updatedAt).toLocaleString("en-IN")
        : "",
    }));

    const headers = [
      "CartID",
      "CustomerName",
      "Email",
      "Phone",
      "Event",
      "Tickets",
      "TotalAmount",
      "Status",
      "CreatedAt",
      "LastActivity",
    ];
    const csvContent = [
      headers.join(","),
      ...csvData.map((row) =>
        headers
          .map((h) => `"${row[h]?.toString().replace(/"/g, '""') || ""}"`)
          .join(",")
      ),
    ].join("\n");

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      "attachment; filename=abandoned-carts.csv"
    );
    res.send(csvContent);
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};