const fs = require("fs");
const path = require("path");
const ImageKit = require("imagekit");

const CanteenExpense = require("../models/CanteenExpense");
const CanteenBudget = require("../models/CanteenBudget");

const categoryValues = CanteenExpense.schema.path("category").enumValues;
const paymentMethodValues =
  CanteenExpense.schema.path("paymentMethod").enumValues;
const paymentStatusValues = ["Pending", "Partial", "Paid"];
const monthPattern = /^\d{4}-\d{2}$/;

const canUseImageKit =
  !!process.env.IMAGEKIT_PUBLIC_KEY &&
  !!process.env.IMAGEKIT_PRIVATE_KEY &&
  !!process.env.IMAGEKIT_URL_ENDPOINT;

const imagekit = canUseImageKit
  ? new ImageKit({
      publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "",
      privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
      urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "",
    })
  : null;

const escapeRegex = (value = "") =>
  String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const parseDateInput = (value, fieldName) => {
  if (value === undefined || value === null || value === "") return null;

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${fieldName} is invalid`);
  }

  return parsed;
};

const normalizeMonth = (month) => {
  if (!month) return "";
  if (!monthPattern.test(month)) {
    throw new Error("month must be in YYYY-MM format");
  }
  return month;
};

const getStatusFromAmounts = (amount, paidAmount) => {
  const safeAmount = Number(amount || 0);
  const safePaidAmount = Number(paidAmount || 0);
  const balanceAmount = Math.max(safeAmount - safePaidAmount, 0);

  if (balanceAmount <= 0) return "Paid";
  if (safePaidAmount > 0) return "Partial";
  return "Pending";
};

const normalizeReceiptEntry = (receipt = {}) => {
  const normalized = {
    url: String(receipt.url || receipt.receiptImage || "").trim(),
    fileId: String(receipt.fileId || receipt.receiptFileId || "").trim(),
    filePath: String(receipt.filePath || "").trim(),
    filename: String(receipt.filename || "").trim(),
    storedName: String(receipt.storedName || "").trim(),
    mimetype: String(receipt.mimetype || "").trim(),
    size: Number(receipt.size || 0),
  };

  if (!normalized.url) return null;

  if (!Number.isFinite(normalized.size) || normalized.size < 0) {
    normalized.size = 0;
  }

  return normalized;
};

const getNormalizedReceipts = (expense = {}) => {
  const receiptList = Array.isArray(expense.receipts) ? expense.receipts : [];
  const normalizedList = receiptList
    .map(normalizeReceiptEntry)
    .filter(Boolean);

  if (normalizedList.length) return normalizedList;

  const legacyReceipt = normalizeReceiptEntry({
    url: expense.receiptImage,
    fileId: expense.receiptFileId,
  });

  return legacyReceipt ? [legacyReceipt] : [];
};

const syncLegacyReceiptFields = (payload = {}) => {
  const firstReceipt = Array.isArray(payload.receipts) ? payload.receipts[0] : null;
  payload.receiptImage = firstReceipt?.url || "";
  payload.receiptFileId = firstReceipt?.fileId || "";
  return payload;
};

const serializeExpense = (expenseDoc) => {
  const expense = expenseDoc?.toObject ? expenseDoc.toObject() : expenseDoc;
  const amount = Number(expense?.amount || 0);
  const paidAmount = Number(expense?.paidAmount || 0);
  const balanceAmount = Math.max(amount - paidAmount, 0);
  const receipts = getNormalizedReceipts(expense);
  const primaryReceipt = receipts[0] || null;

  return {
    ...expense,
    amount,
    paidAmount,
    balanceAmount,
    receipts,
    receiptImage: primaryReceipt?.url || "",
    receiptFileId: primaryReceipt?.fileId || "",
    paymentStatus: getStatusFromAmounts(amount, paidAmount),
  };
};

const buildStatusExpr = (paymentStatus) => {
  const paidExpr = { $ifNull: ["$paidAmount", 0] };

  if (paymentStatus === "Pending") {
    return { $lte: [paidExpr, 0] };
  }

  if (paymentStatus === "Partial") {
    return {
      $and: [
        { $gt: [paidExpr, 0] },
        { $lt: [paidExpr, "$amount"] },
      ],
    };
  }

  if (paymentStatus === "Paid") {
    return { $gte: [paidExpr, "$amount"] };
  }

  return null;
};

const buildExpenseQuery = (queryParams = {}) => {
  const {
    search = "",
    category = "",
    month = "",
    fromDate = "",
    toDate = "",
    paymentStatus = "",
  } = queryParams;

  const query = {};
  const trimmedSearch = String(search || "").trim();
  const trimmedCategory = String(category || "").trim();
  const normalizedMonth = normalizeMonth(String(month || "").trim());
  const trimmedPaymentStatus = String(paymentStatus || "").trim();

  if (trimmedSearch) {
    const safeSearch = escapeRegex(trimmedSearch);
    query.$or = [
      { title: { $regex: safeSearch, $options: "i" } },
      { vendorName: { $regex: safeSearch, $options: "i" } },
      { paidBy: { $regex: safeSearch, $options: "i" } },
      { description: { $regex: safeSearch, $options: "i" } },
      { notes: { $regex: safeSearch, $options: "i" } },
      { billNumber: { $regex: safeSearch, $options: "i" } },
    ];
  }

  if (trimmedCategory) {
    if (!categoryValues.includes(trimmedCategory)) {
      throw new Error("Invalid category");
    }
    query.category = trimmedCategory;
  }

  if (normalizedMonth) {
    const start = new Date(`${normalizedMonth}-01T00:00:00.000Z`);
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
      query.expenseDate.$gte = parseDateInput(
        `${fromDate}T00:00:00.000Z`,
        "fromDate"
      );
    }

    if (toDate) {
      query.expenseDate.$lte = parseDateInput(
        `${toDate}T23:59:59.999Z`,
        "toDate"
      );
    }

    if (
      query.expenseDate.$gte &&
      query.expenseDate.$lte &&
      query.expenseDate.$gte > query.expenseDate.$lte
    ) {
      throw new Error("fromDate cannot be after toDate");
    }
  }

  if (trimmedPaymentStatus) {
    if (!paymentStatusValues.includes(trimmedPaymentStatus)) {
      throw new Error("Invalid paymentStatus");
    }
    query.$expr = buildStatusExpr(trimmedPaymentStatus);
  }

  return query;
};

const validateExpensePayload = (body = {}, options = {}) => {
  const { isUpdate = false } = options;
  const payload = {};

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, "expenseDate")) {
    const expenseDate = parseDateInput(body.expenseDate, "expenseDate");
    if (!expenseDate) throw new Error("expenseDate is required");
    payload.expenseDate = expenseDate;
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, "title")) {
    const title = String(body.title || "").trim();
    if (!title) throw new Error("title is required");
    payload.title = title;
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, "category")) {
    const category = String(body.category || "").trim();
    if (!category) throw new Error("category is required");
    if (!categoryValues.includes(category)) throw new Error("Invalid category");
    payload.category = category;
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, "amount")) {
    const amount = Number(body.amount);
    if (!Number.isFinite(amount) || amount < 0) {
      throw new Error("amount must be a valid non-negative number");
    }
    payload.amount = amount;
  }

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, "paidAmount")) {
    const rawPaidAmount =
      body.paidAmount === undefined ||
      body.paidAmount === null ||
      body.paidAmount === ""
        ? 0
        : Number(body.paidAmount);

    if (!Number.isFinite(rawPaidAmount) || rawPaidAmount < 0) {
      throw new Error("paidAmount must be a valid non-negative number");
    }
    payload.paidAmount = rawPaidAmount;
  }

  if (
    !isUpdate ||
    Object.prototype.hasOwnProperty.call(body, "paymentMethod")
  ) {
    const paymentMethod = String(body.paymentMethod || "Cash").trim();
    if (!paymentMethodValues.includes(paymentMethod)) {
      throw new Error("Invalid paymentMethod");
    }
    payload.paymentMethod = paymentMethod;
  }

  const textFields = [
    "vendorName",
    "paidBy",
    "description",
    "notes",
    "billNumber",
  ];

  textFields.forEach((field) => {
    if (!isUpdate || Object.prototype.hasOwnProperty.call(body, field)) {
      payload[field] = String(body[field] || "").trim();
    }
  });

  if (!isUpdate || Object.prototype.hasOwnProperty.call(body, "dueDate")) {
    payload.dueDate = parseDateInput(body.dueDate, "dueDate");
  }

  const shouldHandleReceipts =
    !isUpdate ||
    Object.prototype.hasOwnProperty.call(body, "receipts") ||
    Object.prototype.hasOwnProperty.call(body, "receiptImage") ||
    Object.prototype.hasOwnProperty.call(body, "receiptFileId");

  if (shouldHandleReceipts) {
    const incomingReceipts = Array.isArray(body.receipts)
      ? body.receipts
      : [];
    const normalizedReceipts = incomingReceipts
      .map(normalizeReceiptEntry)
      .filter(Boolean);

    if (
      !normalizedReceipts.length &&
      (body.receiptImage || body.receiptFileId)
    ) {
      const legacyReceipt = normalizeReceiptEntry({
        url: body.receiptImage,
        fileId: body.receiptFileId,
      });

      if (legacyReceipt) normalizedReceipts.push(legacyReceipt);
    }

    payload.receipts = normalizedReceipts;
    syncLegacyReceiptFields(payload);
  }

  return payload;
};

const ensurePaymentAmountsAreValid = (expense) => {
  if (Number(expense.paidAmount || 0) > Number(expense.amount || 0)) {
    throw new Error("paidAmount cannot be greater than amount");
  }
};

const deleteStoredReceipt = async (expense) => {
  if (!expense) return;

  const receipts = getNormalizedReceipts(expense);

  for (const receipt of receipts) {
    if (receipt.fileId && imagekit) {
      try {
        await imagekit.deleteFile(receipt.fileId);
        continue;
      } catch (error) {
        console.error("ImageKit receipt delete failed:", error.message || error);
      }
    }

    if (receipt.url && !String(receipt.url).startsWith("http")) {
      const oldFilePath = path.join(
        process.cwd(),
        String(receipt.url).replace(/^\//, "")
      );

      if (fs.existsSync(oldFilePath)) {
        fs.unlinkSync(oldFilePath);
      }
    }
  }
};

const buildBudgetPayload = (body = {}) => {
  const monthKey = normalizeMonth(
    String(body.monthKey || body.month || "").trim()
  );
  if (!monthKey) {
    throw new Error("monthKey is required");
  }

  const amount = Number(body.amount);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Budget amount must be a valid non-negative number");
  }

  return {
    monthKey,
    amount,
    notes: String(body.notes || "").trim(),
  };
};

exports.createExpense = async (req, res) => {
  try {
    const payload = validateExpensePayload(req.body);
    syncLegacyReceiptFields(payload);
    ensurePaymentAmountsAreValid(payload);

    const newExpense = new CanteenExpense({
      ...payload,
      createdBy: req.user?._id || null,
      updatedBy: req.user?._id || null,
    });

    const saved = await newExpense.save();

    return res.status(201).json({
      success: true,
      data: serializeExpense(saved),
    });
  } catch (error) {
    console.error("createExpense error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to create canteen expense",
    });
  }
};

exports.getExpenses = async (req, res) => {
  try {
    const query = buildExpenseQuery(req.query);
    const data = await CanteenExpense.find(query).sort({
      expenseDate: -1,
      createdAt: -1,
    });

    return res.status(200).json({
      success: true,
      count: data.length,
      data: data.map(serializeExpense),
    });
  } catch (error) {
    console.error("getExpenses error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to fetch canteen expenses",
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
      data: serializeExpense(expense),
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
    const expense = await CanteenExpense.findById(req.params.id);

    if (!expense) {
      return res.status(404).json({
        success: false,
        message: "Expense not found",
      });
    }

    const previousReceipts = getNormalizedReceipts(expense);

    const updates = validateExpensePayload(req.body, { isUpdate: true });
    expense.set(updates);
    syncLegacyReceiptFields(expense);
    expense.updatedBy = req.user?._id || expense.updatedBy || null;

    ensurePaymentAmountsAreValid(expense);
    await expense.save();

    const currentReceipts = getNormalizedReceipts(expense);
    const keptReceiptKeys = new Set(
      currentReceipts.map((receipt) => receipt.fileId || receipt.url)
    );
    const removedReceipts = previousReceipts.filter((receipt) => {
      const key = receipt.fileId || receipt.url;
      return key && !keptReceiptKeys.has(key);
    });

    if (removedReceipts.length) {
      await deleteStoredReceipt({ receipts: removedReceipts });
    }

    return res.status(200).json({
      success: true,
      data: serializeExpense(expense),
    });
  } catch (error) {
    console.error("updateExpense error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to update expense",
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

    await deleteStoredReceipt(existing);
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
    const matchStage = buildExpenseQuery(req.query);
    const monthKey = normalizeMonth(String(req.query.month || "").trim());
    const paidExpr = { $ifNull: ["$paidAmount", 0] };
    const outstandingExpr = {
      $cond: [
        { $gt: [{ $subtract: ["$amount", paidExpr] }, 0] },
        { $subtract: ["$amount", paidExpr] },
        0,
      ],
    };

    const [
      totals,
      categoryBreakdown,
      vendorBreakdown,
      paymentBreakdown,
      recentExpenses,
      budget,
    ] = await Promise.all([
      CanteenExpense.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: null,
            totalAmount: { $sum: "$amount" },
            totalEntries: { $sum: 1 },
            totalPaidAmount: { $sum: paidExpr },
            outstandingAmount: { $sum: outstandingExpr },
          },
        },
      ]),
      CanteenExpense.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: "$category",
            totalAmount: { $sum: "$amount" },
            totalPaidAmount: { $sum: paidExpr },
            outstandingAmount: { $sum: outstandingExpr },
            count: { $sum: 1 },
          },
        },
        { $sort: { totalAmount: -1 } },
      ]),
      CanteenExpense.aggregate([
        { $match: matchStage },
        {
          $group: {
            _id: {
              $cond: [
                {
                  $gt: [{ $strLenCP: { $ifNull: ["$vendorName", ""] } }, 0],
                },
                "$vendorName",
                "Unassigned Vendor",
              ],
            },
            totalAmount: { $sum: "$amount" },
            outstandingAmount: { $sum: outstandingExpr },
            count: { $sum: 1 },
          },
        },
        { $sort: { outstandingAmount: -1, totalAmount: -1 } },
        { $limit: 8 },
      ]),
      CanteenExpense.aggregate([
        { $match: matchStage },
        {
          $project: {
            paymentStatus: {
              $switch: {
                branches: [
                  {
                    case: { $gte: [paidExpr, "$amount"] },
                    then: "Paid",
                  },
                  {
                    case: { $gt: [paidExpr, 0] },
                    then: "Partial",
                  },
                ],
                default: "Pending",
              },
            },
          },
        },
        {
          $group: {
            _id: "$paymentStatus",
            count: { $sum: 1 },
          },
        },
      ]),
      CanteenExpense.find(matchStage)
        .sort({ expenseDate: -1, createdAt: -1 })
        .limit(5),
      monthKey ? CanteenBudget.findOne({ monthKey }) : null,
    ]);

    const totalAmount = Number(totals[0]?.totalAmount || 0);
    const outstandingAmount = Number(totals[0]?.outstandingAmount || 0);
    const budgetAmount = Number(budget?.amount || 0);

    return res.status(200).json({
      success: true,
      data: {
        totalAmount,
        totalEntries: totals[0]?.totalEntries || 0,
        totalPaidAmount: Number(totals[0]?.totalPaidAmount || 0),
        outstandingAmount,
        budgetAmount,
        budgetVariance: budgetAmount ? budgetAmount - totalAmount : 0,
        categoryBreakdown,
        vendorBreakdown,
        paymentBreakdown,
        recentExpenses: recentExpenses.map(serializeExpense),
        budget: budget
          ? {
              _id: budget._id,
              monthKey: budget.monthKey,
              amount: budget.amount,
              notes: budget.notes,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("getExpenseSummary error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to fetch summary",
    });
  }
};

exports.getBudget = async (req, res) => {
  try {
    const monthKey = normalizeMonth(String(req.query.month || "").trim());
    if (!monthKey) {
      return res.status(200).json({ success: true, data: null });
    }

    const budget = await CanteenBudget.findOne({ monthKey });

    return res.status(200).json({
      success: true,
      data: budget
        ? {
            _id: budget._id,
            monthKey: budget.monthKey,
            amount: budget.amount,
            notes: budget.notes,
          }
        : null,
    });
  } catch (error) {
    console.error("getBudget error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to fetch budget",
    });
  }
};

exports.upsertBudget = async (req, res) => {
  try {
    const payload = buildBudgetPayload(req.body);
    let budget = await CanteenBudget.findOne({ monthKey: payload.monthKey });

    if (!budget) {
      budget = new CanteenBudget({
        ...payload,
        createdBy: req.user?._id || null,
        updatedBy: req.user?._id || null,
      });
    } else {
      budget.amount = payload.amount;
      budget.notes = payload.notes;
      budget.updatedBy = req.user?._id || budget.updatedBy || null;
    }

    await budget.save();

    return res.status(200).json({
      success: true,
      data: {
        _id: budget._id,
        monthKey: budget.monthKey,
        amount: budget.amount,
        notes: budget.notes,
      },
    });
  } catch (error) {
    console.error("upsertBudget error:", error);
    return res.status(400).json({
      success: false,
      message: error.message || "Failed to save budget",
    });
  }
};
