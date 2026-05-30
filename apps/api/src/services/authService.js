const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const { randomUUID } = require("crypto");
const env = require("../config/env");
const AdminUser = require("../models/AdminUser");
const RefreshToken = require("../models/RefreshToken");
const { hashRefreshToken } = require("../utils/crypto");

function refreshCookieOptions() {
  return {
    httpOnly: true,
    secure: env.isProduction,
    sameSite: env.isProduction ? "none" : "lax",
    domain: env.cookieDomain,
    path: "/api/auth",
    maxAge: env.refreshTokenDays * 24 * 60 * 60 * 1000
  };
}

function signAccessToken(user) {
  const jti = randomUUID();
  const payload = {
    sub: String(user._id),
    role: user.role,
    tenantStoreIds: (user.tenantStoreIds || []).map(String),
    jti
  };
  return jwt.sign(payload, env.accessSecret, { expiresIn: env.accessTokenTtl });
}

async function createRefreshToken(user, req, familyId = randomUUID()) {
  const jti = randomUUID();
  const token = jwt.sign({ sub: String(user._id), jti, familyId }, env.refreshSecret, {
    expiresIn: `${env.refreshTokenDays}d`
  });
  const expiresAt = new Date(Date.now() + env.refreshTokenDays * 24 * 60 * 60 * 1000);
  const record = await RefreshToken.create({
    userId: user._id,
    tokenHash: hashRefreshToken(token),
    familyId,
    jti,
    expiresAt,
    ip: req.ip,
    userAgent: req.get("user-agent") || ""
  });
  return { token, record };
}

async function login(email, password, req) {
  const user = await AdminUser.findOne({ email: String(email || "").toLowerCase() });
  if (!user || !user.active) {
    const error = new Error("Invalid credentials");
    error.status = 401;
    throw error;
  }
  const valid = await bcrypt.compare(password || "", user.passwordHash);
  if (!valid) {
    const error = new Error("Invalid credentials");
    error.status = 401;
    throw error;
  }

  user.lastLoginAt = new Date();
  await user.save();
  const accessToken = signAccessToken(user);
  const refresh = await createRefreshToken(user, req);
  return { user, accessToken, refreshToken: refresh.token };
}

async function rotateRefreshToken(rawToken, req) {
  let decoded;
  try {
    decoded = jwt.verify(rawToken, env.refreshSecret);
  } catch (err) {
    const error = new Error("Invalid refresh token");
    error.status = 401;
    throw error;
  }

  const tokenHash = hashRefreshToken(rawToken);
  const record = await RefreshToken.findOne({ tokenHash });
  if (!record) {
    const error = new Error("Invalid refresh token");
    error.status = 401;
    throw error;
  }

  if (record.revokedAt) {
    await RefreshToken.updateMany({ familyId: record.familyId }, { $set: { revokedAt: new Date() } });
    const error = new Error("Refresh token reuse detected");
    error.status = 401;
    throw error;
  }

  if (record.expiresAt <= new Date()) {
    record.revokedAt = new Date();
    await record.save();
    const error = new Error("Refresh token expired");
    error.status = 401;
    throw error;
  }

  const user = await AdminUser.findById(decoded.sub);
  if (!user || !user.active) {
    await RefreshToken.updateMany({ userId: decoded.sub }, { $set: { revokedAt: new Date() } });
    const error = new Error("User is disabled");
    error.status = 401;
    throw error;
  }

  const next = await createRefreshToken(user, req, record.familyId);
  record.revokedAt = new Date();
  record.replacedByTokenId = next.record._id;
  await record.save();

  return {
    user,
    accessToken: signAccessToken(user),
    refreshToken: next.token
  };
}

async function revokeRefreshToken(rawToken) {
  if (!rawToken) return;
  const tokenHash = hashRefreshToken(rawToken);
  await RefreshToken.updateOne({ tokenHash, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

async function revokeAllForUser(userId) {
  await RefreshToken.updateMany({ userId, revokedAt: null }, { $set: { revokedAt: new Date() } });
}

module.exports = {
  login,
  rotateRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
  signAccessToken,
  refreshCookieOptions
};
