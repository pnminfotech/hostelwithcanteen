const mongoose = require("mongoose");

const holidaySchema = new mongoose.Schema(
  {
    tenantId: { type: mongoose.Schema.Types.ObjectId, ref: "Form", required: true },
    tenantName: { type: String, required: true },
    parentMobile: { type: String, default: "" },
    fromDate: { type: Date, required: true },
    toDate: { type: Date, required: true },
    totalDays: { type: Number, required: true },
    status: {
      type: String,
      enum: ["active", "returned"],
      default: "active",
    },
    returnedAt: { type: Date, default: null },
    smsStatus: {
      type: String,
      enum: ["sent", "failed", "skipped"],
      default: "skipped",
    },
    smsError: { type: String, default: "" },
  },
  { timestamps: true }
);

module.exports = mongoose.models.Holiday || mongoose.model("Holiday", holidaySchema);
