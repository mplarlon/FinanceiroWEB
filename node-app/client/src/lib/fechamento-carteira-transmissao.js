// Notas que ainda podem ser enviadas à SEFAZ: as que não saíram e as que
// voltaram com erro. Autorizada e a que está em envio agora ficam de fora.
export function notasParaRetransmitir(linhas) {
  return (linhas || []).filter((linha) => linha?.status === "pendente" || linha?.status === "erro");
}

export function linhasRevisao(notas) {
  return (notas || []).map((nota) => ({
    idnf: nota.IDNF,
    idempresa: nota.IDEMPRESA,
    nrdoc: String(nota.NRDOC ?? "").trim(),
    cliente: nota.CLIENTE || "",
    total: nota.TOTAL,
    status: "pendente",
    motivo: "",
  }));
}
