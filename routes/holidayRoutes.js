const express = require("express");
const Holiday = require("../models/Holiday");
const Form = require("../models/formModels");

const router = express.Router();

const toISODate = (v) => new Date(v).toISOString().slice(0, 10);

const calcTotalDays = (fromDate, toDate) => {
  const start = new Date(fromDate);
  const end = new Date(toDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(0, 0, 0, 0);
  return Math.floor((end - start) / (24 * 60 * 60 * 1000)) + 1;
};

const getTodayStart = () => {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
};

const isPastToDate = (toDate) => {
  const end = new Date(toDate);
  if (isNaN(end.getTime())) return false;
  end.setHours(0, 0, 0, 0);
  return end < getTodayStart(); // "passed" means date is before today
};

const getAutoStatus = (toDate) => (isPastToDate(toDate) ? "returned" : "active");

async function autoReturnExpiredHolidays() {
  const today = getTodayStart();
  await Holiday.updateMany(
    { status: "active", toDate: { $lt: today } },
    { $set: { status: "returned", returnedAt: new Date() } }
  );
}

const resolveParentMobile = (tenant) => {
  return String(
    tenant?.relative1Phone ||
      tenant?.relative2Phone ||
      tenant?.phoneNo ||
      ""
  ).trim();
};

async function sendViaTwilio({ to, body }) {
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const token = process.env.TWILIO_AUTH_TOKEN;
  const from = process.env.TWILIO_FROM;
  if (!sid || !token || !from) return { status: "skipped", error: "Twilio env missing" };

  const auth = Buffer.from(`${sid}:${token}`).toString("base64");
  const form = new URLSearchParams();
  form.set("To", to);
  form.set("From", from);
  form.set("Body", body);

  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${auth}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    return { status: "failed", error: txt || "Twilio send failed" };
  }
  return { status: "sent", error: "" };
}

async function sendViaWebhook({ to, body }) {
  const url = process.env.SMS_WEBHOOK_URL;
  if (!url) return { status: "skipped", error: "SMS webhook env missing" };

  const key = process.env.SMS_WEBHOOK_KEY || "";
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ to, message: body }),
  });

  if (!res.ok) {
    const txt = await res.text();
    return { status: "failed", error: txt || "Webhook send failed" };
  }
  return { status: "sent", error: "" };
}

async function sendHolidaySMS({ parentMobile, tenantName, fromDate, toDate }) {
  if (!parentMobile) return { status: "skipped", error: "Parent mobile not found" };

  const message = [
    "Dear Parent,",
    "",
    `Your child ${tenantName} will be on holiday from ${toISODate(fromDate)} to ${toISODate(toDate)}.`,
    "",
    "- Hostel Management",
  ].join("\n");

  try {
    const twilioRes = await sendViaTwilio({ to: parentMobile, body: message });
    if (twilioRes.status === "sent") return twilioRes;
    if (twilioRes.status === "failed") return twilioRes;

    const webhookRes = await sendViaWebhook({ to: parentMobile, body: message });
    if (webhookRes.status === "sent" || webhookRes.status === "failed") return webhookRes;

    return twilioRes;
  } catch (err) {
    return { status: "failed", error: err.message || "SMS send failed" };
  }
}

router.get("/", async (_req, res) => {
  try {
    await autoReturnExpiredHolidays();
    const holidays = await Holiday.find().sort({ createdAt: -1 }).lean();
    res.json(holidays);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch holidays", error: err.message });
  }
});

router.post("/", async (req, res) => {
  try {
    const { tenantId, fromDate, toDate } = req.body || {};
    if (!tenantId || !fromDate || !toDate) {
      return res.status(400).json({ message: "tenantId, fromDate, toDate are required" });
    }

    const from = new Date(fromDate);
    const to = new Date(toDate);
    if (isNaN(from.getTime()) || isNaN(to.getTime())) {
      return res.status(400).json({ message: "Invalid fromDate/toDate" });
    }
    if (from > to) return res.status(400).json({ message: "fromDate cannot be after toDate" });

    const tenant = await Form.findById(tenantId).lean();
    if (!tenant) return res.status(404).json({ message: "Tenant not found" });

    const totalDays = calcTotalDays(from, to);
    const parentMobile = resolveParentMobile(tenant);
    const sms = await sendHolidaySMS({
      parentMobile,
      tenantName: tenant.name,
      fromDate: from,
      toDate: to,
    });

    const doc = await Holiday.create({
      tenantId: tenant._id,
      tenantName: tenant.name,
      parentMobile,
      fromDate: from,
      toDate: to,
      totalDays,
      status: getAutoStatus(to),
      returnedAt: isPastToDate(to) ? new Date() : null,
      smsStatus: sms.status,
      smsError: sms.error || "",
    });

    res.status(201).json({ message: "Holiday saved", holiday: doc });
  } catch (err) {
    res.status(500).json({ message: "Failed to save holiday", error: err.message });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { fromDate, toDate, status } = req.body || {};
    const patch = {};

    if (fromDate) patch.fromDate = new Date(fromDate);
    if (toDate) patch.toDate = new Date(toDate);
    if (status) patch.status = status;

    if (patch.fromDate && isNaN(patch.fromDate.getTime())) {
      return res.status(400).json({ message: "Invalid fromDate" });
    }
    if (patch.toDate && isNaN(patch.toDate.getTime())) {
      return res.status(400).json({ message: "Invalid toDate" });
    }

    const current = await Holiday.findById(req.params.id);
    if (!current) return res.status(404).json({ message: "Holiday not found" });

    const start = patch.fromDate || current.fromDate;
    const end = patch.toDate || current.toDate;
    if (start > end) return res.status(400).json({ message: "fromDate cannot be after toDate" });

    patch.totalDays = calcTotalDays(start, end);

    // Auto status by date unless user explicitly forces status in request
    if (!status) {
      patch.status = getAutoStatus(end);
      patch.returnedAt = patch.status === "returned" ? new Date() : null;
    }

    const updated = await Holiday.findByIdAndUpdate(req.params.id, { $set: patch }, { new: true });
    res.json({ message: "Holiday updated", holiday: updated });
  } catch (err) {
    res.status(500).json({ message: "Failed to update holiday", error: err.message });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const deleted = await Holiday.findByIdAndDelete(req.params.id);
    if (!deleted) return res.status(404).json({ message: "Holiday not found" });
    res.json({ message: "Holiday deleted" });
  } catch (err) {
    res.status(500).json({ message: "Failed to delete holiday", error: err.message });
  }
});

router.patch("/:id/return", async (req, res) => {
  try {
    const updated = await Holiday.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "returned", returnedAt: new Date() } },
      { new: true }
    );
    if (!updated) return res.status(404).json({ message: "Holiday not found" });
    res.json({ message: "Tenant marked as returned", holiday: updated });
  } catch (err) {
    res.status(500).json({ message: "Failed to mark returned", error: err.message });
  }
});

module.exports = router;
