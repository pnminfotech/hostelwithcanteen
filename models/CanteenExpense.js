const mongoose = require("mongoose");

const canteenExpenseSchema = new mongoose.Schema(
  {
    expenseDate: {
      type: Date,
      required: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Grocery",
        "Vegetables",
        "Milk/Dairy",
        "Gas",
        "Snacks",
        "Kitchen Items",
        "Cleaning",
        "Repairs",
        "Tea/Refreshments",
        "Other",
      ],
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    vendorName: {
      type: String,
      trim: true,
      default: "",
    },
    paidBy: {
      type: String,
      trim: true,
      default: "",
    },
    paymentMethod: {
      type: String,
      enum: ["Cash", "UPI", "Card", "Bank Transfer", "Credit", "Other"],
      default: "Cash",
    },
    description: {
      type: String,
      trim: true,
      default: "",
    },
    receiptImage: {
      type: String,
      default: "",
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
   
  },
  { timestamps: true }
);

module.exports = mongoose.model("CanteenExpense", canteenExpenseSchema);