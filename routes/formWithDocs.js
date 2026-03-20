const express = require("express");
const multer = require("multer");
const sharp = require("sharp");

const router = express.Router();

const Form = require("../models/formModels");
const Counter = require("../models/counterModel");
const MessageStat = require("../models/MessageStat");
const MessageEvent = require("../models/MessageEvent");

const ImageKit = require("imagekit");

// ✅ ImageKit init
const imagekit = new ImageKit({
  publicKey: process.env.IMAGEKIT_PUBLIC_KEY || "",
  privateKey: process.env.IMAGEKIT_PRIVATE_KEY || "",
  urlEndpoint: process.env.IMAGEKIT_URL_ENDPOINT || "",
});

const upload = multer({ storage: multer.memoryStorage() });
const TARGET = 10 * 1024; // 10 KB

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

function buildAdmissionMessage({ tenantName, hostelName, roomNo, bedNo, joiningDate }) {
  const dateTxt = joiningDate && !isNaN(new Date(joiningDate).getTime())
    ? new Date(joiningDate).toISOString().slice(0, 10)
    : "";

  const template =
    process.env.ADMISSION_SMS_TEMPLATE ||
    "Dear {{name}}, your admission is confirmed at {{hostel}}. Room {{roomNo}}, Bed {{bedNo}}. Joining date: {{joiningDate}}.";

  return template
    .replace(/{{\s*name\s*}}/gi, String(tenantName || "Tenant"))
    .replace(/{{\s*hostel\s*}}/gi, String(hostelName || "Hostel"))
    .replace(/{{\s*roomNo\s*}}/gi, String(roomNo || "-"))
    .replace(/{{\s*bedNo\s*}}/gi, String(bedNo || "-"))
    .replace(/{{\s*joiningDate\s*}}/gi, String(dateTxt || "-"));
}

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

  const resp = await fetch(
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

  if (!resp.ok) {
    const txt = await resp.text();
    return { status: "failed", error: txt || "Twilio send failed", provider: "twilio", to };
  }
  return { status: "sent", error: "", provider: "twilio", to };
}

async function sendViaMsg91Flow({
  phoneNo,
  tenantName,
  roomNo,
  bedNo,
  joiningDate,
  depositAmount,
}) {
  const authkey = process.env.MSG91_AUTHKEY;
  const flowId = process.env.MSG91_ADMISSION_FLOW_ID;
  const country = String(process.env.MSG91_COUNTRY || "91").trim();
  const sender = process.env.MSG91_SENDER || undefined;

  if (!authkey || !flowId) {
    return { status: "skipped", error: "MSG91 env missing (AUTHKEY/FLOW_ID)", provider: "msg91", to: phoneNo };
  }

  const mobile = normalizeMsg91Mobile(phoneNo);
  if (!mobile) return { status: "skipped", error: "tenant mobile not found", provider: "msg91", to: phoneNo };

  const dt = joiningDate && !isNaN(new Date(joiningDate).getTime())
    ? new Date(joiningDate).toISOString().slice(0, 10)
    : "";

  const payload = {
    flow_id: flowId,
    mobiles: mobile.startsWith(country) ? mobile : `${country}${mobile}`,
    name: String(tenantName || "Tenant"),
    number: `${String(roomNo || "-")}/${String(bedNo || "-")}`,
    Date: String(dt || "-"),
    number1: String(depositAmount ?? ""),
    ROOM_BED: `${String(roomNo || "-")}/${String(bedNo || "-")}`,
    ROOM: String(roomNo || "-"),
    BED: String(bedNo || "-"),
    FROM: String(dt || "-"),
    DATE: String(dt || "-"),
    SECURITY_DEPOSIT: String(depositAmount ?? ""),
    DEPOSIT: String(depositAmount ?? ""),
    AMOUNT: String(depositAmount ?? ""),
    // Uppercase variants
    NAME: String(tenantName || "Tenant"),
    ROOM_NO: String(roomNo || "-"),
    BED_NO: String(bedNo || "-"),
    JOINING_DATE: String(dt || "-"),
    FROM_DATE: String(dt || "-"),
    DEPOSIT_AMOUNT: String(depositAmount ?? ""),
    HOSTEL: String(process.env.HOSTEL_NAME || "Vrunda Hostel"),
    // Lowercase / camelCase variants (for existing MSG91 templates)
    name: String(tenantName || "Tenant"),
    room_bed: `${String(roomNo || "-")}/${String(bedNo || "-")}`,
    roomBed: `${String(roomNo || "-")}/${String(bedNo || "-")}`,
    room: String(roomNo || "-"),
    bed: String(bedNo || "-"),
    from: String(dt || "-"),
    date: String(dt || "-"),
    security_deposit: String(depositAmount ?? ""),
    securityDeposit: String(depositAmount ?? ""),
    deposit: String(depositAmount ?? ""),
    amount: String(depositAmount ?? ""),
    room_no: String(roomNo || "-"),
    roomNo: String(roomNo || "-"),
    bed_no: String(bedNo || "-"),
    bedNo: String(bedNo || "-"),
    joining_date: String(dt || "-"),
    joiningDate: String(dt || "-"),
    from_date: String(dt || "-"),
    fromDate: String(dt || "-"),
    deposit_amount: String(depositAmount ?? ""),
    depositAmount: String(depositAmount ?? ""),
    hostel: String(process.env.HOSTEL_NAME || "Vrunda Hostel"),
  };

  if (sender) payload.sender = sender;

  try {
    console.log("[admission-sms][msg91][request]", {
      flowId,
      mobiles: payload.mobiles,
      sender: sender || "",
      vars: {
        NAME: payload.NAME,
        ROOM_BED: payload.ROOM_BED,
        ROOM: payload.ROOM,
        BED: payload.BED,
        ROOM_NO: payload.ROOM_NO,
        BED_NO: payload.BED_NO,
        FROM: payload.FROM,
        DATE: payload.DATE,
        JOINING_DATE: payload.JOINING_DATE,
        FROM_DATE: payload.FROM_DATE,
        SECURITY_DEPOSIT: payload.SECURITY_DEPOSIT,
        DEPOSIT: payload.DEPOSIT,
        AMOUNT: payload.AMOUNT,
        DEPOSIT_AMOUNT: payload.DEPOSIT_AMOUNT,
        HOSTEL: payload.HOSTEL,
      },
    });

    const resp = await fetch("https://control.msg91.com/api/v5/flow/", {
      method: "POST",
      headers: {
        authkey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    const txt = await resp.text();
    console.log("[admission-sms][msg91][response]", {
      ok: resp.ok,
      status: resp.status,
      body: txt ? String(txt).slice(0, 500) : "",
    });

    if (!resp.ok) {
      return {
        status: "failed",
        error: txt || "MSG91 flow send failed",
        provider: "msg91",
        to: payload.mobiles,
        meta: { httpStatus: resp.status },
      };
    }
    return {
      status: "sent",
      error: "",
      provider: "msg91",
      to: payload.mobiles,
      meta: { httpStatus: resp.status },
    };
  } catch (err) {
    return { status: "failed", error: err.message || "MSG91 flow send failed", provider: "msg91", to: payload.mobiles };
  }
}

async function sendViaWebhook({ to, body }) {
  const url = process.env.SMS_WEBHOOK_URL;
  if (!url) return { status: "skipped", error: "SMS webhook env missing" };

  const key = process.env.SMS_WEBHOOK_KEY || "";
  const resp = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
    },
    body: JSON.stringify({ to, message: body }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    return { status: "failed", error: txt || "Webhook send failed", provider: "webhook", to };
  }
  return { status: "sent", error: "", provider: "webhook", to };
}

async function sendAdmissionSMS({ phoneNo, tenantName, roomNo, bedNo, joiningDate, depositAmount }) {
  const to = normalizeIndianPhone(phoneNo);
  if (!to) return { status: "skipped", error: "tenant mobile not found", provider: "unknown", to: "" };

  const body = buildAdmissionMessage({
    tenantName,
    hostelName: process.env.HOSTEL_NAME || "Vrunda Hostel",
    roomNo,
    bedNo,
    joiningDate,
  });

  try {
    const m91 = await sendViaMsg91Flow({
      phoneNo,
      tenantName,
      roomNo,
      bedNo,
      joiningDate,
      depositAmount,
    });
    if (m91.status === "sent" || m91.status === "failed") return m91;

    const tw = await sendViaTwilio({ to, body });
    if (tw.status === "sent" || tw.status === "failed") return tw;

    const wh = await sendViaWebhook({ to, body });
    if (wh.status === "sent" || wh.status === "failed") return wh;

    return tw;
  } catch (err) {
    return { status: "failed", error: err.message || "SMS send failed" };
  }
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
    console.error("[message-stats] update failed:", err.message || err);
  }
}

// ✅ helper: compress image under 10KB
async function compressUnder10KB(buf) {
  let q = 80,
    w = null;

  let out = await sharp(buf).webp({ quality: q }).toBuffer();

  while (out.length > TARGET && (q > 30 || w === null || w > 200)) {
    if (q > 30) q -= 10;
    else {
      const meta = await sharp(buf).metadata();
      w = w || meta.width || 800;
      w = Math.max(200, Math.floor(w * 0.8));
    }

    const p = sharp(buf);
    if (w) p.resize({ width: w, withoutEnlargement: true });
    out = await p.webp({ quality: q }).toBuffer();
  }

  if (out.length > TARGET) {
    out = await sharp(buf)
      .resize({ width: 200, withoutEnlargement: true })
      .webp({ quality: 25 })
      .toBuffer();
  }

  return out;
}

/* =========================
   ✅ RENT REQUIRED FIELDS HELPERS
========================= */
const MONTHS = [
  "Jan","Feb","Mar","Apr","May","Jun",
  "Jul","Aug","Sep","Oct","Nov","Dec",
];

function fmtMonthKey(d) {
  const dt = new Date(d);
  if (isNaN(dt)) return null;
  return `${MONTHS[dt.getMonth()]}-${String(dt.getFullYear()).slice(-2)}`; // "Jan-26"
}

router.post("/forms-with-docs", upload.array("documents", 10), async (req, res) => {
  try {
    const body = req.body || {};
    const formId = body.formId ? String(body.formId).trim() : null;

    const toDate = (v) => (v ? new Date(v) : undefined);
    const toNum = (v) => (v !== undefined && v !== "" ? Number(v) : undefined);

    const joiningDate = toDate(body.joiningDate);
    const rentAmount = toNum(body.rentAmount ?? body.baseRent);

    if (!rentAmount) {
      return res.status(400).json({ ok: false, message: "rentAmount is required" });
    }

    // ✅ required fields in rents schema
    const paymentMode = String(body.paymentMode || "Cash").trim() || "Cash";
    const rentMonth =
      String(body.month || "").trim() || fmtMonthKey(joiningDate || new Date());

    // ✅ ImageKit STRICT (ImageKit-only)
    const canUseImagekit =
      !!process.env.IMAGEKIT_PUBLIC_KEY &&
      !!process.env.IMAGEKIT_PRIVATE_KEY &&
      !!process.env.IMAGEKIT_URL_ENDPOINT;

    if (!canUseImagekit) {
      return res.status(500).json({
        ok: false,
        message: "ImageKit not configured. Cannot upload documents.",
      });
    }

    const formPayload = {
      name: body.name,
      joiningDate,
      roomNo: body.roomNo,
      depositAmount: toNum(body.depositAmount),
      address: body.address,
      phoneNo: body.phoneNo ? String(body.phoneNo).trim() : "", // ✅ string
      floorNo: body.floorNo,
      bedNo: body.bedNo,
      companyAddress: body.companyAddress,
      dateOfJoiningCollege: toDate(body.dateOfJoiningCollege),
      dob: toDate(body.dob),
      baseRent: toNum(body.baseRent),
      leaveDate: body.leaveDate || undefined,
      category: body.category || undefined,
      tenantParents: body.tenantParents ? String(body.tenantParents).trim() : "",

      // ✅ relatives (if you are sending these)
      relative1Relation: body.relative1Relation,
      relative1Name: body.relative1Name,
      relative1Phone: body.relative1Phone,
      relative2Relation: body.relative2Relation,
      relative2Name: body.relative2Name,
      relative2Phone: body.relative2Phone,
    };

    const files = req.files || [];
    const relations = Array.isArray(body.relations)
      ? body.relations
      : body.relations
      ? [body.relations]
      : [];

    const docs = [];

    // ✅ Upload ALL files to ImageKit
    for (let i = 0; i < files.length; i++) {
      const f = files[i];

      const relation = (relations[i] || "Document").toString().trim() || "Document";
      const safeBaseName = (f.originalname || "doc").replace(/[^\w.\-]/g, "_");

      let uploadBuffer = f.buffer;
      let contentType = f.mimetype;
      let uploadName = `${Date.now()}_${safeBaseName}`;

      // ✅ If image => compress to webp
      if (/^image\//i.test(f.mimetype)) {
        uploadBuffer = await compressUnder10KB(f.buffer);
        contentType = "image/webp";
        uploadName = `${Date.now()}_${safeBaseName}.webp`;
      }

      const uploadRes = await imagekit.upload({
        file: uploadBuffer,
        fileName: uploadName,
        folder: "/vrundahostel/docs",
        useUniqueFileName: true,
      });

      docs.push({
        fileName: f.originalname,
        relation,
        fileId: uploadRes.fileId,     // string
        filePath: uploadRes.filePath, // optional
        contentType,
        size: uploadBuffer.length,
        url: uploadRes.url,           // ✅ always present
      });
    }

    // ✅ Update existing draft
    if (formId) {
      const existing = await Form.findById(formId);
      if (!existing) {
        return res.status(404).json({ ok: false, message: "Draft form not found" });
      }

      Object.assign(existing, formPayload);

      // ✅ patch rents for old data safety
      existing.rents = (Array.isArray(existing.rents) ? existing.rents : []).map((r) => ({
        ...r,
        month: r.month || rentMonth,
        paymentMode: r.paymentMode || paymentMode,
      }));

      if (existing.rents.length === 0) {
        existing.rents = [
          { rentAmount, date: joiningDate || new Date(), month: rentMonth, paymentMode },
        ];
      }

      if (docs.length) {
        existing.documents = [...(existing.documents || []), ...docs];
      }

      await existing.save();

      const admissionSms = await sendAdmissionSMS({
        phoneNo: existing.phoneNo,
        tenantName: existing.name,
        roomNo: existing.roomNo,
        bedNo: existing.bedNo,
        joiningDate: existing.joiningDate,
        depositAmount: existing.depositAmount,
      });
      await bumpMessageStat("admission_sms", admissionSms);
      console.log("[admission-sms]", {
        mode: "updated",
        tenant: existing?.name || "",
        phoneNo: existing?.phoneNo || "",
        status: admissionSms?.status || "unknown",
        error: admissionSms?.error || "",
      });

      return res.json({
        ok: true,
        form: existing,
        mode: "updated",
        imagekit: true,
        admissionSms,
      });
    }

    // ✅ Create new tenant
    const counter = await Counter.findOneAndUpdate(
      { name: "form_srno" },
      { $inc: { seq: 1 } },
      { new: true, upsert: true }
    );

    const srNo = counter.seq;

    const created = await Form.create({
      srNo,
      ...formPayload,
      rents: [{ rentAmount, date: joiningDate || new Date(), month: rentMonth, paymentMode }],
      documents: docs,
    });

    const admissionSms = await sendAdmissionSMS({
      phoneNo: created.phoneNo,
      tenantName: created.name,
      roomNo: created.roomNo,
      bedNo: created.bedNo,
      joiningDate: created.joiningDate,
      depositAmount: created.depositAmount,
    });
    await bumpMessageStat("admission_sms", admissionSms);
    console.log("[admission-sms]", {
      mode: "created",
      tenant: created?.name || "",
      phoneNo: created?.phoneNo || "",
      status: admissionSms?.status || "unknown",
      error: admissionSms?.error || "",
    });

    return res.status(201).json({
      ok: true,
      form: created,
      mode: "created",
      imagekit: true,
      admissionSms,
    });
  } catch (e) {
    console.error("forms-with-docs error:", e);
    return res.status(400).json({ ok: false, message: e.message || "Failed" });
  }
});

module.exports = router;
