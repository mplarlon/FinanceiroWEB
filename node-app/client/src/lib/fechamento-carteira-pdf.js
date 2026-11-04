function escapar(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function urlPdfNota(linha) {
  const idnf = encodeURIComponent(linha?.idnf ?? "");
  const idempresa = encodeURIComponent(linha?.idempresa ?? "");
  const nrdoc = encodeURIComponent(linha?.nrdoc || "");
  return `/api/fiscal/nfe/${idnf}/pdf?idempresa=${idempresa}&nrdoc=${nrdoc}`;
}

export function htmlStatusPdf(titulo, mensagem, erro = false) {
  const cor = erro ? "#b42318" : "#29292b";
  return `<!DOCTYPE html><html lang="pt-BR"><head><meta charset="utf-8"><title>${escapar(titulo)}</title></head><body style="margin:0;font-family:Segoe UI,sans-serif"><p style="padding:24px;color:${cor}">${escapar(mensagem)}</p></body></html>`;
}

function tituloNota(linha) {
  return `NF ${linha.nrdoc || linha.idnf}`;
}

function escrever(janela, html) {
  janela.document.open();
  janela.document.write(html);
  janela.document.close();
}

// A janela abre no clique, antes de esperar o DANFE.
// Se a busca vier primeiro, o navegador bloqueia o pop-up e o clique parece vazio.
export async function abrirPdfsAutorizados(linhas, deps) {
  const notas = (linhas || []).filter(linha => linha.status === "autorizada");
  if (!notas.length) return { abertas: 0, bloqueado: false, erros: [] };

  const janelas = notas.map(linha => {
    const janela = deps.abrir();
    if (!janela || janela.closed) return null;
    escrever(janela, htmlStatusPdf(tituloNota(linha), `Gerando o PDF da ${tituloNota(linha)}...`));
    return janela;
  });
  if (janelas.some(janela => !janela)) {
    janelas.forEach(janela => janela?.close?.());
    return { abertas: 0, bloqueado: true, erros: [] };
  }

  const erros = [];
  await Promise.all(notas.map(async (linha, indice) => {
    const janela = janelas[indice];
    try {
      const response = await deps.buscar(urlPdfNota(linha));
      const type = response.headers.get("content-type") || "";
      if (!response.ok || type.includes("application/json")) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.erro || "Não foi possível abrir o PDF.");
      }
      janela.location.replace(deps.criarUrl(await response.blob()));
    } catch (error) {
      const mensagem = error?.message || "Não foi possível abrir o PDF.";
      try {
        escrever(janela, htmlStatusPdf(tituloNota(linha), mensagem, true));
      } catch { /* a janela pode ter sido fechada */ }
      erros.push({ idnf: linha.idnf, mensagem });
    }
  }));
  return { abertas: notas.length, bloqueado: false, erros };
}
