import crypto from "node:crypto";
import { readJsonConfig, writeJsonConfig } from "./lib/json-config.js";

const sessionFile = "sessions.json";
// O navegador limita a vida do cookie. Cada requisição renova esse prazo.
// O servidor não encerra a sessão por tempo.
const cookieMaxAge = 365 * 24 * 60 * 60 * 1000;
const stored = readJsonConfig(sessionFile, { sessions: {} });
const sessions = new Map(
  Object.entries(stored.sessions || {}).filter(([, entry]) => entry?.user)
);

function persistSessions() {
  writeJsonConfig(sessionFile, { sessions: Object.fromEntries(sessions) });
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.DASHBOARD_COOKIE_SECURE === "true",
    maxAge: cookieMaxAge,
  };
}

export function sessionMiddleware(req, res, next) {
  let id = req.cookies.dashboard_session;
  const entry = id && sessions.get(id);
  req.dashboardSession = entry;
  if (entry) {
    entry.lastActionAt = Date.now();
    res.cookie("dashboard_session", id, cookieOptions());
  }
  req.createDashboardSession = user => {
    id = crypto.randomBytes(32).toString("hex");
    sessions.set(id, { user, loginAt: Date.now(), lastActionAt: Date.now() });
    persistSessions();
    res.cookie("dashboard_session", id, cookieOptions());
  };
  req.clearDashboardSession = () => {
    if (id) sessions.delete(id);
    persistSessions();
    res.clearCookie("dashboard_session");
  };
  next();
}
