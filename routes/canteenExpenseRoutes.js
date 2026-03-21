const express = require("express");
const router = express.Router();

const {
  createExpense,
  getExpenses,
  getExpenseById,
  updateExpense,
  deleteExpense,
  getExpenseSummary,
  getBudget,
  upsertBudget,
} = require("../controllers/canteenExpenseController");

router.get("/", getExpenses);
router.get("/summary", getExpenseSummary);
router.get("/budget", getBudget);
router.put("/budget", upsertBudget);
router.get("/:id", getExpenseById);
router.post("/", createExpense);
router.put("/:id", updateExpense);
router.delete("/:id", deleteExpense);

module.exports = router;
