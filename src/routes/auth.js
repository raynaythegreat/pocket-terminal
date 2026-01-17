const express = require("express");
const { verifyPassword, buildPasswordConfig, hasPasswordSet } = require("../auth");

function createAuthRouter({ sessionStore, config }) {
  const router = express.Router();

  router.get("/auth/config", (req, res) => {
    res.json(buildPasswordConfig(config));
  });

  router.post("/auth", (req, res) => {
    const { password } = req.body || {};
    if (verifyPassword(password, config)) {
      const token = sessionStore.createToken();

      // If password isn't set, this endpoint is effectively a no-op but still returns success
      // for clients that always call it.
      const cookieOpts = {
        httpOnly: true,
        secure: !!(config.cookies && config.cookies.secure),
        sameSite: "lax",
        path: "/",
      };

      res.cookie("session_token", token, cookieOpts);
      return res.json({ success: true, authEnabled: hasPasswordSet(config) });
    }

    return res.status(401).json({ success: false, message: "Invalid password" });
  });

  router.post("/logout", (req, res) => {
    const token = req.cookies ? req.cookies.session_token : null;
    if (token) sessionStore.delete(token);
    res.clearCookie("session_token", { path: "/" });
    res.json({ success: true });
  });

  return router;
}

module.exports = { createAuthRouter };