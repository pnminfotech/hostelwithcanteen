// server.js (CommonJS)
const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const path = require("path");

dotenv.config();

const { connectDB } = require("./config/db");

// Routers
const formRoutes = require("./routes/formRoutes");
const maintenanceRoutes = require("./routes/MaintRoutes");
const supplierRoutes = require("./routes/supplierRoutes");
const projectRoutes = require("./routes/Project");
const roomRoutes = require("./routes/roomRoutes");
const lightBillRoutes = require("./routes/lightBillRoutes");
const otherExpenseRoutes = require("./routes/otherExpenseRoutes");
const uploadRoutes = require("./routes/uploadRoutes");
const authRoutes = require("./routes/authRoutes");
const formWithDocsRoutes = require("./routes/formWithDocs");
const documentRoutes = require("./routes/documentRoutes");
const tenantRoutes = require("./routes/tenant");
const paymentRoutes = require("./routes/payments");
const leaveRoutes = require("./routes/leaveRoutes");
const adminNotificationsRouter = require("./routes/adminattendenceNotifications");
const adminLeaveRoutes = require("./routes/adminLeaveRoutes");
const tenantDocsRoutes = require("./routes/tenantDocs");
const invitesRouter = require("./routes/invites");
const holidayRoutes = require("./routes/holidayRoutes");
const messageStatsRoutes = require("./routes/messageStats");
const canteenExpenseRoutes = require("./routes/canteenExpenseRoutes");
const mealAttendanceRoutes = require("./routes/mealAttendanceRoutes");
const { startRentDueReminderJob } = require("./jobs/rentDueReminderJob");

const app = express();

app.use(cors());
app.use(express.json());

// Static files for uploaded content (if any local)
app.use("/uploads", express.static(path.join(__dirname, "uploads")));

app.use("/api/tenant-docs", tenantDocsRoutes);

app.get("/.well-known/appspecific/com.chrome.devtools.json", (_req, res) =>
  res.sendStatus(204)
);

app.get("/api/health", (_req, res) =>
  res.json({ ok: true, env: process.env.NODE_ENV || "dev" })
);

// Routes
app.use("/api", authRoutes);
app.use("/api", formRoutes);
app.use("/api", formWithDocsRoutes); // ✅ no trailing slash
app.use("/api", projectRoutes);

app.use("/api/maintenance", maintenanceRoutes);
app.use("/api/suppliers", supplierRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/light-bill", lightBillRoutes);
app.use("/api/other-expense", otherExpenseRoutes);
app.use("/api/uploads", uploadRoutes);
app.use("/api/documents", documentRoutes);
app.use("/api/tenant", tenantRoutes);
app.use("/api/payments", paymentRoutes);
app.use("/api/invites", invitesRouter);
app.use("/api/tenant/leaves", leaveRoutes);
app.use("/api/tenant-holidays", holidayRoutes);

app.use("/api/staff-expenses", require("./routes/staffExpenseRoutes"));
app.use("/api", require("./routes/notifications"));
app.use("/api/admin", adminLeaveRoutes);
app.use("/api", require("./routes/tenantAttendance"));
app.use("/api/admin", adminNotificationsRouter);
app.use("/api", messageStatsRoutes);
app.use("/api/canteen-expenses", canteenExpenseRoutes);
app.use("/api/meal-attendance", mealAttendanceRoutes);
connectDB();
startRentDueReminderJob();

const PORT = process.env.PORT || 8000;
app.listen(PORT, () => {
  console.log(`✅ Server running: http://localhost:${PORT}`);
  console.log(`✅ Health:        http://localhost:${PORT}/api/health`);
});
