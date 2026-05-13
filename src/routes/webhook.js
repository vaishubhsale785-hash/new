const express = require("express");
const router = express.Router();
const bot = require("../config/bot");

// ✅ ADD THIS
router.get("/", (req, res) => {
  res.send("Webhook is working ✅");
});

router.post("/", async (req, res) => {
  console.log("Incoming update:", req.body); // DEBUG

  const update = req.body;

  if (update.message) {
    const chatId = update.message.chat.id;
    const text = update.message.text;

    if (text === "/start") {
      const webAppUrl = `${process.env.BASE_URL}/verify`;

      await bot.sendMessage(chatId, "✅ Welcome! Verify your device", {
        reply_markup: {
          inline_keyboard: [[{ text: "🔐 Verify", web_app: { url: webAppUrl } }]],
        },
      });
    }
  }

  res.sendStatus(200);
});

module.exports = router;
