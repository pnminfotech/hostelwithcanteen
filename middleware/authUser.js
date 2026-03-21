const User = require("../models/userModel");
const verifyUserToken = require("../utils/verifyUserToken");

module.exports = async function authUser(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ message: "No token provided" });
    }

    const payload = verifyUserToken(token);
    const userId = payload.userId || payload.id || payload._id || payload.sub;

    if (!userId) {
      return res.status(401).json({ message: "Invalid token payload" });
    }

    const user = await User.findById(userId).select("-password");
    if (!user) {
      return res.status(401).json({ message: "User not found" });
    }

    req.user = user;
    req.auth = payload;
    next();
  } catch (error) {
    return res.status(401).json({ message: "Invalid/expired token" });
  }
};
