import { query, withReadOnlyDatabase } from "./db.js";
import { acquireAutomationLock, releaseAutomationLock } from "./lib/charlie-automation-store.js";
import { runDueAutomations } from "./lib/charlie-automation-engine.js";

let running = false;

export async function tickCharlieAutomations(overrides = {}) {
  if (running) return [];
  const lock = acquireAutomationLock();
  if (!lock) return [];
  running = true;
  try {
    return await withReadOnlyDatabase((db) => runDueAutomations({
      query: (sql, params) => query(db, sql, params, { timeoutMs: 30000 }),
      resolveUser: overrides.resolveUser || (async (userId) => {
        const users = await query(db, "SELECT FIRST 1 IDUSUARIO, INATIVO FROM USUARIOS WHERE IDUSUARIO=?", [Number(userId)], { timeoutMs: 10000 });
        if (!users.length || Number(users[0].INATIVO || 0) === 1) return { id: Number(userId), ativo: false, gerencial: false };
        const permissions = await query(db, "SELECT FIRST 1 1 AS OK FROM SIS_OPERACAOUSUARIO WHERE IDUSUARIO=? AND IDOPERACAO=900 AND APPID=1", [Number(userId)], { timeoutMs: 10000 });
        return { id: Number(userId), ativo: true, gerencial: Boolean(permissions.length) };
      }),
    }, { concurrency: Number(process.env.CHARLIE_AUTOMATION_CONCURRENCY || 2) }));
  } catch (error) {
    console.error(`[charlie-automations] ${error.message}`);
    return [];
  } finally {
    running = false;
    releaseAutomationLock(lock);
  }
}

export function startCharlieAutomations() {
  const timer = setInterval(() => tickCharlieAutomations(), 60_000);
  timer.unref();
  tickCharlieAutomations();
  return timer;
}
