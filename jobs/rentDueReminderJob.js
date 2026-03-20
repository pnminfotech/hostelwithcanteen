const Form = require("../models/formModels");
const MessageStat = require("../models/MessageStat");
const MessageEvent = require("../models/MessageEvent");

const EVENT_KEY = "rent_due_2d_sms";
const RUN_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DUE_DAYS_BEFORE = 2;

const toNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

const dayStart = (v) => {
  const d = new Date(v);
  d.setHours(0, 0, 0, 0);
  return d;
};

const addDays = (v, days) => {
  const d = dayStart(v);
  d.setDate(d.getDate() + Number(days || 0));
  return d;
};

const sameDay = (a, b) => dayStart(a).getTime() === dayStart(b).getTime();

const toMonthKey = (y, m /* 0..11 */) =>
  `${new Date(y, m, 1).toLocaleString("en-US", { month: "short" })}-${String(y).slice(-2)}`;

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

const getExpectedRent = (tenant) =>
  toNum(tenant?.baseRent) ||
  toNum(tenant?.rentAmount) ||
  toNum(tenant?.rent) ||
  toNum(tenant?.monthlyRent) ||
  0;

const getDueDate = (joiningDate, y, m) => {
  const jd = new Date(joiningDate);
  const dueDay = jd.getDate() || 1;
  const monthLastDay = new Date(y, m + 1, 0).getDate();
  return new Date(y, m, Math.min(dueDay, monthLastDay));
};

const getCurrentMonthRentRecord = (tenant, y, m, monthKey) => {
  const rents = Array.isArray(tenant?.rents) ? tenant.rents : [];
  return (
    rents.find((r) => String(r?.month || "").trim() === monthKey) ||
    rents.find((r) => {
      if (!r?.date) return false;
      const d = new Date(r.date);
      return d.getFullYear() === y && d.getMonth() === m;
    }) ||
    null
  );
};

async function sendViaMsg91Flow({ phoneNo, flowId, vars }) {
  const authkey = process.env.MSG91_AUTHKEY;
  const country = String(process.env.MSG91_COUNTRY || "91").trim();
  const sender = process.env.MSG91_SENDER || undefined;

  if (!authkey || !flowId) {
    return {
      status: "skipped",
      error: "MSG91 env missing (AUTHKEY/FLOW_ID)",
      provider: "msg91",
      to: phoneNo,
    };
  }

  const mobile = normalizeMsg91Mobile(phoneNo);
  if (!mobile) {
    return {
      status: "skipped",
      error: "recipient mobile not found",
      provider: "msg91",
      to: phoneNo,
    };
  }

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
    return {
      status: "failed",
      error: err.message || "MSG91 flow send failed",
      provider: "msg91",
      to: payload.mobiles,
    };
  }
}

async function bumpMessageStat(key, result, extraMeta = {}) {
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
    meta: { ...(result?.meta || {}), ...extraMeta },
  });
}

async function alreadySentForMonth(tenantId, monthKey) {
  const exists = await MessageEvent.findOne({
    key: EVENT_KEY,
    status: "sent",
    "meta.tenantId": String(tenantId),
    "meta.monthKey": monthKey,
  })
    .select("_id")
    .lean();
  return !!exists;
}

async function processRentDueReminders() {
  const today = dayStart(new Date());
  const y = today.getFullYear();
  const m = today.getMonth();
  const monthKey = toMonthKey(y, m);

  const tenants = await Form.find().lean();
  let checked = 0;
  let attempted = 0;

  for (const t of tenants) {
    checked += 1;

    if (!t?.joiningDate) continue;
    const joining = new Date(t.joiningDate);
    if (Number.isNaN(joining.getTime())) continue;

    // Rent starts from next month after joining
    const rentStart = new Date(joining.getFullYear(), joining.getMonth() + 1, 1);
    if (today < dayStart(rentStart)) continue;

    if (t?.leaveDate) {
      const ld = new Date(t.leaveDate);
      if (!Number.isNaN(ld.getTime()) && dayStart(ld) < today) continue;
    }

    const dueDate = getDueDate(t.joiningDate, y, m);
    const reminderDate = addDays(dueDate, -DUE_DAYS_BEFORE);
    if (!sameDay(today, reminderDate)) continue;

    const expected = getExpectedRent(t);
    if (expected <= 0) continue;

    const rec = getCurrentMonthRentRecord(t, y, m, monthKey);
    const paid = toNum(rec?.rentAmount);
    const outstanding = Math.max(0, expected - paid);
    if (outstanding <= 0) continue;

    const parentPhone = normalizeIndianPhone(
      t?.tenantParents ||
        t?.tenantParentPhone ||
        t?.parentMobile ||
        t?.parentPhone ||
        ""
    );

    if (!parentPhone) {
      await bumpMessageStat(
        EVENT_KEY,
        { status: "skipped", error: "tenantParents not found", provider: "msg91", to: "" },
        {
          tenantId: String(t._id),
          monthKey,
          dueDate: dueDate.toISOString().slice(0, 10),
        }
      );
      continue;
    }

    if (await alreadySentForMonth(t._id, monthKey)) continue;

    attempted += 1;
    const dueDateTxt = dueDate.toISOString().slice(0, 10);

    const flowId =
      process.env.MSG91_RENT_DUE_2D_FLOW_ID ||
      process.env.MSG91_PAYMENT_DUE_2D_FLOW_ID ||
      process.env.MSG91_ADMISSION_FLOW_ID;

    const sms = await sendViaMsg91Flow({
      phoneNo: parentPhone,
      flowId,
      vars: {
        NAME: String(t?.name || "Tenant"),
        DUE_DATE: dueDateTxt,
        MONTH: monthKey,
        AMOUNT_DUE: String(outstanding),
        HOSTEL: String(process.env.HOSTEL_NAME || "Vrunda Hostel"),
        name: String(t?.name || "Tenant"),
        due_date: dueDateTxt,
        month: monthKey,
        amount_due: String(outstanding),
        hostel: String(process.env.HOSTEL_NAME || "Vrunda Hostel"),
      },
    });

    await bumpMessageStat(EVENT_KEY, sms, {
      tenantId: String(t._id),
      monthKey,
      dueDate: dueDateTxt,
      expected,
      paid,
      outstanding,
    });
  }

  return { checked, attempted, monthKey };
}

let inProgress = false;
async function runRentDueReminderTick() {
  if (inProgress) return { skipped: true, reason: "already_running" };
  inProgress = true;
  try {
    return await processRentDueReminders();
  } catch (err) {
    console.error("[rent_due_2d_sms] job failed:", err.message || err);
    return { error: err.message || "job failed" };
  } finally {
    inProgress = false;
  }
}

function startRentDueReminderJob() {
  setInterval(runRentDueReminderTick, RUN_INTERVAL_MS);
  setTimeout(runRentDueReminderTick, 15 * 1000);
}

module.exports = {
  runRentDueReminderTick,
  processRentDueReminders,
  startRentDueReminderJob,
};

