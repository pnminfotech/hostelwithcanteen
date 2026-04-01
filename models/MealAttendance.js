const mongoose = require("mongoose");

const mealStatusEnum = ["NotMarked", "Present", "Absent", "Leave", "Extra"];

const mealAttendanceSchema = new mongoose.Schema(
  {
    attendanceDate: {
      type: Date,
      required: true,
      index: true,
    },

    tenantId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Form",
      required: true,
      index: true,
    },

    breakfastStatus: {
      type: String,
      enum: mealStatusEnum,
      default: "NotMarked",
    },

    lunchStatus: {
      type: String,
      enum: mealStatusEnum,
      default: "NotMarked",
    },

    dinnerStatus: {
      type: String,
      enum: mealStatusEnum,
      default: "NotMarked",
    },

    breakfastMarkedAt: {
      type: Date,
      default: null,
    },

    lunchMarkedAt: {
      type: Date,
      default: null,
    },

    dinnerMarkedAt: {
      type: Date,
      default: null,
    },

    notes: {
      type: String,
      trim: true,
      default: "",
    },

    isClosed: {
      type: Boolean,
      default: false,
    },

    closedAt: {
      type: Date,
      default: null,
    },

    closedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },

    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      default: null,
    },
  },
  { timestamps: true }
);

mealAttendanceSchema.index(
  { attendanceDate: 1, tenantId: 1 },
  { unique: true }
);

module.exports = mongoose.model("MealAttendance", mealAttendanceSchema);