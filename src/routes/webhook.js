const express = require("express");
const router = express.Router();
const bot = require("../config/bot");

router.post("/", async (req, res) => {
  const update = req.body;

  if (update.message) {
    const chatId = update.message.chat.id;
    const text = update.message.text;

    if (text === "/start") {
      const webAppUrl = `${process.env.BASE_URL}/verify`;

      bot.sendMessage(chatId, "✅ Welcome! Verify your device to continue.", {
        reply_markup: {
          inline_keyboard: [
            [
              {
                text: "🔐 Verify Device",
                web_app: { url: webAppUrl },
              },
            ],
          ],
        },
      });
    }
  }

  res.sendStatus(200);
});

module.exports = router;
