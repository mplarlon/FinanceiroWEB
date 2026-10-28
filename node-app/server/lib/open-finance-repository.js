function lista(estado, nome) {
  if (!estado[nome]) estado[nome] = [];
  return estado[nome];
}

export function criarRepositorioMemoria(estado = {}) {
  estado.seq = estado.seq || 1;
  const novoId = () => estado.seq++;
  const daEmpresa = (itens, empresa) => (empresa ? itens.filter((item) => Number(item.empresa) === Number(empresa)) : itens);

  return {
    estado,
    async politica(empresa) {
      return lista(estado, "politicas").find((item) => Number(item.empresa) === Number(empresa)) || null;
    },
    async salvarPolitica(politica) {
      const itens = lista(estado, "politicas");
      const indice = itens.findIndex((item) => Number(item.empresa) === Number(politica.empresa));
      if (indice >= 0) itens[indice] = { ...itens[indice], ...politica };
      else itens.push({ ...politica });
      return itens[indice >= 0 ? indice : itens.length - 1];
    },
    async listarConexoes(empresa) {
      return daEmpresa(lista(estado, "conexoes"), empresa);
    },
    async salvarConexao(conexao) {
      const itens = lista(estado, "conexoes");
      if (!conexao.id) conexao.id = novoId();
      const indice = itens.findIndex((item) => item.id === conexao.id);
      if (indice >= 0) itens[indice] = { ...itens[indice], ...conexao };
      else itens.push({ ...conexao });
      return itens.find((item) => item.id === conexao.id);
    },
    async obterConexao(id, empresa) {
      return lista(estado, "conexoes").find((item) => item.id === id && Number(item.empresa) === Number(empresa)) || null;
    },
    async obterConexaoPorItem(itemExterno) {
      return lista(estado, "conexoes").find((item) => item.itemExterno === itemExterno && item.status !== "desconectada") || null;
    },
    async listarContas(empresa, idConexao) {
      return daEmpresa(lista(estado, "contas"), empresa).filter((item) => !idConexao || item.conexaoId === idConexao);
    },
    async salvarConta(conta) {
      const itens = lista(estado, "contas");
      const existente = itens.find((item) => Number(item.empresa) === Number(conta.empresa) && item.idExterno === conta.idExterno);
      if (existente) {
        Object.assign(existente, conta, {
          id: existente.id,
          vinculada: conta.vinculada == null ? existente.vinculada : conta.vinculada,
          cdbanco: conta.cdbanco || existente.cdbanco,
          agenciaErp: conta.agenciaErp || existente.agenciaErp,
          numcontaErp: conta.numcontaErp || existente.numcontaErp,
        });
        return existente;
      }
      conta.id = conta.id || novoId();
      itens.push({ ...conta });
      return conta;
    },
    async obterConta(id, empresa) {
      return lista(estado, "contas").find((item) => item.id === id && Number(item.empresa) === Number(empresa)) || null;
    },
    async movimentoPorExterno(empresa, idExterno) {
      return lista(estado, "movimentos").find((item) => Number(item.empresa) === Number(empresa) && item.idExterno === idExterno) || null;
    },
    async salvarMovimento(movimento) {
      const itens = lista(estado, "movimentos");
      if (!movimento.id) movimento.id = novoId();
      const indice = itens.findIndex((item) => item.id === movimento.id);
      if (indice >= 0) itens[indice] = { ...itens[indice], ...movimento, id: itens[indice].id };
      else itens.push({ ...movimento });
      return itens.find((item) => item.id === movimento.id);
    },
    async listarMovimentos(empresa) {
      return daEmpresa(lista(estado, "movimentos"), empresa);
    },
    async obterMovimento(id, empresa) {
      return lista(estado, "movimentos").find((item) => item.id === id && Number(item.empresa) === Number(empresa)) || null;
    },
    async reservarMovimento(id, empresa) {
      const item = lista(estado, "movimentos").find((movimento) => movimento.id === id && Number(movimento.empresa) === Number(empresa));
      if (!item || !["sugerido", "divergente", "importado", "classificado"].includes(item.status)) return null;
      item.status = "processando";
      item.reservadoEm = new Date().toISOString();
      return item;
    },
    async concluirMovimento(id, patch) {
      const item = lista(estado, "movimentos").find((movimento) => movimento.id === id);
      if (!item) return null;
      Object.assign(item, patch, { status: patch.status || "conciliado", erro: "" });
      return item;
    },
    async liberarMovimento(id, erro) {
      const item = lista(estado, "movimentos").find((movimento) => movimento.id === id);
      if (!item || item.status === "conciliado") return item || null;
      item.status = "sugerido";
      item.erro = String(erro || "").slice(0, 300);
      return item;
    },
    async liberarTravados(antes) {
      let total = 0;
      for (const item of lista(estado, "movimentos")) {
        if (item.status === "processando" && (!item.reservadoEm || item.reservadoEm < antes)) {
          item.status = "sugerido";
          total += 1;
        }
      }
      return total;
    },
    async salvarSync(registro) {
      registro.id = registro.id || novoId();
      lista(estado, "syncs").push({ ...registro });
      return registro;
    },
    async listarSync(empresa, idConexao) {
      return daEmpresa(lista(estado, "syncs"), empresa).filter((item) => !idConexao || item.conexaoId === idConexao);
    },
    async listarRegras(empresa) {
      return daEmpresa(lista(estado, "regras"), empresa);
    },
    async salvarRegra(regra) {
      const itens = lista(estado, "regras");
      if (!regra.id) regra.id = novoId();
      const indice = itens.findIndex((item) => item.id === regra.id && Number(item.empresa) === Number(regra.empresa));
      if (indice >= 0) itens[indice] = { ...itens[indice], ...regra };
      else itens.push({ ...regra, ativa: regra.ativa !== false });
      return itens.find((item) => item.id === regra.id);
    },
    async salvarDivergencia(item) {
      const itens = lista(estado, "divergencias");
      const existente = itens.find((atual) => atual.movimentoId === item.movimentoId && atual.tipo === item.tipo && atual.status === "aberta");
      if (existente) return existente;
      item.id = novoId();
      itens.push({ ...item });
      return item;
    },
    async listarDivergencias(empresa) {
      return daEmpresa(lista(estado, "divergencias"), empresa);
    },
    async auditar(evento) {
      evento.id = evento.id || novoId();
      evento.em = evento.em || new Date().toISOString();
      lista(estado, "auditoria").push({ ...evento });
      return evento;
    },
    async listarAuditoria(empresa) {
      return daEmpresa(lista(estado, "auditoria"), empresa);
    },
    async eventoVisto(eventoId) {
      return lista(estado, "eventos").some((item) => item.eventoId === eventoId);
    },
    async registrarEvento(eventoId, empresa) {
      lista(estado, "eventos").push({ eventoId, empresa, em: new Date().toISOString() });
    },
    async redactarAntigos(empresa, antes) {
      let total = 0;
      for (const item of daEmpresa(lista(estado, "movimentos"), empresa)) {
        if (!["conciliado", "ignorado"].includes(item.status) || !item.data || item.data >= antes) continue;
        if (!item.pagador && !item.documento) continue;
        item.pagador = "";
        item.documento = "";
        total += 1;
      }
      return total;
    },
  };
}
