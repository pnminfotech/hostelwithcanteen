// // routes/roomRoutes.js
// const express = require("express");
// const router = express.Router();
// const Room = require("../models/Room");

// // 🔔 Log when this router file is loaded by server.js
// console.log("✅ roomRoutes.js loaded");

// /* ------------------- GET all rooms ------------------- */
// // GET /api/rooms
// router.get("/", async (req, res) => {
//   try {
//     const rooms = await Room.find().sort({ floorNo: 1, roomNo: 1 });
//     res.json(rooms);
//   } catch (err) {
//     console.error("Error fetching rooms:", err);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// /* ------------------- Create room --------------------- */
// // POST /api/rooms
// // body: { category, floorNo, roomNo }
// router.post("/", async (req, res) => {
//   try {
//     const { category, floorNo, roomNo } = req.body || {};

//     if (!category || !floorNo || !roomNo) {
//       return res
//         .status(400)
//         .json({ message: "category, floorNo and roomNo are required" });
//     }

//     // avoid duplicate roomNo
//     const existing = await Room.findOne({ roomNo });
//     if (existing) {
//       return res
//         .status(400)
//         .json({ message: "Room with this roomNo already exists" });
//     }

//     const room = new Room({
//       category: String(category).trim(),
//       floorNo: String(floorNo).trim(),
//       roomNo: String(roomNo).trim(),
//       beds: [], // first bed will be added via /:roomNo/bed
//     });

//     await room.save();
//     res.status(201).json(room);
//   } catch (err) {
//     console.error("Error adding room:", err);
//     if (err && err.code === 11000) {
//       return res
//         .status(400)
//         .json({ message: "Room with this roomNo already exists" });
//     }
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// /* ------------------ Add bed to room ------------------ */
// // POST /api/rooms/:roomNo/bed
// // body: { bedNo, bedCategory?, price? }
// router.post("/:roomNo/bed", async (req, res) => {
//   const { roomNo } = req.params;
//   let { bedNo, bedCategory, price } = req.body || {};

//   console.log("🔹 ADD BED request body:", req.body);

//   try {
//     if (!bedNo) {
//       return res.status(400).json({ message: "Missing bedNo" });
//     }

//     const room = await Room.findOne({ roomNo });
//     if (!room) return res.status(404).json({ message: "Room not found" });

//     // duplicate bedNo check (case-insensitive)
//     const exists = room.beds.some(
//       (bed) =>
//         String(bed.bedNo).trim().toLowerCase() ===
//         String(bedNo).trim().toLowerCase()
//     );
//     if (exists) {
//       return res
//         .status(400)
//         .json({ message: "Bed number already exists in this room" });
//     }

//     // normalise values
//     bedNo = String(bedNo).trim();
//     bedCategory = bedCategory ? String(bedCategory).trim() : "";

//     if (price === undefined || price === "") {
//       price = null;
//     } else {
//       price = Number(price);
//       if (Number.isNaN(price)) price = null;
//     }

//     console.log("🔹 Pushing bed:", { bedNo, bedCategory, price });
//     room.beds.push({ bedNo, bedCategory, price });
//     await room.save();

//     res.json({ message: "Bed added successfully", room });
//   } catch (err) {
//     console.error("Error adding bed:", err);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// /* ----------------- Update bed price ------------------ */
// // PUT /api/rooms/:roomNo/bed/:bedNo
// router.put("/:roomNo/bed/:bedNo", async (req, res) => {
//   const { roomNo, bedNo } = req.params;
//   const { price } = req.body || {};

//   try {
//     const room = await Room.findOne({ roomNo });
//     if (!room) return res.status(404).json({ message: "Room not found" });

//     const bed = room.beds.find(
//       (b) =>
//         String(b.bedNo).trim().toLowerCase() ===
//         String(bedNo).trim().toLowerCase()
//     );
//     if (!bed) return res.status(404).json({ message: "Bed not found" });

//     if (price === undefined || price === "") {
//       bed.price = null;
//     } else {
//       const num = Number(price);
//       if (Number.isNaN(num)) {
//         return res.status(400).json({ message: "Invalid price" });
//       }
//       bed.price = num;
//     }

//     await room.save();
//     res.json(bed);
//   } catch (err) {
//     console.error("Error updating bed price:", err);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// /* ------------------ Delete bed from room ------------- */
// // DELETE /api/rooms/:roomNo/bed/:bedNo
// router.delete("/:roomNo/bed/:bedNo", async (req, res) => {
//   const { roomNo, bedNo } = req.params;
//   console.log("🔥 DELETE BED hit:", { roomNo, bedNo });

//   try {
//     const room = await Room.findOne({ roomNo });
//     if (!room) {
//       console.log("  ❌ Room not found");
//       return res.status(404).json({ message: "Room not found" });
//     }

//     const beforeCount = room.beds.length;

//     room.beds = room.beds.filter(
//       (b) =>
//         String(b.bedNo).trim().toLowerCase() !==
//         String(bedNo).trim().toLowerCase()
//     );

//     if (room.beds.length === beforeCount) {
//       console.log("  ❌ Bed not found");
//       return res.status(404).json({ message: "Bed not found" });
//     }

//     await room.save();
//     console.log("  ✅ Bed deleted successfully");
//     return res.json({ message: "Bed deleted successfully", room });
//   } catch (err) {
//     console.error("Error deleting bed:", err);
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

// module.exports = router;







const express = require("express");
const router = express.Router();
const Room = require("../models/Room");

router.get("/", async (req, res) => {
  try {
    const rooms = await Room.find().sort({ floorNo: 1, roomNo: 1 });
    res.json(rooms);
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
});

// ✅ Create room: check duplicate only inside same category
router.post("/", async (req, res) => {
  try {
    const { category, floorNo, roomNo } = req.body || {};
    if (!category || !floorNo || !roomNo) {
      return res.status(400).json({ message: "category, floorNo and roomNo are required" });
    }

    const cat = String(category).trim();
    const flr = String(floorNo).trim();
    const rno = String(roomNo).trim();

    const existing = await Room.findOne({ category: cat, roomNo: rno });
    // If you chose stricter index: use { category: cat, floorNo: flr, roomNo: rno }

    if (existing) {
      return res.status(400).json({ message: "Room already exists in this category" });
    }

    const room = await Room.create({ category: cat, floorNo: flr, roomNo: rno, beds: [] });
    return res.status(201).json(room);
  } catch (err) {
    // duplicate key error for compound index
    if (err?.code === 11000) {
      return res.status(400).json({ message: "Room already exists in this category" });
    }
    return res.status(500).json({ message: "Internal server error" });
  }
});

// ✅ Add bed by roomId
router.post("/:roomId/bed", async (req, res) => {
  const { roomId } = req.params;
  let { bedNo, bedCategory, price } = req.body || {};

  try {
    if (!bedNo) return res.status(400).json({ message: "Missing bedNo" });

    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ message: "Room not found" });

    const exists = room.beds.some(
      (b) => String(b.bedNo).trim().toLowerCase() === String(bedNo).trim().toLowerCase()
    );
    if (exists) return res.status(400).json({ message: "Bed already exists in this room" });

    bedNo = String(bedNo).trim();
    bedCategory = bedCategory ? String(bedCategory).trim() : "";

    if (price === undefined || price === "") price = null;
    else {
      price = Number(price);
      if (Number.isNaN(price)) price = null;
    }

    room.beds.push({ bedNo, bedCategory, price });
    await room.save();

    res.json({ message: "Bed added successfully", room });
  } catch (err) {
    res.status(500).json({ message: "Internal server error" });
  }
});

// ✅ Update bed price by roomId
// router.put("/:roomId/bed/:bedNo", async (req, res) => {
//   const { roomId, bedNo } = req.params;
//   const { price } = req.body || {};

//   try {
//     const room = await Room.findById(roomId);
//     if (!room) return res.status(404).json({ message: "Room not found" });

//     const bed = room.beds.find(
//       (b) => String(b.bedNo).trim().toLowerCase() === String(bedNo).trim().toLowerCase()
//     );
//     if (!bed) return res.status(404).json({ message: "Bed not found" });

//     if (price === undefined || price === "") bed.price = null;
//     else {
//       const num = Number(price);
//       if (Number.isNaN(num)) return res.status(400).json({ message: "Invalid price" });
//       bed.price = num;
//     }

//     await room.save();
//     res.json(bed);
//   } catch (err) {
//     res.status(500).json({ message: "Internal server error" });
//   }
// });

router.put("/:roomId/bed/:bedNo", async (req, res) => {
  const { roomId, bedNo } = req.params;
  const { price, bedCategory } = req.body || {};

  try {
    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ message: "Room not found" });

    const bed = room.beds.find(
      (b) =>
        String(b.bedNo).trim().toLowerCase() ===
        String(bedNo).trim().toLowerCase()
    );
    if (!bed) return res.status(404).json({ message: "Bed not found" });

    // ✅ Update price (allow clearing)
    if (price !== undefined) {
      if (price === "") bed.price = null;
      else {
        const num = Number(price);
        if (Number.isNaN(num))
          return res.status(400).json({ message: "Invalid price" });
        bed.price = num;
      }
    }

    // ✅ Update bedCategory (allow clearing)
    if (bedCategory !== undefined) {
      bed.bedCategory = String(bedCategory).trim(); // "" allowed to clear
    }

    await room.save();
    res.json(bed);
  } catch (err) {
    console.error("Update bed error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});

// ✅ Delete bed by roomId
router.delete("/:roomId/bed/:bedNo", async (req, res) => {
  const { roomId, bedNo } = req.params;

  try {
    const room = await Room.findById(roomId);
    if (!room) return res.status(404).json({ message: "Room not found" });

    const before = room.beds.length;
    room.beds = room.beds.filter(
      (b) => String(b.bedNo).trim().toLowerCase() !== String(bedNo).trim().toLowerCase()
    );

    if (room.beds.length === before) {
      return res.status(404).json({ message: "Bed not found" });
    }

    await room.save();
    return res.json({ message: "Bed deleted successfully", room });
  } catch (err) {
    return res.status(500).json({ message: "Internal server error", error: err.message });
  }
});


// ✅ PUT /api/rooms/:roomId  -> update room category (and optionally floorNo/roomNo later)
router.put("/:roomId", async (req, res) => {
  const { roomId } = req.params;
  const { category } = req.body || {};

  try {
    if (!category || !String(category).trim()) {
      return res.status(400).json({ message: "category is required" });
    }

    const updated = await Room.findByIdAndUpdate(
      roomId,
      { $set: { category: String(category).trim() } },
      { new: true, runValidators: true }
    );

    if (!updated) return res.status(404).json({ message: "Room not found" });

    res.json(updated);
  } catch (err) {
    console.error("Update room category error:", err);
    res.status(500).json({ message: "Internal server error", error: err.message });
  }
});
// PATCH /api/rooms/:roomId/bed/:bedNo  -> update bed price (and/or bedCategory)
router.patch("/:roomId/bed/:bedNo", async (req, res) => {
  try {
    const { roomId, bedNo } = req.params;
    const { price, bedCategory } = req.body;

    if (price !== undefined && (Number(price) < 0 || Number.isNaN(Number(price)))) {
      return res.status(400).json({ message: "Invalid price" });
    }

    const update = {};
    if (price !== undefined) update["beds.$.price"] = Number(price);
    if (bedCategory !== undefined) update["beds.$.bedCategory"] = String(bedCategory);

    if (!Object.keys(update).length) {
      return res.status(400).json({ message: "Nothing to update" });
    }

    const room = await Room.findOneAndUpdate(
      { _id: roomId, "beds.bedNo": String(bedNo) },
      { $set: update },
      { new: true }
    );

    if (!room) {
      return res.status(404).json({ message: "Room/Bed not found" });
    }

    res.json({ message: "Bed updated", room });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: "Server error" });
  }
});

module.exports = router;
