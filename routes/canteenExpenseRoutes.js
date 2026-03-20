const express = require("express");
const router = express.Router();

// const upload = require("../middleware/canteenUpload");
const {
  createExpense,
  getExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
} = require("../controllers/canteenExpenseController");

router.get("/", getExpenses);
router.get("/summary", getExpenseSummary);
router.get("/:id", getExpenseById);
router.post("/", createExpense);
router.put("/:id", updateExpense);
router.delete("/:id", deleteExpense);

module.exports = router;