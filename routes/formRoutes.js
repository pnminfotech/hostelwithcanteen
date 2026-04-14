// routes/formRoutes.js
const express = require("express");
const router = express.Router();

// Models (used by a couple of inline routes)
const Form = require("../models/formModels");
const Room = require("../models/Room");

// Controllers
const {
  getNextSrNo,
  rentAmountDel,
  processLeave,
  getFormById,
  getForms,
  updateFormById,
  updateProfile,
  getArchivedForms,
  saveLeaveDate,
  restoreForm,
  archiveForm,
  getDuplicateForms,
  deleteForm,
  updateForm,
  saveForm, // kept/exported for legacy use (NOT bound to POST /forms)
  getAllForms,
} = require("../controllers/formController");

const {
  createWithOptionalInvite,
} = require("../controllers/forms/createWithOptionalInvite");

// NEW: invite controller routes
const { createInvite, validateInvite } = require("../controllers/invites");

// ───────────────────────────────────────────────────────────────────────────────
// CREATE: must be the ONLY creator for /forms
// NOTE: Inside createWithOptionalInvite, you should also use
//       assignNextSrNoAndUpdateCounter() from formController
//       instead of trusting srNo from frontend.
// ───────────────────────────────────────────────────────────────────────────────
router.post("/forms", createWithOptionalInvite);

// For UI to show next SrNo (server still assigns the real one)
router.get("/forms/count", getNextSrNo);

// ───────────────────────────────────────────────────────────────────────────────
// INVITES (create + validate)
// ───────────────────────────────────────────────────────────────────────────────
router.post("/invites", createInvite);
router.get("/invites/:token", validateInvite);

// ───────────────────────────────────────────────────────────────────────────────
// READ / UPDATE / DELETE
// ───────────────────────────────────────────────────────────────────────────────
router.get("/", getAllForms);

router.delete("/form/:id", deleteForm);
router.get("/duplicateforms", getDuplicateForms);

router.post("/forms/leave", saveLeaveDate);
router.post("/forms/archive", archiveForm);
router.post("/forms/restore", restoreForm);

router.put("/update/:id", updateProfile);
router.get("/forms", getForms);
router.post("/leave", processLeave);

router.get("/forms/archived", getArchivedForms);
router.get("/form/:id", getFormById);
// ✅ UPDATE full form record (tenant intake update)
// router.patch("/forms/:id", updateFormById);
router.put("/forms/:id", updateFormById);

// rent entry delete by monthKey
router.delete("/form/:formId/rent/:monthYear", rentAmountDel);

// rent create/update
router.put("/form/:id", updateForm);

// cancel leave inline route
router.post("/cancel-leave", async (req, res) => {
  const { id } = req.body;
  try {
    const tenant = await Form.findById(id).lean();
    if (!tenant) {
      return res.status(404).json({ success: false, message: "Form not found" });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const isActiveLeave = (leaveDate) => {
      if (!leaveDate) return false;
      const d = new Date(leaveDate);
      if (Number.isNaN(d.getTime())) return false;
      d.setHours(0, 0, 0, 0);
      return d >= today;
    };

    const normalize = (value) => String(value ?? "").trim();

    const activeTenants = await Form.find(
      { _id: { $ne: id } },
      { roomNo: 1, bedNo: 1, leaveDate: 1 }
    ).lean();

    const occupiedBeds = new Set(
      activeTenants
        .filter((t) => normalize(t.roomNo) && normalize(t.bedNo) && (!t.leaveDate || isActiveLeave(t.leaveDate)))
        .map((t) => `${normalize(t.roomNo)}-${normalize(t.bedNo)}`)
    );

    const originalRoomNo = normalize(tenant.roomNo);
    const originalBedNo = normalize(tenant.bedNo);
    const originalKey = `${originalRoomNo}-${originalBedNo}`;

    const rooms = await Room.find({}, { roomNo: 1, floorNo: 1, category: 1, beds: 1 })
      .sort({ floorNo: 1, roomNo: 1 })
      .lean();

    const availableBeds = [];
    for (const room of rooms) {
      for (const bed of room.beds || []) {
        const key = `${normalize(room.roomNo)}-${normalize(bed.bedNo)}`;
        if (!occupiedBeds.has(key)) {
          availableBeds.push({
            roomNo: room.roomNo,
            bedNo: bed.bedNo,
            floorNo: room.floorNo,
            category: room.category || "",
            price: bed.price ?? null,
          });
        }
      }
    }

    const originalBedAvailable = !occupiedBeds.has(originalKey);

    if (!originalRoomNo || !originalBedNo || originalBedAvailable) {
      await Form.findByIdAndUpdate(id, { $unset: { leaveDate: "" } });
      return res.json({
        success: true,
        message: "Leave canceled successfully.",
        restoredBed: { roomNo: tenant.roomNo, bedNo: tenant.bedNo },
      });
    }

    return res.status(409).json({
      success: false,
      message: `Room ${tenant.roomNo} / Bed ${tenant.bedNo} is already occupied.`,
      originalBed: { roomNo: tenant.roomNo, bedNo: tenant.bedNo },
      availableBeds,
    });
  } catch (error) {
    res.status(500).json({ success: false, error: "Error cancelling leave" });
  }
});

module.exports = router;
