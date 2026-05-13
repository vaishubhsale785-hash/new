const express = require("express");
const bodyParser = require("body-parser");
const bot = require("./config/bot");

const app = express();
app.use(bodyParser.json());

// Routes
app.use("/api", require("./routes/api"));
app.use("/webhook", require("./routes/webhook"));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log("Server running on port " + PORT);
});
