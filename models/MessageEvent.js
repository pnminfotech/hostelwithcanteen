const mongoose = require("mongoose");

const messageEventSchema = new mongoose.Schema(
  {
    key: { type: String, required: true, index: true }, // e.g. admission_sms
    status: {
      type: String,
      enum: ["sent", "failed", "skipped", "unknown"],
      required: true,
      index: true,
    },
    provider: { type: String, default: "unknown" },
    to: { type: String, default: "" },
    error: { type: String, default: "" },
    meta: { type: Object, default: {} },
  },
  { timestamps: true }
);

module.exports =
  mongoose.models.MessageEvent || mongoose.model("MessageEvent", messageEventSchema);

