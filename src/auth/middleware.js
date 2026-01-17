const { isValidSession, hasPasswordSet } = require("./index");

function requireAuth({ sessionStore, config }) {
  return function requireAuthMiddleware(req, res, next) {
    if (!hasPasswordSet(config)) return next();

    const token = req.cookies ? req.cookies.session_token : null;
    if (isValidSession(sessionStore, token, config)) return next();

    return res.status(401).json({ success: false, message: "Unauthorized" });
  };
}

function wsIsAuthorized({ sessionStore, config, req }) {
  if (!hasPasswordSet(config)) return true;

  const cookieHeader = req.headers && req.headers.cookie ? String(req.headers.cookie) : "";
  // Minimal cookie parsing to avoid additional deps.
  const parts = cookieHeader.split(";").map((p) => p.trim());
  const cookie = parts.find((p) => p.startsWith("session_token="));
  const token = cookie ? decodeURIComponent(cookie.split("=").slice(1).join("=")) : null;

  return isValidSession(sessionStore, token, config);
}

module.exports = {
  requireAuth,
  wsIsAuthorized,
};