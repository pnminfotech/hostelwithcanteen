const express = require("express");
const MessageStat = require("../models/MessageStat");
const MessageEvent = require("../models/MessageEvent");

const router = express.Router();

router.get("/message-stats", async (_req, res) => {
  try {
    const docs = await MessageStat.find().sort({ key: 1 }).lean();
    return res.json({ ok: true, stats: docs });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, message: err.message || "Failed to fetch message stats" });
  }
});

router.get("/message-stats/:key", async (req, res) => {
  try {
    const key = String(req.params.key || "").trim();
    if (!key) return res.status(400).json({ ok: false, message: "key required" });

    const doc = await MessageStat.findOne({ key }).lean();
    return res.json({
      ok: true,
      stat: doc || {
        key,
        total: 0,
        sent: 0,
        failed: 0,
        skipped: 0,
        lastStatus: "",
        lastError: "",
        lastAt: null,
      },
    });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, message: err.message || "Failed to fetch message stat" });
  }
});

router.get("/message-stats-summary", async (_req, res) => {
  try {
    const stats = await MessageStat.find().lean();
    const summary = stats.reduce(
      (acc, s) => {
        acc.total += Number(s.total || 0);
        acc.sent += Number(s.sent || 0);
        acc.failed += Number(s.failed || 0);
        acc.skipped += Number(s.skipped || 0);
        return acc;
      },
      { total: 0, sent: 0, failed: 0, skipped: 0 }
    );

    return res.json({ ok: true, allTime: summary, byKey: stats });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, message: err.message || "Failed to fetch message stats summary" });
  }
});

router.get("/message-events", async (req, res) => {
  try {
    const key = String(req.query.key || "").trim();
    const status = String(req.query.status || "").trim().toLowerCase();
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));

    const filter = {};
    if (key) filter.key = key;
    if (status) filter.status = status;

    const events = await MessageEvent.find(filter).sort({ createdAt: -1 }).limit(limit).lean();
    return res.json({ ok: true, count: events.length, events });
  } catch (err) {
    return res
      .status(500)
      .json({ ok: false, message: err.message || "Failed to fetch message events" });
  }
});

module.exports = router;
