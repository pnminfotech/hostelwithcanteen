const jwt = require("jsonwebtoken");

const FALLBACK_SECRETS = ["your-secret-key", "dev_secret"];

module.exports = function verifyUserToken(token) {
  const secrets = [
    process.env.AUTH_JWT_SECRET,
    process.env.JWT_SECRET,
    ...FALLBACK_SECRETS,
  ].filter(Boolean);

  let lastError = null;

  for (const secret of [...new Set(secrets)]) {
    try {
      return jwt.verify(token, secret);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError || new Error("Invalid/expired token");
};
