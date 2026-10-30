import express from "express";
import ExcelJS from "exceljs";
import { query, withDatabase } from "../db.js";

const router = express.Router();
const dbDate = (value) => new Date(`${value}T12:00:00`);
async function columns(db, table) {
  return new Set(
    (
      await query(
        db,
        "SELECT TRIM(RDB$FIELD_NAME) AS NAME FROM RDB$RELATION_FIELDS WHERE TRIM(RDB$RELATION_NAME)=?",
        [table],
      )
    ).map((r) => r.NAME),
  );
}
const first = (set, ...names) => names.find((name) => set.has(name));

router.get("/dre-vs-conciliacao", async (req, res) => {
  try {
    const now = new Date(),
      fallbackStart = new Date(now.getFullYear(), now.getMonth(), 1),
      parse = (value, fallback) => {
        const parsed = value
          ? new Date(`${String(value).slice(0, 10)}T12:00:00`)
          : fallback;
        return Number.isNaN(parsed.getTime()) ? fallback : parsed;
      };
    let start = parse(req.query.data_ini, fallbackStart),
      end = parse(req.query.data_fim, now);
    if (end < start) [start, end] = [end, start];
    const result = await withDatabase(async (db) => {
      const recCols = await columns(db, "CTARECEBER"),
        payCols = await columns(db, "CTAPAGAR"),
        movCols = await columns(db, "MOV_BANCARIO"),
        recDate = first(recCols, "COMPETENCIA", "DTVENC", "DTMOV"),
        payDate = first(
          payCols,
          "COMPETENCIA",
          "DTVENC",
          "DTPAGTO",
          "DTINCLUSAO",
        ),
        movDate = first(movCols, "DTLANCAMENTO");
      if (!recDate || !payDate || !movDate)
        throw new Error("Coluna de data obrigatoria nao encontrada.");
      const valueExpr = (set, alias, names) => {
          const expressions = names
            .filter((name) => set.has(name))
            .map((name) =>
              ["VLPGLIQ", "TOTALPG", "VLPAGTO", "TOTAL"].includes(name)
                ? `NULLIF(${alias}.${name},0)`
                : `${alias}.${name}`,
            );
          return `COALESCE(${expressions.length ? expressions.join(",") : "0"})`;
        },
        form = (set, alias) =>
          set.has("CODPAGTO") && set.has("TPPAGTO")
            ? `COALESCE(${alias}.CODPAGTO,${alias}.TPPAGTO)`
            : set.has("CODPAGTO")
              ? `${alias}.CODPAGTO`
              : set.has("TPPAGTO")
                ? `${alias}.TPPAGTO`
                : "NULL",
        recValue = valueExpr(recCols, "cr", [
          "VLPGLIQ",
          "TOTALPG",
          "DIVIDA",
          "VALOR",
        ]),
        payValue = valueExpr(payCols, "cp", ["VLPAGTO", "TOTAL", "VALOR"]),
        period = (alias, field) =>
          `${alias}.${field}>=? AND ${alias}.${field}<DATEADD(1 DAY TO ?)`,
        params = [start, end];
      async function summary(table, alias, dateField, value, set) {
        const payment = form(set, alias),
          movement = first(set, "MOV_BANCARIA", "MOV_BANCARIO"),
          reconciled = movement
            ? `CASE WHEN COALESCE(${alias}.${movement},0)<>0 THEN ${value} ELSE 0 END`
            : "0",
          row =
            (
              await query(
                db,
                `SELECT COUNT(*) AS QTD,SUM(${value}) AS TOTAL,SUM(${reconciled}) AS CONCILIADO,SUM(CASE WHEN UPPER(COALESCE(r.RECEBTO,p.PAGTO,'')) CONTAINING 'DINHEIRO' OR ${payment}=1 THEN ${value} ELSE 0 END) AS DINHEIRO FROM ${table} ${alias} LEFT JOIN RECEBTO r ON r.CDRECEBTO=${payment} LEFT JOIN PAGTO p ON p.CDPAGTO=${payment} WHERE ${period(alias, dateField)}`,
                params,
              )
            )[0] || {},
          forms = await query(
            db,
            `SELECT FIRST 12 COALESCE(r.RECEBTO,p.PAGTO,'Sem forma') AS FORMA,COUNT(*) AS QTD,SUM(${value}) AS TOTAL FROM ${table} ${alias} LEFT JOIN RECEBTO r ON r.CDRECEBTO=${payment} LEFT JOIN PAGTO p ON p.CDPAGTO=${payment} WHERE ${period(alias, dateField)} GROUP BY COALESCE(r.RECEBTO,p.PAGTO,'Sem forma') ORDER BY TOTAL DESC`,
            params,
          ),
          total = Number(row.TOTAL || 0),
          conciliado = Number(row.CONCILIADO || 0),
          dinheiro = Number(row.DINHEIRO || 0);
        return {
          qtd: Number(row.QTD || 0),
          total,
          conciliado,
          nao_conciliado: Math.max(total - conciliado, 0),
          dinheiro,
          outros: Math.max(total - dinheiro, 0),
          formas: forms.map((item) => ({
            forma: item.FORMA || "Sem forma",
            qtd: Number(item.QTD || 0),
            total: Number(item.TOTAL || 0),
          })),
        };
      }
      const receitas = await summary(
          "CTARECEBER",
          "cr",
          recDate,
          recValue,
          recCols,
        ),
        despesas = await summary("CTAPAGAR", "cp", payDate, payValue, payCols),
        bank =
          (
            await query(
              db,
              `SELECT SUM(CASE WHEN mb.VALOR>0 THEN mb.VALOR ELSE 0 END) AS ENTRADAS,SUM(CASE WHEN mb.VALOR<0 THEN ABS(mb.VALOR) ELSE 0 END) AS SAIDAS,COUNT(*) AS QTD FROM MOV_BANCARIO mb WHERE ${period("mb", movDate)}`,
              params,
            )
          )[0] || {},
        evolution = new Map(),
        add = (rows, key) => {
          for (const row of rows) {
            const year = Number(row.ANO),
              month = Number(row.MES),
              id = `${year}-${String(month).padStart(2, "0")}`,
              item = evolution.get(id) || {
                label: `${String(month).padStart(2, "0")}/${year}`,
                dre_receita: 0,
                banco_entrada: 0,
                dre_despesa: 0,
                banco_saida: 0,
              };
            item[key] = Number(row.TOTAL || 0);
            evolution.set(id, item);
          }
        };
      const monthly = async (table, alias, date, value) =>
        query(
          db,
          `SELECT EXTRACT(YEAR FROM CAST(${alias}.${date} AS DATE)) AS ANO,EXTRACT(MONTH FROM CAST(${alias}.${date} AS DATE)) AS MES,SUM(${value}) AS TOTAL FROM ${table} ${alias} WHERE ${period(alias, date)} GROUP BY 1,2 ORDER BY 1,2`,
          params,
        );
      add(await monthly("CTARECEBER", "cr", recDate, recValue), "dre_receita");
      add(await monthly("CTAPAGAR", "cp", payDate, payValue), "dre_despesa");
      const movements = await query(
        db,
        `SELECT EXTRACT(YEAR FROM CAST(mb.${movDate} AS DATE)) AS ANO,EXTRACT(MONTH FROM CAST(mb.${movDate} AS DATE)) AS MES,SUM(CASE WHEN mb.VALOR>0 THEN mb.VALOR ELSE 0 END) AS ENTRADAS,SUM(CASE WHEN mb.VALOR<0 THEN ABS(mb.VALOR) ELSE 0 END) AS SAIDAS FROM MOV_BANCARIO mb WHERE ${period("mb", movDate)} GROUP BY 1,2 ORDER BY 1,2`,
        params,
      );
      for (const row of movements) {
        const year = Number(row.ANO),
          month = Number(row.MES),
          id = `${year}-${String(month).padStart(2, "0")}`,
          item = evolution.get(id) || {
            label: `${String(month).padStart(2, "0")}/${year}`,
            dre_receita: 0,
            banco_entrada: 0,
            dre_despesa: 0,
            banco_saida: 0,
          };
        item.banco_entrada = Number(row.ENTRADAS || 0);
        item.banco_saida = Number(row.SAIDAS || 0);
        evolution.set(id, item);
      }
      return {
        ok: true,
        data_ini: start.toISOString().slice(0, 10),
        data_fim: end.toISOString().slice(0, 10),
        receitas,
        despesas,
        banco: {
          entradas: Number(bank.ENTRADAS || 0),
          saidas: Number(bank.SAIDAS || 0),
          qtd: Number(bank.QTD || 0),
        },
        evolucao: [...evolution.entries()].sort().map(([, value]) => value),
      };
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

router.get("/fiscal-impostos", async (req, res) => {
  try {
    const dataIni = String(req.query.data_ini || "").trim(),
      dataFim = String(req.query.data_fim || "").trim(),
      cfop = String(req.query.cfop || "").trim(),
      tipo = String(req.query.tipo || "")
        .trim()
        .toLowerCase();
    if (!dataIni || !dataFim)
      return res
        .status(400)
        .json({ ok: false, erro: "Informe data inicial e data final." });
    const result = await withDatabase(async (db) => {
      const nf = await columns(db, "NOTAFISCAL"),
        nfp = await columns(db, "NFE_PRODUTO"),
        data = first(nf, "DTEMISS", "DTEMISSAO", "DATASAIDA", "DTALTER");
      if (!data)
        throw Object.assign(
          new Error("Nao foi encontrada coluna de data em NOTAFISCAL."),
          { status: 400 },
        );
      let icms;
      if (nfp.has("VICMS") && nfp.has("VLICMS"))
        icms =
          "CASE WHEN COALESCE(nfp.VICMS,0)<>0 THEN COALESCE(nfp.VICMS,0) ELSE COALESCE(nfp.VLICMS,0) END";
      else {
        const col = first(nfp, "VICMS", "VLICMS", "VALORICMS", "ICMS");
        icms = col ? `COALESCE(nfp.${col},0)` : "0";
      }
      const pis = first(nfp, "VPIS", "PIS", "VALORPIS"),
        cofins = first(nfp, "VCOFINS", "COFINS", "VALORCOFINS");
      if (!pis || !cofins)
        throw Object.assign(
          new Error(
            "Nao foram encontradas as colunas de PIS/COFINS em NFE_PRODUTO.",
          ),
          { status: 400 },
        );
      const where = [`CAST(nf.${data} AS DATE) BETWEEN ? AND ?`],
        params = [dbDate(dataIni), dbDate(dataFim)];
      if (nf.has("CANCELAR_NFE")) where.push("COALESCE(nf.CANCELAR_NFE,0)=0");
      if (nf.has("NFE_CANCELADA")) where.push("COALESCE(nf.NFE_CANCELADA,0)=0");
      if (nfp.has("CFOP") && cfop) {
        where.push("TRIM(nfp.CFOP)=?");
        params.push(cfop);
      }
      const flags = {
        entrada: "ENTRADA",
        devolucao: "DEVOLUCAO",
        bonificacao: "BONIFICACAO",
        remessa: "REMESSA",
        transferencia: "TRANSFERENCIA",
        perda: "PERDA",
      };
      if (tipo === "saida" && nf.has("ENTRADA"))
        where.push("COALESCE(nf.ENTRADA,0)=0");
      else if (flags[tipo] && nf.has(flags[tipo]))
        where.push(`COALESCE(nf.${flags[tipo]},0)<>0`);
      const join =
          nf.has("IDEMPRESA") && nfp.has("IDEMPRESA")
            ? "nfp.IDNF=nf.IDNF AND nfp.IDEMPRESA=nf.IDEMPRESA"
            : "nfp.IDNF=nf.IDNF",
        whereSql = where.join(" AND "),
        select = `SUM(${icms}) AS TOTAL_ICMS,SUM(COALESCE(nfp.${pis},0)) AS TOTAL_PIS,SUM(COALESCE(nfp.${cofins},0)) AS TOTAL_COFINS`,
        total =
          (
            await query(
              db,
              `SELECT ${select} FROM NOTAFISCAL nf JOIN NFE_PRODUTO nfp ON ${join} WHERE ${whereSql}`,
              params,
            )
          )[0] || {},
        mensal = await query(
          db,
          `SELECT EXTRACT(YEAR FROM CAST(nf.${data} AS DATE)) AS ANO,EXTRACT(MONTH FROM CAST(nf.${data} AS DATE)) AS MES,${select} FROM NOTAFISCAL nf JOIN NFE_PRODUTO nfp ON ${join} WHERE ${whereSql} GROUP BY EXTRACT(YEAR FROM CAST(nf.${data} AS DATE)),EXTRACT(MONTH FROM CAST(nf.${data} AS DATE)) ORDER BY 1,2`,
          params,
        );
      return {
        ok: true,
        filtros: { data_ini: dataIni, data_fim: dataFim, cfop, tipo },
        campos: {
          data,
          icms: nfp.has("VICMS") && nfp.has("VLICMS") ? "VICMS/VLICMS" : icms,
          pis,
          cofins,
          tabela_itens: "NFE_PRODUTO",
          relacionamento: join,
        },
        total: {
          TOTAL_ICMS: total.TOTAL_ICMS || 0,
          TOTAL_PIS: total.TOTAL_PIS || 0,
          TOTAL_COFINS: total.TOTAL_COFINS || 0,
        },
        mensal,
      };
    });
    res.json(result);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, erro: e.message });
  }
});

export function buildDreHierarchy(rows, plan, types) {
  const typeMap = new Map(types.map((item) => [Number(item.CDTPDRE), item])),
    groups = new Map();
  const add = (target, month, value) => {
    target.meses[month] = (target.meses[month] || 0) + value;
  };
  for (const row of rows) {
    const codes = [row.CD, row.SCD, row.SSCD, row.SSSCD].map((value) =>
        String(value ?? "X"),
      ),
      maps = [
        plan.contas,
        plan.subcontas,
        plan.subsubcontas,
        plan.subsubsubcontas,
      ];
    if (!codes.some((code) => code && code !== "X")) continue;
    let deepest = -1,
      dreType = null;
    for (let level = 0; level < maps.length; level++) {
      const account = maps[level].get(codes.slice(0, level + 1).join("|"));
      if (!account) continue;
      deepest = level;
      const classification =
        account[row.ORIGEM === "receber" ? "DRERECEBTO" : "DREPAGTO"];
      if (classification) dreType = Number(classification);
    }
    const groupId = dreType || 0,
      info = typeMap.get(groupId) || {
        TITULO: "Não classificado no DRE",
        CDDRE: 999,
      };
    if (!groups.has(groupId))
      groups.set(groupId, {
        id: groupId,
        descricao: info.TITULO || info.TIPODRE,
        ordem: Number(info.CDDRE || 999),
        meses: {},
        nodes: new Map(),
      });
    const group = groups.get(groupId),
      month = Number(row.MES || 1),
      value = Number(row.VL || 0);
    add(group, month, value);
    if (deepest < 0) {
      const missing = `missing:${codes.join("|")}`;
      if (!group.nodes.has(missing))
        group.nodes.set(missing, {
          descricao: `[${codes.find((code) => code !== "X") || "sem conta"}]`,
          nivel: 1,
          ordem: 999999,
          caminho: missing,
          meses: {},
        });
      add(group.nodes.get(missing), month, value);
      continue;
    }
    const level = deepest,
      key = codes.slice(0, level + 1).join("|"),
      account = maps[level].get(key);
    if (!account) continue;
    const nodeKey = `${level}:${key}`;
    if (!group.nodes.has(nodeKey))
      group.nodes.set(nodeKey, {
        descricao: account.DESCRICAO,
        nivel: level + 1,
        ordem: account.ORDEM,
        caminho: key,
        ordemCaminho: Array.from({ length: level + 1 }, (_, index) =>
          Number(
            maps[index].get(codes.slice(0, index + 1).join("|"))?.ORDEM ||
              999999,
          ),
        ),
        meses: {},
      });
    add(group.nodes.get(nodeKey), month, value);
  }
  const dados = [],
    resumo = [];
  for (const group of [...groups.values()].sort((a, b) => a.ordem - b.ordem)) {
    dados.push({
      descricao: group.descricao,
      nivel: 0,
      grupo: true,
      meses: group.meses,
      ordem: group.ordem,
    });
    resumo.push({
      codigo: group.id,
      descricao: group.descricao,
      meses: group.meses,
      total: Object.values(group.meses).reduce((sum, value) => sum + value, 0),
    });
    dados.push(
      ...[...group.nodes.values()].sort((a, b) => {
        const left = a.ordemCaminho || [a.ordem],
          right = b.ordemCaminho || [b.ordem];
        for (
          let index = 0;
          index < Math.max(left.length, right.length);
          index++
        ) {
          const difference =
            Number(left[index] || 0) - Number(right[index] || 0);
          if (difference) return difference;
        }
        return String(a.caminho).localeCompare(String(b.caminho), "pt-BR", {
          numeric: true,
        });
      }),
    );
  }
  const resultadoMeses = {};
  for (const item of resumo)
    for (const [month, value] of Object.entries(item.meses))
      resultadoMeses[month] = (resultadoMeses[month] || 0) + Number(value || 0);
  const resultado = Object.values(resultadoMeses).reduce(
    (sum, value) => sum + value,
    0,
  );
  dados.push({
    descricao: "Resultado do período",
    nivel: 0,
    grupo: true,
    resultado: true,
    meses: resultadoMeses,
    ordem: 1000,
  });
  return { dados, resumo, resultado };
}

async function dreData(
  db,
  { dataIni = "", dataFim = "", tipo = "competencia" },
) {
  const dateField = tipo === "vencimento" ? "DTVENC" : "COMPETENCIA",
    filters = [
      `t.${dateField} IS NOT NULL`,
      `t.STATUS IN (1,2)`,
      "(t.STATUS<>1 OR t.CDCONTA IS NOT NULL)",
    ],
    params = [];
  if (dataIni) {
    filters.push(`CAST(t.${dateField} AS DATE)>=?`);
    params.push(dbDate(dataIni));
  }
  if (dataFim) {
    filters.push(`CAST(t.${dateField} AS DATE)<=?`);
    params.push(dbDate(dataFim));
  }
  const base = (table, origin) =>
    `SELECT COALESCE(t.CDCONTA,'X') AS CD,COALESCE(t.CDSUBCONTA,'X') AS SCD,COALESCE(t.CDSUBSUBCONTA,'X') AS SSCD,COALESCE(t.CDSUBSUBSUBCONTA,'X') AS SSSCD,EXTRACT(MONTH FROM CAST(t.${dateField} AS DATE)) AS MES,SUM(COALESCE(t.VALOR,0))${origin === "pagar" ? "*-1" : ""} AS VL,'${origin}' AS ORIGEM FROM ${table} t WHERE ${filters.join(" AND ")} GROUP BY t.CDCONTA,t.CDSUBCONTA,t.CDSUBSUBCONTA,t.CDSUBSUBSUBCONTA,EXTRACT(MONTH FROM CAST(t.${dateField} AS DATE))`;
  const rows = [
    ...(await query(db, base("CTARECEBER", "receber"), params)),
    ...(await query(db, base("CTAPAGAR", "pagar"), params)),
  ];
  const map = (items, keys, description) =>
    new Map(
      items.map((item) => [
        keys.map((key) => String(item[key])).join("|"),
        {
          ...item,
          DESCRICAO: String(item[description] || "").trim(),
          ORDEM: Number(item.POSIC || 999999),
        },
      ]),
    );
  const [contas, subcontas, subsubcontas, subsubsubcontas, types] =
    await Promise.all([
      query(
        db,
        "SELECT CDCONTA,CONTA,DREPAGTO,DRERECEBTO FROM CONTAS ORDER BY CDCONTA",
      ),
      query(
        db,
        "SELECT CDCONTA,CDSUBCONTA,SUBCONTA,DREPAGTO,DRERECEBTO,POSIC FROM SUBCONTAS ORDER BY POSIC,CDSUBCONTA",
      ),
      query(
        db,
        "SELECT CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,SUBSUBCONTA,DREPAGTO,DRERECEBTO,POSIC FROM SUBSUBCONTAS ORDER BY POSIC,CDSUBSUBCONTA",
      ),
      query(
        db,
        "SELECT CDCONTA,CDSUBCONTA,CDSUBSUBCONTA,CDSUBSUBSUBCONTA,SUBSUBSUBCONTA,DREPAGTO,DRERECEBTO,POSIC FROM SUBSUBSUBCONTAS ORDER BY POSIC,CDSUBSUBSUBCONTA",
      ),
      query(
        db,
        "SELECT CDTPDRE,TIPODRE,TITULO,CDDRE FROM TIPODRE ORDER BY CDDRE,CDTPDRE",
      ),
    ]);
  return buildDreHierarchy(
    rows,
    {
      contas: map(contas, ["CDCONTA"], "CONTA"),
      subcontas: map(subcontas, ["CDCONTA", "CDSUBCONTA"], "SUBCONTA"),
      subsubcontas: map(
        subsubcontas,
        ["CDCONTA", "CDSUBCONTA", "CDSUBSUBCONTA"],
        "SUBSUBCONTA",
      ),
      subsubsubcontas: map(
        subsubsubcontas,
        ["CDCONTA", "CDSUBCONTA", "CDSUBSUBCONTA", "CDSUBSUBSUBCONTA"],
        "SUBSUBSUBCONTA",
      ),
    },
    types,
  );
}
router.get("/dre-completo", async (req, res) => {
  try {
    const data_ini = String(req.query.data_ini || ""),
      data_fim = String(req.query.data_fim || ""),
      tipo = String(req.query.tipo || "competencia"),
      result = await withDatabase((db) =>
        dreData(db, { dataIni: data_ini, dataFim: data_fim, tipo }),
      );
    res.json({ ok: true, data_ini, data_fim, tipo, ...result });
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});
router.get("/dre-completo/export", async (req, res) => {
  try {
    const dataIni = String(req.query.data_ini || ""),
      dataFim = String(req.query.data_fim || ""),
      tipo = String(req.query.tipo || "competencia"),
      result = await withDatabase((db) =>
        dreData(db, { dataIni, dataFim, tipo }),
      ),
      dados = result.dados,
      wb = new ExcelJS.Workbook(),
      ws = wb.addWorksheet("DRE Completo");
    ws.mergeCells("A1:O1");
    ws.getCell("A1").value = "DRE COMPLETO";
    ws.getCell("A1").font = { bold: true, size: 14 };
    ws.mergeCells("A2:O2");
    ws.getCell("A2").value =
      dataIni || dataFim
        ? `Período: ${dataIni} a ${dataFim}`
        : "Período: Sem filtro";
    const names = [
        "Descrição",
        "Nível",
        "Janeiro",
        "Fevereiro",
        "Março",
        "Abril",
        "Maio",
        "Junho",
        "Julho",
        "Agosto",
        "Setembro",
        "Outubro",
        "Novembro",
        "Dezembro",
        "TOTAL",
      ],
      head = ws.addRow([]);
    ws.addRow(names);
    const header = ws.getRow(4);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E40AF" },
    };
    for (const item of dados) {
      const months = Array.from({ length: 12 }, (_, i) =>
          Number(item.meses[i + 1] || 0),
        ),
        row = ws.addRow([
          "  ".repeat(Math.max(0, Number(item.nivel || 0))) + item.descricao,
          item.nivel,
          ...months,
          months.reduce((a, b) => a + b, 0),
        ]);
      for (let c = 3; c <= 15; c++)
        row.getCell(c).numFmt = "R$ #,##0.00;[Red]-R$ #,##0.00";
      if (item.grupo || item.nivel === 1) {
        row.font = { bold: true };
        row.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFDBEAFE" },
        };
      }
    }
    ws.getColumn(1).width = 40;
    for (let c = 2; c <= 15; c++) ws.getColumn(c).width = 14;
    const buffer = await wb.xlsx.writeBuffer(),
      name =
        dataIni || dataFim
          ? `DRE_Completo_${dataIni}_${dataFim}.xlsx`
          : "DRE_Completo.xlsx";
    res.set({
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename=\"${name}\"`,
    });
    res.send(Buffer.from(buffer));
  } catch (e) {
    res.status(500).json({ ok: false, erro: e.message });
  }
});

export { dreData };
export default router;
