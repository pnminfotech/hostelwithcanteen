const fs = require("fs");
const path = require("path");
const CanteenExpense = require("../models/CanteenExpense");

const buildReceiptPath = (file) => {
  if (!file) return "";
  return `/uploads/canteen/${file.filename}`;
};
exports.createExpense = async (req, res) => {
  try {
    const {
      expenseDate,
      title,
      category,
      amount,
      vendorName,
      paidBy,
      paymentMethod,
      description,
      notes,
    //   status,
      receiptImage
    } = req.body;

    const newExpense = new CanteenExpense({
      expenseDate,
      title,
      category,
      amount,
      vendorName,
      paidBy,
      paymentMethod,
      description,
      notes,
    //   status,
      receiptImage // ImageKit URL already uploaded
    });

    const saved = await newExpense.save();

    res.json({
      success: true,
      data: saved
    });

  } catch (error) {
    console.error(error);
    res.status(500).json({ success:false, message:error.message });
  }
};
// exports.createExpense = async (req, res) => {
//   try {
//     const {
//       expenseDate,
//       title,
//       category,
//       amount,
//       vendorName,
//       paidBy,
//       paymentMethod,
//       description,
//       notes,
//       status,
//     } = req.body;

//     const newExpense = new CanteenExpense({
//       expenseDate,
//       title,
//       category,
//       amount,
//       vendorName,
//       paidBy,
//       paymentMethod,
//       description,
//       notes,
//       status: status || "Pending",
//       receiptImage: buildReceiptPath(req.file),
//     });

//     const saved = await newExpense.save();

//     return res.status(201).json({
//       success: true,
//       message: "Canteen expense created successfully",
//       data: saved,
//     });
//   } catch (error) {
//     console.error("createExpense error:", error);
//     return res.status(500).json({
//       success: false,
//       message: "Failed to create canteen expense",
//       error: error.message,
//     });
//   }
// };

exports.getExpenses = async (req, res) => {
  try {
   const {
  search = "",
  category = "",
  month = "",
  fromDate = "",
  toDate = "",
} = req.query;

    const query = {};

    if (search.trim()) {
      query.$or = [
        { title: { $regex: search, $options: "i" } },
        { vendorName: { $regex: search, $options: "i" } },
        { paidBy: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
      ];
    }

    if (category.trim()) {
      query.category = category;
    }

   
    if (month) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);

      query.expenseDate = {
        $gte: start,
        $lt: end,
      };
    }
if (fromDate || toDate) {
  query.expenseDate = query.expenseDate || {};

  if (fromDate) {
    query.expenseDate.$gte = new Date(`${fromDate}T00:00:00.000Z`);
  }

  if (toDate) {
    query.expenseDate.$lte = new Date(`${toDate}T23:59:59.999Z`);
  }
}
    const data = await CanteenExpense.find(query).sort({ expenseDate: -1, createdAt: -1 });

    return res.status(200).json({
      success: true,
      count: data.length,
      data,
    });
  } catch (error) {
    console.error("getExpenses error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch canteen expenses",
      error: error.message,
    });
  }
};

exports.getExpenseById = async (req, res) => {
  try {
    const expense = await CanteenExpense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: "Expense not found",
      });
    }

    return res.status(200).json({
      success: true,
      data: expense,
    });
  } catch (error) {
    console.error("getExpenseById error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch expense",
      error: error.message,
    });
  }
};

exports.updateExpense = async (req, res) => {
  try {

    const updated = await CanteenExpense.findByIdAndUpdate(
      req.params.id,
      req.body,
      { new: true }
    );

    res.json({
      success:true,
      data:updated
    });

  } catch (error) {
    res.status(500).json({
      success:false,
      message:error.message
    });
  }
};

exports.deleteExpense = async (req, res) => {
  try {
    const existing = await CanteenExpense.findById(req.params.id);

    if (!existing) {
      return res.status(404).json({
        success: false,
        message: "Expense not found",
      });
    }

    if (existing.receiptImage) {
      const oldFilePath = path.join(process.cwd(), existing.receiptImage.replace(/^\//, ""));
      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }

    await CanteenExpense.findByIdAndDelete(req.params.id);

    return res.status(200).json({
      success: true,
      message: "Expense deleted successfully",
    });
  } catch (error) {
    console.error("deleteExpense error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to delete expense",
      error: error.message,
    });
  }
};

exports.getExpenseSummary = async (req, res) => {
  try {
    const { month = "" } = req.query;

    const matchStage = {};

    if (month) {
      const start = new Date(`${month}-01T00:00:00.000Z`);
      const end = new Date(start);
      end.setMonth(end.getMonth() + 1);

      matchStage.expenseDate = {
        $gte: start,
        $lt: end,
      };
    }

    const [totals, categoryBreakdown, recentExpenses] = await Promise.all([
      CanteenExpense.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
            totalEntries: { $sum: 1 },
          },
        },
      ]),
      CanteenExpense.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: "$category",
            totalAmount: { $sum: "$amount" },
            count: { $sum: 1 },
          },
        },
        { $sort: { totalAmount: -1 } },
      ]),
      CanteenExpense.find(matchStage)
        .sort({ expenseDate: -1, createdAt: -1 })
        .limit(5),
    ]);

    return res.status(200).json({
      success: true,
      data: {
        totalAmount: totals[0]?.totalAmount || 0,
        totalEntries: totals[0]?.totalEntries || 0,
        categoryBreakdown,
        recentExpenses,
      },
    });
  } catch (error) {
    console.error("getExpenseSummary error:", error);
    return res.status(500).json({
      success: false,
      message: "Failed to fetch summary",
      error: error.message,
    });
  }
};