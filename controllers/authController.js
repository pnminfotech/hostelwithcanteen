const User = require('../models/userModel');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');

const SECRET_KEY = 'your-secret-key'; // Use a secure key

const isDbConnected = () => mongoose.connection.readyState === 1;

// Register user
const registerUser = async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({ message: "Database unavailable. Please check MongoDB connection." });
    }

    const username = String(req.body?.username || req.body?.name || "").trim();
    const email = String(req.body?.email || "").trim().toLowerCase();
    const password = String(req.body?.password || "");

    if (!username || !email || !password) {
      return res.status(400).json({ message: "username, email and password are required" });
    }

    // Check if user exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(409).json({ message: "User already exists" });
    }

    // Create new user
    const newUser = new User({ username, email, password });
    await newUser.save();

    return res.status(201).json({ success: true });
  } catch (error) {
    console.error("registerUser error:", error);

    if (error?.code === 11000) {
      return res.status(409).json({ message: "User already exists" });
    }

    if (error?.name === "ValidationError") {
      return res.status(400).json({ message: error.message });
    }

    return res.status(500).json({ message: "Server error" });
  }
};
  
  
  const getUserNAme = async (req, res)=>{
    try  {
      const token = req.headers.authorization?.split(" ")[1];
      if (!token) return res.status(401).json({ message: "Unauthorized" });

      const decoded = jwt.verify(token, SECRET_KEY);
      const user = await User.findById(decoded.userId);
      if (!user) return res.status(404).json({ message: "User not found" });

      res.json({ username: user.username });
  } catch (error) {
      res.status(500).json({ message: "Server error" });
  }
  }

// Login user
const loginUser = async (req, res) => {
  try {
    if (!isDbConnected()) {
      return res.status(503).json({ message: "Database unavailable. Please check MongoDB connection." });
    }

    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(400).json({ message: 'Invalid credentials' }); // Send JSON response
    }

    const isPasswordValid = await bcrypt.compare(password, user.password);
    if (!isPasswordValid) {
      return res.status(400).json({ message: 'Invalid credentials' }); // Send JSON response
    }

    const token = jwt.sign({ userId: user._id, username: user.username }, SECRET_KEY, { expiresIn: '1h' });
    res.json({ token }); // Send the token as JSON
  } catch (error) {
    console.error("loginUser error:", error);
    return res.status(500).json({ message: "Server error" });
  }
};
  

// Protected route to get user profile
const getUserProfile = async (req, res) => {
  try {
    const user = await User.findById(req.user.userId).select('-password');
    res.json(user);
  } catch (err) {
    res.status(400).json({ message: 'Invalid token' });
  }
};

module.exports = { getUserNAme , registerUser, loginUser, getUserProfile };
