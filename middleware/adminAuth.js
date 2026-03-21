// payment-Backend/middleware/adminAuth.js
const jwt = require('jsonwebtoken');
const User = require('../models/userModel'); // you already have this model
const verifyUserToken = require("../utils/verifyUserToken");

module.exports = async function adminAuth(req, res, next) {
  try {
    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : null;
    if (!token) {
      return res.status(401).json({ message: 'No token provided' });
    }

    const payload = verifyUserToken(token);

    // Adjust this if your token stores a different key
    const userId = payload.userId || payload.id || payload._id || payload.sub;
    const user = await User.findById(userId);
    if (!user) return res.status(401).json({ message: 'User not found' });

    // Accept either a boolean flag or a role field
    const isAdmin = user.isAdmin === true || user.role === 'admin';
    if (!isAdmin) return res.status(403).json({ message: 'Admin access required' });

    req.admin = user; // attach for downstream handlers
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid/expired token' });
  }
};
