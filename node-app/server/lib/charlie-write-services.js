export async function executeCharlieWrite(tx, task, services = {}) {
  const item = task.snapshot?.[0];
  // Customer records may be shared by several companies and their identifiers
  // follow ERP-specific generators. Never fall back to a local MAX(id)+1 write
  // or a fixed company: only the official, installation-aware service may write.
  if (task.acao === "cadastro.criar_cliente") {
    if (!services.clientes?.criar)
      throw Object.assign(new Error("O serviço oficial de clientes não está disponível nesta instalação."), { status: 503 });
    return services.clientes.criar(tx, item, task);
  }
  if (task.acao === "cadastro.atualizar_cliente") {
    if (!services.clientes?.atualizar)
      throw Object.assign(new Error("O serviço oficial de clientes não está disponível nesta instalação."), { status: 503 });
    return services.clientes.atualizar(tx, item, task);
  }
  if (task.acao === "comercial.criar_pedido_rascunho") {
    if (!services.pedidos?.criarRascunho) throw Object.assign(new Error("O serviço oficial de pedidos não está disponível nesta instalação."), { status: 503 });
    return services.pedidos.criarRascunho(tx, task.snapshot, task);
  }
  if (task.acao === "compras.criar_solicitacao_rascunho") {
    if (!services.compras?.criarSolicitacaoRascunho)
      throw Object.assign(new Error("O serviço oficial de solicitações de compra não está disponível nesta instalação. O rascunho do Charlie foi preservado sem alterar o ERP."), { status: 503 });
    return services.compras.criarSolicitacaoRascunho(tx, task.snapshot, task);
  }
  throw Object.assign(new Error("Não existe serviço interno autorizado para esta operação."), { status: 403 });
}
