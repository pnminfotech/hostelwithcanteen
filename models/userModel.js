const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
  },

  role: {
    type: String,
    enum: ["super_admin", "canteen_admin"],
    default: "super_admin",
  },

  email: {
    type: String,
    unique: true,
    required: true,
  },

  password: {
    type: String,
    required: true,
  },

  // ✅ New fields for Hostel Management

  // Self Aadhar number
  selfAadhar: {
    type: String,
  },

  // Parent / Guardian Aadhar number
  parentAadhar: {
    type: String,
  },

  // Self photograph (store image URL or file path)
  selfPhoto: {
    type: String,
  },

  // Parent / Guardian photograph (URL or file path)
  parentPhoto: {
    type: String,
  },
});

userSchema.pre("save", async function (next) {
  if (this.isModified("password")) {
    this.password = await bcrypt.hash(this.password, 10);
  }
  next();
});

const User = mongoose.model("User", userSchema);
module.exports = User;
