const express = require("express");
const authService = require("../services/authService");
const { requireAuth } = require("../middleware/auth");

const router = express.Router();

function userPayload(user) {
  return {
    id: String(user._id),
    email: user.email,
    name: user.name,
    role: user.role,
    tenantStoreIds: (user.tenantStoreIds || []).map(String)
  };
}

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const result = await authService.login(email, password, req);
    res.cookie("refreshToken", result.refreshToken, authService.refreshCookieOptions());
    res.json({ accessToken: result.accessToken, user: userPayload(result.user) });
  } catch (err) {
    next(err);
  }
});

router.post("/refresh", async (req, res, next) => {
  try {
    const rawToken = req.cookies.refreshToken || req.body.refreshToken;
    if (!rawToken) return res.status(401).json({ error: "Missing refresh token" });
    const result = await authService.rotateRefreshToken(rawToken, req);
    res.cookie("refreshToken", result.refreshToken, authService.refreshCookieOptions());
    res.json({ accessToken: result.accessToken, user: userPayload(result.user) });
  } catch (err) {
    next(err);
  }
});

router.post("/logout", async (req, res, next) => {
  try {
    await authService.revokeRefreshToken(req.cookies.refreshToken || req.body.refreshToken);
    res.clearCookie("refreshToken", authService.refreshCookieOptions());
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.post("/logout-all", requireAuth, async (req, res, next) => {
  try {
    await authService.revokeAllForUser(req.auth.user._id);
    res.clearCookie("refreshToken", authService.refreshCookieOptions());
    res.json({ success: true });
  } catch (err) {
    next(err);
  }
});

router.get("/me", requireAuth, (req, res) => {
  res.json({ user: userPayload(req.auth.user) });
});

module.exports = router;
