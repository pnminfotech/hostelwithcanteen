const express = require("express");
const Holiday = require("../models/Holiday");
const Form = require("../models/formModels");
const MessageStat = require("../models/MessageStat");
const MessageEvent = require("../models/MessageEvent");

const router = express.Router();

const toISODate = (v) => new Date(v).toISOString().slice(0, 10);

function normalizeIndianPhone(v) {
  const digits = String(v || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return `+${digits}`;
  if (digits.length >= 11 && digits.startsWith("0")) return `+91${digits.slice(1, 11)}`;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function normalizeMsg91Mobile(v) {
  const digits = String(v || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10) return `91${digits}`;
  if (digits.length === 12 && digits.startsWith("91")) return digits;
  if (digits.length >= 11 && digits.startsWith("0")) return `91${digits.slice(1, 11)}`;
  return digits;
}

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

const resolveParentMobile = (tenant) =>
  String(
    tenant?.tenantParents ||
      tenant?.tenantParentPhone ||
      tenant?.parentMobile ||
      tenant?.parentPhone ||
      ""
  ).trim();

const resolveHolidayRecipients = (tenant) => {
  const parentMobile = resolveParentMobile(tenant);

  const recipients = [];
  const parentNorm = normalizeIndianPhone(parentMobile);
  if (parentNorm) recipients.push(parentNorm);

  return {
    parentMobile: parentNorm || "",
    recipients,
  };
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
    return { status: "failed", error: txt || "Twilio send failed", provider: "twilio", to };
  }
  return { status: "sent", error: "", provider: "twilio", to };
}

async function sendViaMsg91Flow({ phoneNo, flowId, vars }) {
  const authkey = process.env.MSG91_AUTHKEY;
  const country = String(process.env.MSG91_COUNTRY || "91").trim();
  const sender = process.env.MSG91_SENDER || undefined;

  if (!authkey || !flowId) {
    return { status: "skipped", error: "MSG91 env missing (AUTHKEY/FLOW_ID)", provider: "msg91", to: phoneNo };
  }

  const mobile = normalizeMsg91Mobile(phoneNo);
  if (!mobile) return { status: "skipped", error: "recipient mobile not found", provider: "msg91", to: phoneNo };

  const payload = {
    flow_id: flowId,
    mobiles: mobile.startsWith(country) ? mobile : `${country}${mobile}`,
    ...(vars || {}),
  };
  if (sender) payload.sender = sender;

  try {
    const resp = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        authkey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const txt = await resp.text();
    if (!resp.ok) {
      return {
        status: "failed",
        error: txt || "MSG91 flow send failed",
        provider: "msg91",
        to: payload.mobiles,
        meta: { httpStatus: resp.status, flowId },
      };
    }
    return {
      status: "sent",
      error: "",
      provider: "msg91",
      to: payload.mobiles,
      meta: { httpStatus: resp.status, flowId },
    };
  } catch (err) {
    return { status: "failed", error: err.message || "MSG91 flow send failed", provider: "msg91", to: payload.mobiles };
  }
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
    return { status: "failed", error: txt || "Webhook send failed", provider: "webhook", to };
  }
  return { status: "sent", error: "", provider: "webhook", to };
}

async function bumpMessageStat(key, result) {
  try {
    const status = String(result?.status || "unknown").toLowerCase();
    const inc = { total: 1 };
    if (status === "sent") inc.sent = 1;
    else if (status === "failed") inc.failed = 1;
    else if (status === "skipped") inc.skipped = 1;

    await MessageStat.findOneAndUpdate(
      { key },
      {
        $inc: inc,
        $set: {
          lastStatus: status,
          lastError: String(result?.error || ""),
          lastAt: new Date(),
        },
      },
      { upsert: true, new: true }
    );

    await MessageEvent.create({
      key,
      status: ["sent", "failed", "skipped"].includes(status) ? status : "unknown",
      provider: String(result?.provider || "unknown"),
      to: String(result?.to || ""),
      error: String(result?.error || ""),
      meta: result?.meta || {},
    });
  } catch (err) {
    console.error("[message-stats] holiday update failed:", err.message || err);
  }
}

async function sendHolidayStartSMS({ recipients, tenantName, fromDate, toDate }) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { status: "skipped", error: "No recipients found", results: [] };
  }

  const message = [
    "Dear Parent,",
    "",
    `Your child ${tenantName} will be on holiday from ${toISODate(fromDate)} to ${toISODate(toDate)}.`,
    "",
    "- Hostel Management",
  ].join("\n");
  const fromTxt = toISODate(fromDate);
  const toTxt = toISODate(toDate);

  const results = [];
  for (const to of recipients) {
    const m91 = await sendViaMsg91Flow({
      phoneNo: to,
      flowId: process.env.MSG91_HOLIDAY_FLOW_ID || process.env.MSG91_ADMISSION_FLOW_ID,
      vars: {
        NAME: String(tenantName || "Student"),
        Date: fromTxt,
        Date1: toTxt,
        FROM_DATE: fromTxt,
        TO_DATE: toTxt,
        FROM: fromTxt,
        TO: toTxt,
        DATE_FROM: fromTxt,
        DATE_TO: toTxt,
        START_DATE: fromTxt,
        END_DATE: toTxt,
        HOSTEL: String(process.env.HOSTEL_NAME || "Vrunda Hostel"),
        name: String(tenantName || "Student"),
        from_date: fromTxt,
        to_date: toTxt,
        from: fromTxt,
        to: toTxt,
        date_from: fromTxt,
        date_to: toTxt,
        start_date: fromTxt,
        end_date: toTxt,
        hostel: String(process.env.HOSTEL_NAME || "Vrunda Hostel"),
      },
    });
    let finalRes = m91;
    if (m91.status === "skipped") {
      const twilioRes = await sendViaTwilio({ to, body: message });
      finalRes = twilioRes;
      if (twilioRes.status === "skipped") {
        finalRes = await sendViaWebhook({ to, body: message });
        if (finalRes.status === "skipped") finalRes = m91;
      }
    }
    results.push({ to, ...finalRes });
  }

  const hasSent = results.some((r) => r.status === "sent");
  const hasFailed = results.some((r) => r.status === "failed");
  return {
    status: hasSent ? "sent" : hasFailed ? "failed" : "skipped",
    error: results.filter((r) => r.status !== "sent").map((r) => `${r.to}: ${r.error || r.status}`).join(" | "),
    results,
  };
}

async function sendHolidayReturnSMS({ recipients, tenantName, returnDate }) {
  if (!Array.isArray(recipients) || recipients.length === 0) {
    return { status: "skipped", error: "No recipients found", results: [] };
  }
  const dateTxt = toISODate(returnDate || new Date());

  const message = [
    "Dear Parent,",
    "",
    `Your child ${tenantName} has arrived to the hostel on ${dateTxt}.`,
    "",
    "- Hostel Management",
  ].join("\n");

  const results = [];
  for (const to of recipients) {
    const m91 = await sendViaMsg91Flow({
      phoneNo: to,
      flowId: process.env.MSG91_HOLIDAY_RETURN_FLOW_ID || process.env.MSG91_HOLIDAY_FLOW_ID || process.env.MSG91_ADMISSION_FLOW_ID,
      vars: {
        NAME: String(tenantName || "Student"),
        Date: dateTxt,
        STATUS: "returned",
        DATE: dateTxt,
        ARRIVAL_DATE: dateTxt,
        HOSTEL: String(process.env.HOSTEL_NAME || "Vrunda Hostel"),
        name: String(tenantName || "Student"),
        date: dateTxt,
        arrival_date: dateTxt,
        status: "returned",
        hostel: String(process.env.HOSTEL_NAME || "Vrunda Hostel"),
      },
    });
    let finalRes = m91;
    if (m91.status === "skipped") {
      const twilioRes = await sendViaTwilio({ to, body: message });
      finalRes = twilioRes;
      if (twilioRes.status === "skipped") {
        finalRes = await sendViaWebhook({ to, body: message });
        if (finalRes.status === "skipped") finalRes = m91;
      }
    }
    results.push({ to, ...finalRes });
  }

  const hasSent = results.some((r) => r.status === "sent");
  const hasFailed = results.some((r) => r.status === "failed");
  return {
    status: hasSent ? "sent" : hasFailed ? "failed" : "skipped",
    error: results.filter((r) => r.status !== "sent").map((r) => `${r.to}: ${r.error || r.status}`).join(" | "),
    results,
  };
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
    const { parentMobile, recipients } = resolveHolidayRecipients(tenant);
    const sms = await sendHolidayStartSMS({
      recipients,
      tenantName: tenant.name,
      fromDate: from,
      toDate: to,
    });
    if (Array.isArray(sms?.results) && sms.results.length) {
      for (const r of sms.results) await bumpMessageStat("holiday_start_sms", r);
    } else {
      await bumpMessageStat("holiday_start_sms", sms);
    }

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

    let returnSms = null;
    const becameReturned = current.status !== "returned" && updated?.status === "returned";
    if (becameReturned) {
      const tenant = await Form.findById(current.tenantId).lean();
      const { recipients } = resolveHolidayRecipients(tenant || {});
      returnSms = await sendHolidayReturnSMS({
        recipients,
        tenantName: updated.tenantName || tenant?.name || "Student",
        returnDate: updated.returnedAt || new Date(),
      });
      if (Array.isArray(returnSms?.results) && returnSms.results.length) {
        for (const r of returnSms.results) await bumpMessageStat("holiday_return_sms", r);
      } else {
        await bumpMessageStat("holiday_return_sms", returnSms);
      }
    }

    res.json({ message: "Holiday updated", holiday: updated, returnSms });
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
    const existing = await Holiday.findById(req.params.id);
    if (!existing) return res.status(404).json({ message: "Holiday not found" });

    const updated = await Holiday.findByIdAndUpdate(
      req.params.id,
      { $set: { status: "returned", returnedAt: new Date() } },
      { new: true }
    );

    let returnSms = null;
    if (existing.status !== "returned") {
      const tenant = await Form.findById(updated.tenantId).lean();
      const { recipients } = resolveHolidayRecipients(tenant || {});
      returnSms = await sendHolidayReturnSMS({
        recipients,
        tenantName: updated.tenantName || tenant?.name || "Student",
        returnDate: updated.returnedAt || new Date(),
      });
      if (Array.isArray(returnSms?.results) && returnSms.results.length) {
        for (const r of returnSms.results) await bumpMessageStat("holiday_return_sms", r);
      } else {
        await bumpMessageStat("holiday_return_sms", returnSms);
      }
    }

    res.json({ message: "Tenant marked as returned", holiday: updated, returnSms });
  } catch (err) {
    res.status(500).json({ message: "Failed to mark returned", error: err.message });
  }
});

module.exports = router;
