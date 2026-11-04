// Layout do relatório ppRel de uCadCtaReceberList (Automec):
// agrupado por cliente, situação pelo STATUS e diferença = pago - valor.

export const LEGENDA_CONTAS_RECEBER =
  "AB = ABERTO / QT = QUITADO / DV = DEVOLUÇÃO / CA = CANCELADO / TR = TRANSFERENCIA / AC = ACORDO / DE = DELETADO";

const SITUACAO = { 1: "AB", 2: "QT", 3: "DV", 4: "CA", 5: "TR", 6: "AC", 9: "DE" };

export function situacaoConta(status) {
  return SITUACAO[Number(status)] || "";
}

export function diferencaConta(pago, valor) {
  return Math.round((Number(pago || 0) - Number(valor || 0)) * 100) / 100;
}

export function numeroRelatorio(valor) {
  const n = Number(valor || 0);
  const negativo = n < 0;
  const [inteiro, decimal] = Math.abs(n).toFixed(2).split(".");
  const milhar = inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negativo ? "-" : ""}${milhar},${decimal}`;
}

export function dataRelatorio(valor, anoCompleto = false) {
  if (valor == null || valor === "") return "";
  const texto = valor instanceof Date && !Number.isNaN(valor.getTime())
    ? `${valor.getFullYear()}-${String(valor.getMonth() + 1).padStart(2, "0")}-${String(valor.getDate()).padStart(2, "0")}`
    : String(valor);
  const match = texto.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "";
  const [, ano, mes, dia] = match;
  return anoCompleto ? `${dia}/${mes}/${ano}` : `${dia}/${mes}/${ano.slice(2)}`;
}

export function parcelaRelatorio(valor) {
  if (valor == null || String(valor).trim() === "") return "";
  const n = Number(valor);
  if (!Number.isFinite(n)) return String(valor).trim();
  return String(Math.trunc(n)).padStart(2, "0");
}

export function filtroUtilizado({ idempresa, cliente, dataInicio, dataFim }) {
  const partes = [];
  if (idempresa) partes.push(`Empresa = ${idempresa}`);
  const nome = String(cliente || "").trim();
  if (nome) partes.push(`Cliente = ${nome}`);
  if (dataInicio) partes.push(`Emissão >= ${dataRelatorio(dataInicio, true)}`);
  if (dataFim) partes.push(`Emissão <= ${dataRelatorio(dataFim, true)}`);
  partes.push("Status Aberto");
  return `Filtro Utilizado: ${partes.join("; ")}`;
}

function escapar(valor) {
  return String(valor ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function dataHoraEmissao(quando) {
  const d = quando instanceof Date && !Number.isNaN(quando.getTime()) ? quando : new Date();
  const p = (n) => String(n).padStart(2, "0");
  return {
    data: `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`,
    hora: `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`,
  };
}

function linhasDoCliente(cliente) {
  return (cliente.TITULOS || []).map((titulo, indice) => {
    const valor = Number(titulo.VALOR || 0);
    const pago = Number(titulo.VALOR_PAGO || 0);
    return {
      cliente: indice === 0 ? String(titulo.CLIENTE || cliente.CLIENTE || "").trim() : "",
      nrdoc: String(titulo.NRDOC ?? "").trim(),
      pedido: titulo.NRPEDIDO == null ? "" : String(titulo.NRPEDIDO).trim(),
      parcela: parcelaRelatorio(titulo.PARCELA),
      vencimento: dataRelatorio(titulo.DTVENC, true),
      emissao: dataRelatorio(titulo.DTMOV, true),
      pagto: dataRelatorio(titulo.DTPAGTO, true),
      valor,
      pago,
      situacao: situacaoConta(titulo.STATUS ?? 1),
      diferenca: diferencaConta(pago, valor),
    };
  });
}

function somar(linhas, campo) {
  const centavos = linhas.reduce((total, linha) => total + Math.round(Number(linha[campo] || 0) * 100), 0);
  return centavos / 100;
}

function celula(classe, valor) {
  return `<td class="${classe}">${escapar(valor)}</td>`;
}

function celulaValor(valor, inverso = false) {
  const negativo = Number(valor) < 0;
  const classe = negativo ? (inverso ? "num neg-inv" : "num neg") : "num";
  return celula(classe, numeroRelatorio(valor));
}

function seloSituacao(codigo) {
  const classe = codigo ? `sit sit-${codigo.toLowerCase()}` : "sit";
  return `<td class="centro"><span class="${classe}">${escapar(codigo)}</span></td>`;
}

function grupoCliente(cliente) {
  const linhas = linhasDoCliente(cliente);
  const nome = String(cliente.CLIENTE || linhas.find((linha) => linha.cliente)?.cliente || "").trim();
  const quantidade = `${linhas.length} ${linhas.length === 1 ? "título" : "títulos"}`;
  const corpo = linhas.map((linha) => `<tr>
      ${celula("", linha.nrdoc)}
      ${celula("num", linha.pedido)}
      ${celula("num", linha.parcela)}
      ${celula("centro", linha.vencimento)}
      ${celula("centro", linha.emissao)}
      ${celula("centro", linha.pagto || "—")}
      ${celulaValor(linha.valor)}
      ${celulaValor(linha.pago)}
      ${seloSituacao(linha.situacao)}
      ${celulaValor(linha.diferenca)}
    </tr>`).join("");
  const total = `<tr class="total-cliente">
      <td class="rotulo" colspan="6">Total do Cliente:</td>
      ${celulaValor(somar(linhas, "valor"))}
      ${celulaValor(somar(linhas, "pago"))}
      <td></td>
      ${celulaValor(somar(linhas, "diferenca"))}
    </tr>`;
  return { nome, quantidade, corpo: corpo + total, linhas };
}

function folhaCliente(grupo, cliente, opcoes, emissao) {
  const bloco = grupoCliente(cliente);
  const linhas = bloco.linhas;
  const filtro = filtroUtilizado({
    idempresa: grupo.idempresa,
    cliente: cliente.CDCLIENTE || bloco.nome,
    dataInicio: opcoes.dataInicio,
    dataFim: opcoes.dataFim,
  });
  const chips = filtro.replace(/^Filtro Utilizado:\s*/, "").split("; ").filter(Boolean)
    .map((item) => `<span class="chip">${escapar(item)}</span>`).join("");
  const valor = somar(linhas, "valor");
  const pago = somar(linhas, "pago");
  const diferenca = somar(linhas, "diferenca");
  return `<section class="relatorio">
    <table>
      <colgroup>
        <col style="width:13%"><col style="width:11%"><col style="width:6%">
        <col style="width:10%"><col style="width:10%"><col style="width:10%">
        <col style="width:11%"><col style="width:10%"><col style="width:8%"><col style="width:11%">
      </colgroup>
      <thead>
        <tr><td colspan="10">
          <div class="faixa"></div>
          <div class="cabecalho">
            <div>
              <div class="kicker">Contas a Receber</div>
              <h1 class="empresa">${escapar(grupo.empresa || "Empresa")}</h1>
            </div>
            <div class="quando">
              <div>${escapar(emissao.data)}</div>
              <div>${escapar(emissao.hora)}</div>
              <div class="pagina">Página <span class="numero-pagina"></span></div>
            </div>
          </div>
          <div class="cliente-faixa"><h2>${escapar(bloco.nome)}</h2><span>${bloco.quantidade}</span></div>
          <div class="chips">${chips}</div>
          <div class="resumo">
            <article><small>Títulos</small><strong>${linhas.length}</strong></article>
            <article><small>Valor</small><strong>${escapar(numeroRelatorio(valor))}</strong></article>
            <article><small>Pago</small><strong>${escapar(numeroRelatorio(pago))}</strong></article>
            <article><small>Diferença</small><strong class="${diferenca < 0 ? "neg" : ""}">${escapar(numeroRelatorio(diferenca))}</strong></article>
          </div>
        </td></tr>
        <tr>
          <th>Nr. Fiscal/Dupl</th>
          <th class="num">Pedido</th>
          <th class="num">Parc</th>
          <th class="centro">Vencimento</th>
          <th class="centro">Emissão</th>
          <th class="centro">Pagamento</th>
          <th class="num">Valor</th>
          <th class="num">Pago</th>
          <th class="centro">Situação</th>
          <th class="num">Diferença</th>
        </tr>
      </thead>
      <tbody>
        ${bloco.corpo}
        <tr class="totais">
          <td class="rotulo" colspan="6">Totais:</td>
          ${celulaValor(valor, true)}
          ${celulaValor(pago, true)}
          <td></td>
          ${celulaValor(diferenca, true)}
        </tr>
      </tbody>
      <tfoot>
        <tr><td colspan="10">
          <div class="legenda">
            <span><i class="sit sit-ab">AB</i> Aberto</span>
            <span><i class="sit sit-qt">QT</i> Quitado</span>
            <span><i class="sit sit-dv">DV</i> Devolução</span>
            <span><i class="sit sit-ca">CA</i> Cancelado</span>
            <span><i class="sit sit-tr">TR</i> Transferência</span>
            <span><i class="sit sit-ac">AC</i> Acordo</span>
            <span><i class="sit sit-de">DE</i> Deletado</span>
          </div>
        </td></tr>
      </tfoot>
    </table>
  </section>`;
}

function relatorioEmpresa(grupo, opcoes, emissao) {
  return grupo.clientes.map((cliente) => folhaCliente(grupo, cliente, opcoes, emissao)).join("");
}

function agruparEmpresas(clientes) {
  const grupos = new Map();
  for (const cliente of clientes || []) {
    const idempresa = cliente.IDEMPRESA ?? "";
    if (!grupos.has(idempresa)) {
      grupos.set(idempresa, {
        idempresa,
        empresa: String(cliente.EMPRESA || "").trim(),
        clientes: [],
      });
    }
    grupos.get(idempresa).clientes.push(cliente);
  }
  return [...grupos.values()];
}

export function htmlContasReceber(opcoes = {}) {
  const emissao = dataHoraEmissao(opcoes.emitidoEm);
  const secoes = agruparEmpresas(opcoes.clientes).map((grupo) => relatorioEmpresa(grupo, opcoes, emissao)).join("");
  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Contas a Receber</title>
  <style>
    @page { size: A4 portrait; margin: 10mm 8mm 12mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; color: #29292b; background: #fff; font-family: "Segoe UI", Roboto, sans-serif; font-size: 10px; }
    .acoes { display: flex; justify-content: flex-end; gap: 8px; margin: 0 0 14px; }
    .acoes button { font: inherit; padding: 8px 14px; border-radius: 8px; cursor: pointer; }
    .acoes .ghost { border: 1px solid #d9d3cc; background: #fff; color: #474749; font-weight: 700; }
    .acoes .primary { border: 0; background: #fb590a; color: #fff; font-weight: 800; }
    .relatorio { break-after: page; page-break-after: always; }
    .relatorio + .relatorio { break-before: page; page-break-before: always; }
    .relatorio:last-child { break-after: auto; page-break-after: auto; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    thead { display: table-header-group; }
    tfoot { display: table-footer-group; }
    .faixa { height: 4px; margin: 0 0 12px; border-radius: 4px; background: #fb590a; }
    .cabecalho { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; }
    .kicker { color: #fb590a; font-size: 10px; font-weight: 800; letter-spacing: .14em; text-transform: uppercase; }
    .empresa { margin: 2px 0 0; font-size: 16px; line-height: 1.25; font-weight: 800; }
    .quando { color: #6b6560; text-align: right; line-height: 1.45; }
    .chips { display: flex; flex-wrap: wrap; gap: 6px; margin: 12px 0; }
    .chip { padding: 3px 8px; border: 1px solid #ebe6e1; border-radius: 999px; background: #f7f5f2; color: #474749; }
    .resumo { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 0 0 12px; }
    .cliente-faixa { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: #fff4ec; }
    .cliente-faixa h2 { margin: 0; font-size: 14px; }
    .cliente-faixa span { color: #9a5a32; font-size: 10px; font-weight: 700; white-space: nowrap; }
    .resumo article { padding: 8px 10px; border: 1px solid #efeae4; border-radius: 8px; background: #faf8f6; }
    .resumo small { display: block; color: #8a8178; font-size: 9px; font-weight: 700; letter-spacing: .04em; text-transform: uppercase; }
    .resumo strong { display: block; margin-top: 2px; font-size: 14px; font-variant-numeric: tabular-nums; }
    th, td { padding: 5px 4px; vertical-align: top; }
    th { color: #6b6560; background: #faf8f6; border-bottom: 2px solid #fb590a; font-size: 9px; font-weight: 800; letter-spacing: .03em; text-transform: uppercase; white-space: nowrap; }
    td { border-bottom: 1px solid #f1ece7; font-variant-numeric: tabular-nums; }
    .num { text-align: right; white-space: nowrap; }
    .centro { text-align: center; white-space: nowrap; }
    .rotulo { color: #6b6560; font-weight: 700; text-align: right; }
    .neg { color: #b42318; }
    .grupo td { padding: 0; border-bottom: 0; background: transparent; }
    .grupo-linha { display: flex; justify-content: space-between; align-items: baseline; gap: 12px; margin-top: 10px; padding: 7px 8px; border-radius: 8px; background: #fff4ec; }
    .grupo-linha strong { font-size: 12px; }
    .grupo-linha span { color: #9a5a32; font-size: 10px; font-weight: 700; }
    .sit { display: inline-block; min-width: 22px; padding: 1px 5px; border-radius: 999px; font-style: normal; font-size: 9px; font-weight: 800; letter-spacing: .04em; }
    .sit-ab { background: #fff1e8; color: #c2410c; }
    .sit-qt { background: #e7f6ec; color: #157a3a; }
    .sit-dv, .sit-ca, .sit-de { background: #fdecec; color: #b42318; }
    .sit-tr, .sit-ac { background: #eef2f6; color: #36516e; }
    .total-cliente td { background: #faf8f6; font-weight: 700; }
    .totais td { padding-top: 8px; padding-bottom: 8px; border: 0; background: #29292b; color: #fff; font-weight: 800; }
    .totais .rotulo { color: #fff; }
    .neg-inv { color: #ffc7b3; }
    .legenda { display: flex; flex-wrap: wrap; gap: 8px 14px; padding-top: 12px; color: #6b6560; }
    .legenda span { display: inline-flex; align-items: center; gap: 5px; }
    @media screen {
      body { background: #efece8; padding: 24px; }
      .acoes, .relatorio { max-width: 980px; margin-left: auto; margin-right: auto; }
      .relatorio { margin-bottom: 24px; padding: 18px 18px 12px; border-radius: 14px; background: #fff; box-shadow: 0 12px 32px #29292b14; }
      .numero-pagina::after { content: "01"; }
    }
    @media print {
      .acoes { display: none; }
      .numero-pagina::after { content: counter(page, decimal-leading-zero); }
    }
  </style>
</head>
<body>
  <div class="acoes">
    <button type="button" class="ghost" onclick="window.close()">Fechar</button>
    <button type="button" class="primary" onclick="window.print()">Imprimir</button>
  </div>
  ${secoes}
  <script>window.addEventListener("load", () => setTimeout(() => window.print(), 200));</script>
</body>
</html>`;
}
