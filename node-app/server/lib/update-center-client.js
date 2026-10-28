function config(environment = process.env) {
  const url = String(environment.UPDATE_CENTER_URL || "").trim();
  const token = String(environment.UPDATE_CENTER_READ_TOKEN || "").trim();
  if (!url || !token) throw Object.assign(new Error("Consulta à Central de Atualizações não configurada neste ERP."), { status: 503 });
  if (new URL(url).protocol !== "https:" && !/localhost|127\.0\.0\.1/.test(new URL(url).hostname)) throw Object.assign(new Error("A Central de Atualizações deve usar HTTPS."), { status: 503 });
  return { url, token };
}

async function read(pathname, query = {}) {
  const { url, token } = config();
  const target = new URL(pathname, url);
  for (const [key, value] of Object.entries(query)) if (value) target.searchParams.set(key, value);
  const response = await fetch(target, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(data.error || `Central respondeu HTTP ${response.status}.`), { status: response.status });
  return data;
}

export async function updateFleetSnapshot(filters = {}) {
  const [summary, installations, releases, events] = await Promise.all([
    read("/api/admin/summary"), read("/api/admin/installations"), read("/api/admin/releases"), read("/api/admin/events", filters),
  ]);
  return { summary, installations: installations.installations, releases: releases.releases, events: events.events };
}

export async function answerUpdateQuestion(question) {
  const normalized = String(question || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  if (!/(atualiz|versao|instalac).*(cliente|empresa|falha|desatualiz)|clientes?.*(desatualiz|versao)|indice.*falha/.test(normalized)) return null;
  const fleet = await updateFleetSnapshot();
  const latest = fleet.summary.latestVersion;
  let rows = fleet.installations;
  let response;
  if (/falha|problema|rollback/.test(normalized)) {
    const failures = fleet.events.filter((item) => ["failed", "rollback"].includes(item.type));
    rows = failures;
    response = `Encontrei ${failures.length} ocorrência(s) recente(s) de falha ou rollback. Esta consulta é somente leitura.`;
  } else if (/versao\s+\d+\.\d+\.\d+/.test(normalized)) {
    const version = normalized.match(/\d+\.\d+\.\d+/)[0]; rows = fleet.installations.filter((item) => item.version === version);
    response = `${rows.length} instalação(ões) estão na versão ${version}.`;
  } else {
    rows = fleet.installations.filter((item) => item.outdated || (latest && item.version !== latest && !item.revokedAt));
    const nomes = rows.slice(0, 12).map((item) => `${item.companyName || "Sem empresa"} — ${item.hostname || "máquina sem nome"} (${(item.addresses || []).join(", ") || "IP ainda não informado"}) na ${item.version || "versão desconhecida"}`);
    response = latest ? `${rows.length} instalação(ões) estão abaixo da versão publicada mais recente (${latest}).${nomes.length ? ` ${nomes.join("; ")}.` : ""}` : "Ainda não existe uma versão publicada na central.";
  }
  return { resposta: response, intencao: { type: "atualizacoes_consulta", interpretador: "central_atualizacoes" }, dados: rows.slice(0, 200), origem: "central_atualizacoes", sugestoes: ["Quais clientes tiveram falha ou rollback?", "Quantas instalações usam a versão atual?"] };
}
