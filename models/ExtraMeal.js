const mongoose = require("mongoose");

const extraMealSchema = new mongoose.Schema(
  {
    mealDate: {
      type: Date,
      required: true,
      index: true,
    },

    personName: {
      type: String,
      required: true,
      trim: true,
    },

    phoneNo: {
      type: String,
      trim: true,
      default: "",
    },

    mealType: {
      type: String,
      enum: ["Breakfast", "Lunch", "Dinner"],
      required: true,
    },

    qty: {
      type: Number,
      default: 1,
      min: 1,
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

module.exports = mongoose.model("ExtraMeal", extraMealSchema);


