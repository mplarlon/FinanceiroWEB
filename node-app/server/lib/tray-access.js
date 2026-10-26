import crypto from "node:crypto";

export function trayPasswordMatches(supplied, expected = process.env.DASHBOARD_TRAY_PASSWORD || "") {
  if (!expected) return false;
  const received = Buffer.from(String(supplied ?? ""), "utf8");
  const configured = Buffer.from(String(expected ?? ""), "utf8");
  return (
    received.length === configured.length &&
    crypto.timingSafeEqual(received, configured)
  );
}
