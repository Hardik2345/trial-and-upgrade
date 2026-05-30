const jwt = require("jsonwebtoken");
const env = require("../config/env");
const AdminUser = require("../models/AdminUser");

async function requireAuth(req, res, next) {
  try {
    const header = req.get("authorization") || "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    if (!token) return res.status(401).json({ error: "Missing access token" });
    const payload = jwt.verify(token, env.accessSecret);
    const user = await AdminUser.findById(payload.sub).select("-passwordHash");
    if (!user || !user.active) return res.status(401).json({ error: "User is disabled" });
    req.auth = {
      user,
      role: payload.role,
      tenantStoreIds: payload.tenantStoreIds || [],
      jti: payload.jti
    };
    return next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid access token" });
  }
}

function requireSuperAdmin(req, res, next) {
  if (req.auth?.role !== "super_admin") return res.status(403).json({ error: "Super admin access required" });
  return next();
}

function canAccessStore(req, storeId) {
  if (req.auth?.role === "super_admin") return true;
  return (req.auth?.tenantStoreIds || []).includes(String(storeId));
}

function requireStoreAccess(req, res, next) {
  const storeId = req.query.storeId || req.body.tenantStoreId || req.params.storeId;
  if (!storeId) return res.status(400).json({ error: "storeId is required" });
  if (!canAccessStore(req, storeId)) return res.status(403).json({ error: "Store access denied" });
  return next();
}

module.exports = { requireAuth, requireSuperAdmin, canAccessStore, requireStoreAccess };
