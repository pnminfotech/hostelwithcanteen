function normalizeRole(role) {
  if (role === "canteen_admin") return "canteen_admin";
  return "super_admin";
}

module.exports = function getEffectiveUserRole(user = {}, payload = {}) {
  if (typeof user === "string") {
    return normalizeRole(user);
  }

  if (user?.role) {
    return normalizeRole(user.role);
  }

  if (payload?.role) {
    return normalizeRole(payload.role);
  }

  if (user?.isAdmin === true) {
    return "super_admin";
  }

  return "super_admin";
};
