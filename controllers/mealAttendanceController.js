const MealAttendance = require("../models/MealAttendance");
const ExtraMeal = require("../models/ExtraMeal");
const Form = require("../models/Form");

const mealStatusEnum = ["NotMarked", "Present", "Absent", "Leave", "Extra"];

const parseDateOnly = (value) => {
  if (!value) throw new Error("Date is required");

  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Invalid date");
  }

  return date;
};

const getDayRange = (dateValue) => {
  const start = parseDateOnly(dateValue);
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start, end };
};

const formatYMD = (date = new Date()) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
};

const isTodayDate = (dateValue) => {
  return formatYMD(new Date()) === dateValue;
};

const canEditDate = (user, dateValue) => {
  if (!user) return true; // no auth middleware for now
  if (user.role === "super_admin") return true;
  if (user.role === "canteen_admin") return isTodayDate(dateValue);
  return false;
};

const validateMealStatus = (value, fieldName) => {
  if (!mealStatusEnum.includes(value)) {
    throw new Error(`${fieldName} is invalid`);
  }
};

const getTenantQuery = (search = "") => {
  const query = {};

  query.$or = [
    { leaveDate: { $exists: false } },
    { leaveDate: null },
    { leaveDate: "" },
  ];

  if (search.trim()) {
    const trimmed = search.trim();
    const regex = new RegExp(trimmed, "i");
    const isNumericSearch = /^\d+$/.test(trimmed);

    const searchConditions = [{ name: regex }, { roomNo: regex }, { bedNo: regex }];

    if (isNumericSearch) {
      searchConditions.push({ phoneNo: Number(trimmed) });
      searchConditions.push({ srNo: Number(trimmed) });
    }

    query.$and = [
      {
        $or: searchConditions,
      },
    ];
  }

  return query;
};

// GET all tenants + merge attendance for selected date
const getAttendanceByDate = async (req, res) => {
  try {
    const { date, search = "" } = req.query;

    if (!date) {
      return res.status(400).json({ message: "date query is required" });
    }

    const { start, end } = getDayRange(date);

    const tenants = await Form.find(getTenantQuery(search))
      .select("name srNo roomNo bedNo phoneNo joiningDate leaveDate")
      .sort({ roomNo: 1, bedNo: 1, name: 1 });

    const attendanceDocs = await MealAttendance.find({
      attendanceDate: { $gte: start, $lt: end },
    });

    const attendanceMap = new Map(
      attendanceDocs.map((doc) => [String(doc.tenantId), doc])
    );

    const data = tenants.map((tenant) => {
      const existing = attendanceMap.get(String(tenant._id));

      return {
        tenant: {
          _id: tenant._id,
          srNo: tenant.srNo || "",
          name: tenant.name || "",
          roomNo: tenant.roomNo || "",
          bedNo: tenant.bedNo || "",
          phoneNo: tenant.phoneNo || "",
        },
        attendance: existing
          ? {
              _id: existing._id,
              tenantId: existing.tenantId,
              attendanceDate: existing.attendanceDate,
              breakfastStatus: existing.breakfastStatus || "NotMarked",
              lunchStatus: existing.lunchStatus || "NotMarked",
              dinnerStatus: existing.dinnerStatus || "NotMarked",
              notes: existing.notes || "",
              isClosed: existing.isClosed || false,
            }
          : {
              tenantId: tenant._id,
              attendanceDate: start,
              breakfastStatus: "NotMarked",
              lunchStatus: "NotMarked",
              dinnerStatus: "NotMarked",
              notes: "",
              isClosed: false,
            },
      };
    });

    return res.json({
      message: "Attendance fetched successfully",
      data,
    });
  } catch (error) {
    console.error("getAttendanceByDate error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

// UPSERT single row
const upsertAttendance = async (req, res) => {
  try {
    const {
      date,
      tenantId,
      breakfastStatus,
      lunchStatus,
      dinnerStatus,
      notes = "",
    } = req.body;

    if (!date || !tenantId) {
      return res.status(400).json({ message: "date and tenantId are required" });
    }

    if (!canEditDate(req.user, date)) {
      return res.status(403).json({
        message: "You can only edit today's attendance",
      });
    }

    if (breakfastStatus !== undefined) {
      validateMealStatus(breakfastStatus, "breakfastStatus");
    }
    if (lunchStatus !== undefined) {
      validateMealStatus(lunchStatus, "lunchStatus");
    }
    if (dinnerStatus !== undefined) {
      validateMealStatus(dinnerStatus, "dinnerStatus");
    }

    const tenant = await Form.findById(tenantId);
    if (!tenant) {
      return res.status(404).json({ message: "Tenant not found" });
    }

    const { start, end } = getDayRange(date);

    let doc = await MealAttendance.findOne({
      tenantId,
      attendanceDate: { $gte: start, $lt: end },
    });

    if (doc?.isClosed && req.user?.role !== "super_admin") {
      return res.status(403).json({ message: "This day is already closed" });
    }

    if (!doc) {
      doc = new MealAttendance({
        tenantId,
        attendanceDate: start,
        createdBy: req.user?._id || null,
      });
    }

    if (breakfastStatus !== undefined) {
      doc.breakfastStatus = breakfastStatus;
      doc.breakfastMarkedAt = new Date();
    }

    if (lunchStatus !== undefined) {
      doc.lunchStatus = lunchStatus;
      doc.lunchMarkedAt = new Date();
    }

    if (dinnerStatus !== undefined) {
      doc.dinnerStatus = dinnerStatus;
      doc.dinnerMarkedAt = new Date();
    }

    doc.notes = notes;
    doc.updatedBy = req.user?._id || null;

    await doc.save();

    return res.json({
      message: "Attendance saved successfully",
      data: doc,
    });
  } catch (error) {
    console.error("upsertAttendance error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

// BULK UPSERT
const bulkUpsertAttendance = async (req, res) => {
  try {
    const { date, rows = [] } = req.body;

    if (!date || !Array.isArray(rows) || !rows.length) {
      return res.status(400).json({ message: "date and rows are required" });
    }

    if (!canEditDate(req.user, date)) {
      return res.status(403).json({
        message: "You can only edit today's attendance",
      });
    }

    const { start, end } = getDayRange(date);
    const tenantIds = rows.map((r) => r.tenantId).filter(Boolean);

    const tenants = await Form.find({ _id: { $in: tenantIds } }).select("_id");
    const validTenantSet = new Set(tenants.map((t) => String(t._id)));

    const existingDocs = await MealAttendance.find({
      attendanceDate: { $gte: start, $lt: end },
      tenantId: { $in: tenantIds },
    });

    const existingMap = new Map(
      existingDocs.map((doc) => [String(doc.tenantId), doc])
    );

    const savedRows = [];

    for (const row of rows) {
      const {
        tenantId,
        breakfastStatus,
        lunchStatus,
        dinnerStatus,
        notes = "",
      } = row;

      if (!tenantId || !validTenantSet.has(String(tenantId))) continue;

      if (breakfastStatus !== undefined) {
        validateMealStatus(breakfastStatus, "breakfastStatus");
      }
      if (lunchStatus !== undefined) {
        validateMealStatus(lunchStatus, "lunchStatus");
      }
      if (dinnerStatus !== undefined) {
        validateMealStatus(dinnerStatus, "dinnerStatus");
      }

      let doc = existingMap.get(String(tenantId));

      if (doc?.isClosed && req.user?.role !== "super_admin") {
        continue;
      }

      if (!doc) {
        doc = new MealAttendance({
          tenantId,
          attendanceDate: start,
          createdBy: req.user?._id || null,
        });
      }

      if (breakfastStatus !== undefined) {
        doc.breakfastStatus = breakfastStatus;
        doc.breakfastMarkedAt = new Date();
      }

      if (lunchStatus !== undefined) {
        doc.lunchStatus = lunchStatus;
        doc.lunchMarkedAt = new Date();
      }

      if (dinnerStatus !== undefined) {
        doc.dinnerStatus = dinnerStatus;
        doc.dinnerMarkedAt = new Date();
      }

      doc.notes = notes;
      doc.updatedBy = req.user?._id || null;

      await doc.save();
      savedRows.push(doc);
    }

    return res.json({
      message: "Bulk attendance saved successfully",
      data: savedRows,
    });
  } catch (error) {
    console.error("bulkUpsertAttendance error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

// close day
const closeAttendanceDay = async (req, res) => {
  try {
    const { date } = req.body;

    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }

    if (!canEditDate(req.user, date) && req.user?.role !== "super_admin") {
      return res.status(403).json({ message: "Not allowed to close this date" });
    }

    const { start, end } = getDayRange(date);

    await MealAttendance.updateMany(
      { attendanceDate: { $gte: start, $lt: end } },
      {
        $set: {
          isClosed: true,
          closedAt: new Date(),
          closedBy: req.user?._id || null,
          updatedBy: req.user?._id || null,
        },
      }
    );

    await ExtraMeal.updateMany(
      { mealDate: { $gte: start, $lt: end } },
      {
        $set: {
          isClosed: true,
          updatedBy: req.user?._id || null,
        },
      }
    );

    return res.json({ message: "Day closed successfully" });
  } catch (error) {
    console.error("closeAttendanceDay error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

// reopen day
const reopenAttendanceDay = async (req, res) => {
  try {
    const { date } = req.body;

    if (!date) {
      return res.status(400).json({ message: "date is required" });
    }

    const { start, end } = getDayRange(date);

    await MealAttendance.updateMany(
      { attendanceDate: { $gte: start, $lt: end } },
      {
        $set: {
          isClosed: false,
          closedAt: null,
          closedBy: null,
          updatedBy: req.user?._id || null,
        },
      }
    );

    await ExtraMeal.updateMany(
      { mealDate: { $gte: start, $lt: end } },
      {
        $set: {
          isClosed: false,
          updatedBy: req.user?._id || null,
        },
      }
    );

    return res.json({ message: "Day reopened successfully" });
  } catch (error) {
    console.error("reopenAttendanceDay error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

// summary
const getAttendanceSummary = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: "date query is required" });
    }

    const { start, end } = getDayRange(date);

    const tenants = await Form.find(getTenantQuery()).select("_id");

    const docs = await MealAttendance.find({
      attendanceDate: { $gte: start, $lt: end },
    });

    const extraMeals = await ExtraMeal.find({
      mealDate: { $gte: start, $lt: end },
    });

    const attendanceMap = new Map(
      docs.map((doc) => [String(doc.tenantId), doc])
    );

    const summary = {
      breakfast: { Present: 0, Absent: 0, Leave: 0, Extra: 0, NotMarked: 0 },
      lunch: { Present: 0, Absent: 0, Leave: 0, Extra: 0, NotMarked: 0 },
      dinner: { Present: 0, Absent: 0, Leave: 0, Extra: 0, NotMarked: 0 },
      totalRows: tenants.length,
      extraMealEntries: extraMeals.length,
    };

    tenants.forEach((tenant) => {
      const doc = attendanceMap.get(String(tenant._id));

      const breakfastStatus = doc?.breakfastStatus || "NotMarked";
      const lunchStatus = doc?.lunchStatus || "NotMarked";
      const dinnerStatus = doc?.dinnerStatus || "NotMarked";

      summary.breakfast[breakfastStatus]++;
      summary.lunch[lunchStatus]++;
      summary.dinner[dinnerStatus]++;
    });

    extraMeals.forEach((meal) => {
      const qty = Number(meal.qty) || 1;

      if (meal.mealType === "Breakfast") {
        summary.breakfast.Extra += qty;
      }
      if (meal.mealType === "Lunch") {
        summary.lunch.Extra += qty;
      }
      if (meal.mealType === "Dinner") {
        summary.dinner.Extra += qty;
      }
    });

    return res.json({
      message: "Summary fetched successfully",
      data: summary,
    });
  } catch (error) {
    console.error("getAttendanceSummary error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

// GET extra meals by date
const getExtraMealsByDate = async (req, res) => {
  try {
    const { date } = req.query;

    if (!date) {
      return res.status(400).json({ message: "date query is required" });
    }

    const { start, end } = getDayRange(date);

    const extraMeals = await ExtraMeal.find({
      mealDate: { $gte: start, $lt: end },
    }).sort({ createdAt: -1 });

    return res.json({
      message: "Extra meals fetched successfully",
      data: extraMeals,
    });
  } catch (error) {
    console.error("getExtraMealsByDate error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

// ADD extra meal
const addExtraMeal = async (req, res) => {
  try {
    const { date, personName, phoneNo = "", mealType, qty = 1, notes = "" } = req.body;

    if (!date || !personName || !mealType) {
      return res.status(400).json({
        message: "date, personName and mealType are required",
      });
    }

    if (!["Breakfast", "Lunch", "Dinner"].includes(mealType)) {
      return res.status(400).json({ message: "Invalid meal type" });
    }

    if (!canEditDate(req.user, date)) {
      return res.status(403).json({
        message: "You can only edit today's attendance",
      });
    }

    const { start, end } = getDayRange(date);

    const existingClosedEntry = await ExtraMeal.findOne({
      mealDate: { $gte: start, $lt: end },
      isClosed: true,
    });

    if (existingClosedEntry && req.user?.role !== "super_admin") {
      return res.status(403).json({ message: "This day is already closed" });
    }

    const doc = await ExtraMeal.create({
      mealDate: start,
      personName: personName.trim(),
      phoneNo: phoneNo?.trim() || "",
      mealType,
      qty: Math.max(1, Number(qty) || 1),
      notes: notes?.trim() || "",
      isClosed: false,
      createdBy: req.user?._id || null,
      updatedBy: req.user?._id || null,
    });

    return res.json({
      message: "Extra meal added successfully",
      data: doc,
    });
  } catch (error) {
    console.error("addExtraMeal error:", error);
    return res.status(500).json({
      message: error.message || "Server error",
    });
  }
};

// DELETE extra meal
const deleteExtraMeal = async (req, res) => {
  try {
    const { id } = req.params;

    const doc = await ExtraMeal.findById(id);

    if (!doc) {
      return res.status(404).json({ message: "Extra meal not found" });
    }

    const date = formatYMD(new Date(doc.mealDate));

    if (!canEditDate(req.user, date) && req.user?.role !== "super_admin") {
      return res.status(403).json({
        message: "Not allowed to delete this extra meal",
      });
    }

    if (doc.isClosed && req.user?.role !== "super_admin") {
      return res.status(403).json({ message: "This day is already closed" });
    }

    await ExtraMeal.findByIdAndDelete(id);

    return res.json({ message: "Extra meal deleted successfully" });
  } catch (error) {
    console.error("deleteExtraMeal error:", error);
    return res.status(500).json({ message: error.message || "Server error" });
  }
};

module.exports = {
  getAttendanceByDate,
  upsertAttendance,
  bulkUpsertAttendance,
  closeAttendanceDay,
  reopenAttendanceDay,
  getAttendanceSummary,
  getExtraMealsByDate,
  addExtraMeal,
  deleteExtraMeal,
};