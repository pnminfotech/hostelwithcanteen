const mongoose = require("mongoose");

const messageStatSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, unique: true, index: true }, // e.g. "admission_sms"
    total: { type: Number, default: 0 },
    sent: { type: Number, default: 0 },
    failed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    lastStatus: { type: String, default: "" },
    lastError: { type: String, default: "" },
    lastAt: { type: Date, default: null },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.MessageStat || mongoose.model("MessageStat", messageStatSchema);

