import { withReadOnlyDatabase } from "./db.js";
import { readMonitorSettings, acquireMonitorLock, releaseMonitorLock } from "./lib/charlie-monitor-store.js";
import { runCharlieMonitor } from "./lib/charlie-monitor.js";
import { readJsonConfig, writeJsonConfig } from "./lib/json-config.js";
import { auditEngineStatus, runAuditCycle } from "./lib/charlie-audit-service.js";
import { readAuditSettings } from "./lib/charlie-audit-store.js";
import { runBehavioralRiskAnalysis } from "./lib/charlie-behavioral-risk-service.js";

const STATE_FILE = "charlie-monitor-state.json";

function due(settings) {
  const state = readJsonConfig(STATE_FILE, {});
  const last = Date.parse(state.ultimaExecucao || 0);
  return !Number.isFinite(last) || Date.now() - last >= settings.intervaloMinutos * 60 * 1000;
}

export async function tickCharlieMonitor() {
  const settings = readMonitorSettings();
  const auditSettings = readAuditSettings();
  const auditStatus = auditEngineStatus();
  const auditLast = Date.parse(auditStatus.lastCheckedAt || 0);
  const auditDue = auditSettings.enabled && (!Number.isFinite(auditLast) || Date.now() - auditLast >= auditSettings.intervalMinutes * 60000);
  const monitorDue = settings.ativo && due(settings);
  if (!monitorDue && !auditDue) return null;
  const lock = acquireMonitorLock();
  if (!lock) return null;
  try {
    const result = await withReadOnlyDatabase(async (db) => ({
      monitor: monitorDue ? await runCharlieMonitor(db) : null,
      auditoria: auditDue ? await runAuditCycle(db) : null,
      riscos: auditDue ? runBehavioralRiskAnalysis() : null,
    }));
    if (result.monitor) writeJsonConfig(STATE_FILE, { ultimaExecucao: new Date().toISOString(), ultimoResultado: result.monitor });
    console.log(`[charlie-monitor] monitor=${result.monitor?.achados ?? "adiado"}; auditoria=${result.auditoria?.evaluatedEvents ?? "adiada"}`);
    return result;
  } catch (error) {
    writeJsonConfig(STATE_FILE, {
      ultimaExecucao: new Date().toISOString(),
      ultimoErro: String(error.message || error).slice(0, 300),
    });
    console.error(`[charlie-monitor] falha: ${error.message}`);
    return null;
  } finally {
    releaseMonitorLock(undefined, lock.owner);
  }
}

export function startCharlieMonitor() {
  const timer = setInterval(() => {
    tickCharlieMonitor().catch((error) => console.error(`[charlie-monitor] ${error.message}`));
  }, 60_000);
  timer.unref();
  tickCharlieMonitor().catch((error) => console.error(`[charlie-monitor] ${error.message}`));
  return timer;
}
