
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env") });
const axios = require("axios");

const INFOBIP_BASE_URL = process.env.INFOBIP_BASE_URL;
const INFOBIP_API_KEY = process.env.INFOBIP_API_KEY;
const SENDER_NUMBER = process.env.SENDER_NUMBER;

exports.sendWhatsAppTicket = async (to, templateName, placeholders = [], buttonParam = null) => {
  try {
    // 1️⃣ Clean phone number
    let cleanPhone = to.replace(/\D/g, "");
    if (!cleanPhone.startsWith("91")) cleanPhone = "91" + cleanPhone;

    const safePlaceholders = placeholders.map(p => String(p));

    // 2️⃣ Base payload for WALKING (NO BUTTON)
    const payload = {
      messages: [
        {
          from: SENDER_NUMBER,
          to: `+${cleanPhone}`,
          content: {
            templateName,
            language: "en_GB",
            templateData: {
              body: {
                placeholders: safePlaceholders
              }
            }
          }
        }
      ]
    };

    // 3️⃣ If buttonParam exists → seating template → use button instead of placeholders
    if (buttonParam) {
      payload.messages[0].content.templateData = {
        body: { placeholders: safePlaceholders }, // keep body placeholders
        buttons: [
          {
            type: "URL",
            parameter: String(buttonParam)
          }
        ]
      };
    }

    console.log("📤 WhatsApp Payload →", JSON.stringify(payload, null, 2));

    // 4️⃣ Send request
    const response = await axios.post(
      `${INFOBIP_BASE_URL}/whatsapp/1/message/template`,
      payload,
      {
        headers: {
          Authorization: `App ${INFOBIP_API_KEY}`,
          "Content-Type": "application/json",
          Accept: "application/json"
        }
      }
    );

    const message = response.data.messages?.[0];

    console.log("📨 WhatsApp sent:", {
      id: message.messageId,
      status: message.status
    });

    return { success: true, messageId: message.messageId };

  } catch (error) {
    console.error("❌ WhatsApp Error:", JSON.stringify(error.response?.data || error, null, 2));
    return { success: false, error: error.response?.data || error.message };
  }
};
