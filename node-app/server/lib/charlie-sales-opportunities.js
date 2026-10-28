const COMERCIAL_ENCERRADA = new Set(["convertida", "nao_convertida", "descartada"]);
const LOJA_ENCERRADA = new Set(["converted", "dismissed"]);

function texto(valor) {
  const limpo = String(valor ?? "").replace(/\s+/g, " ").trim();
  return limpo || null;
}

function listaDe(arquivo, chave) {
  if (arquivo == null || typeof arquivo !== "object") return { lida: false, itens: null };
  if (!Object.prototype.hasOwnProperty.call(arquivo, chave)) return { lida: true, itens: null };
  const valor = arquivo[chave];
  if (Array.isArray(valor)) return { lida: true, itens: valor.filter(Boolean) };
  if (valor && typeof valor === "object") return { lida: true, itens: Object.values(valor).filter(Boolean) };
  return { lida: true, itens: null };
}

function visivel(item, ator) {
  if (ator?.gerencial) return true;
  return Number(item?.ownerUserId) === Number(ator?.id);
}

function daEmpresa(item, ator) {
  const empresa = Number(ator?.company);
  if (!Number.isInteger(empresa) || empresa <= 0) return true;
  return Number(item?.company) === empresa;
}

function gruposDe(origem, itens, tipoDe) {
  const mapa = new Map();
  for (const item of itens) {
    const tipo = texto(tipoDe(item)) || "sem tipo";
    mapa.set(tipo, (mapa.get(tipo) || 0) + 1);
  }
  return [...mapa.entries()]
    .map(([tipo, quantidade]) => ({ origem, tipo, quantidade }))
    .sort((a, b) => b.quantidade - a.quantidade || a.tipo.localeCompare(b.tipo, "pt-BR"));
}

export function montarOportunidades(fatos = {}) {
  const arquivos = fatos.arquivos || {};
  const ator = fatos.ator || {};
  const lacunas = [
    "A tela não cria oportunidade e não junta as duas origens num único número.",
    "Nome, telefone, e-mail e pontuação não aparecem nesta lista.",
  ];
  if (!ator.gerencial) lacunas.push("As oportunidades comerciais mostram só as desta sessão.");
  if (Number(ator.company) > 0) lacunas.push("As oportunidades comerciais estão limitadas à empresa da sessão.");
  lacunas.push("As oportunidades de e-commerce não têm filtro de empresa nesta lista.");

  const comercial = listaDe(arquivos["charlie-commercial-opportunities.json"], "opportunities");
  const loja = listaDe(arquivos["ecommerce_intelligence_control.json"], "opportunities");
  const fontes = [];
  const grupos = [];

  const registrar = (origem, leitura, abertas, encerradas, novosGrupos) => {
    fontes.push({
      origem,
      lida: leitura.lida,
      abertas: leitura.itens == null ? null : abertas.length,
      encerradas: leitura.itens == null ? null : encerradas.length,
    });
    if (!leitura.lida) lacunas.push(`A origem ${origem} não foi lida.`);
    else if (leitura.itens == null) lacunas.push(`O arquivo de ${origem} não tem a lista de oportunidades.`);
    else grupos.push(...novosGrupos);
  };

  const comerciais = comercial.itens
    ? comercial.itens.filter((item) => visivel(item, ator) && daEmpresa(item, ator))
    : [];
  registrar(
    "Comercial",
    comercial,
    comerciais.filter((item) => !COMERCIAL_ENCERRADA.has(item.status)),
    comerciais.filter((item) => COMERCIAL_ENCERRADA.has(item.status)),
    comercial.itens ? gruposDe("Comercial", comerciais.filter((item) => !COMERCIAL_ENCERRADA.has(item.status)), (item) => item.type) : [],
  );
  const lojas = loja.itens || [];
  registrar(
    "E-commerce",
    loja,
    lojas.filter((item) => !LOJA_ENCERRADA.has(item.status)),
    lojas.filter((item) => LOJA_ENCERRADA.has(item.status)),
    loja.itens ? gruposDe("E-commerce", lojas.filter((item) => !LOJA_ENCERRADA.has(item.status)), (item) => item.type) : [],
  );

  return {
    fontes,
    grupos,
    lacunas,
    aviso: "Nenhuma oportunidade foi criada nesta tela. A contagem usa só o que já está gravado.",
  };
}
