import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./lib/json-config.js";

const ttl = 60 * 60 * 1000;
const sessionFile = "sessions.json";
const stored = readJsonConfig(sessionFile, { sessions: {} });
const sessions = new Map(
  Object.entries(stored.sessions || {}).filter(([, entry]) =>
    entry?.user && Number(entry.loginAt) && Date.now() - Number(entry.loginAt) <= ttl
  )
);
function persistSessions() {
  writeJsonConfig(sessionFile, { sessions: Object.fromEntries(sessions) });
}
if (Object.keys(stored.sessions || {}).length !== sessions.size) persistSessions();

export function sessionMiddleware(req, res, next) {
  let id = req.cookies.dashboard_session;
  let entry = id && sessions.get(id);
  if (entry && Date.now() - entry.loginAt > ttl) {
    sessions.delete(id);
    persistSessions();
    entry = undefined;
  }
  req.dashboardSession = entry;
  req.createDashboardSession = user => {
    id = crypto.randomBytes(32).toString("hex");
    sessions.set(id, { user, loginAt: Date.now(), lastActionAt: Date.now() });
    persistSessions();
    res.cookie("dashboard_session", id, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.DASHBOARD_COOKIE_SECURE === "true",
      maxAge: ttl
    });
  };
  req.clearDashboardSession = () => {
    if (id) sessions.delete(id);
    persistSessions();
    res.clearCookie("dashboard_session");
  };
  next();
}
