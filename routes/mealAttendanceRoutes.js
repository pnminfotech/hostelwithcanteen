const express = require("express");
const router = express.Router();

const {
  getAttendanceByDate,
  upsertAttendance,
  bulkUpsertAttendance,
  closeAttendanceDay,
  reopenAttendanceDay,
  getAttendanceSummary,
  getExtraMealsByDate,
  addExtraMeal,
  deleteExtraMeal,
} = require("../controllers/mealAttendanceController");

router.get("/", getAttendanceByDate);
router.get("/summary", getAttendanceSummary);
router.post("/", upsertAttendance);
router.post("/bulk", bulkUpsertAttendance);
router.post("/close-day", closeAttendanceDay);
router.post("/reopen-day", reopenAttendanceDay);
router.get("/extra", getExtraMealsByDate);
router.post("/extra", addExtraMeal);
router.delete("/extra/:id", deleteExtraMeal);
module.exports = router;