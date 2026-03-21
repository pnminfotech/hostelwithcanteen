const mongoose = require("mongoose");

const receiptSchema = new mongoose.Schema(
  {
    url: {
      type: String,
      trim: true,
      default: "",
    },
    fileId: {
      type: String,
      trim: true,
      default: "",
    },
    filePath: {
      type: String,
      trim: true,
      default: "",
    },
    filename: {
      type: String,
      trim: true,
      default: "",
    },
    storedName: {
      type: String,
      trim: true,
      default: "",
    },
    mimetype: {
      type: String,
      trim: true,
      default: "",
    },
    size: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  { _id: false }
);

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
    billNumber: {
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
    receiptFileId: {
      type: String,
      trim: true,
      default: "",
    },
    receipts: {
      type: [receiptSchema],
      default: [],
    },
    notes: {
      type: String,
      trim: true,
      default: "",
    },
    dueDate: {
      type: Date,
      default: null,
    },
    paidAmount: {
      type: Number,
      min: 0,
      default: 0,
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

canteenExpenseSchema.index({ expenseDate: -1, category: 1 });
canteenExpenseSchema.index({ vendorName: 1 });

module.exports = mongoose.model("CanteenExpense", canteenExpenseSchema);
