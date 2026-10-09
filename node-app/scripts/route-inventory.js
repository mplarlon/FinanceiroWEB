import fs from "node:fs";
import path from "node:path";

const projectRoot = path.resolve(import.meta.dirname, "..", "..");
const sourceFiles = fs
  .readdirSync(projectRoot)
  .filter((name) => name.endsWith(".py"))
  .filter((name) => !name.startsWith("_"));
const routes = [];
const removedPrefixes = [
  "/api/credito-trabalhador",
  "/api/credito",
  "/api/dp",
  "/api/financeiro/fechamento-carteira/debug-clausulas",
];
const decorator =
  /@app\.route\(\s*(['"])(.*?)\1(?:\s*,\s*methods\s*=\s*\[([^\]]+)])?\s*\)/g;

for (const file of sourceFiles) {
  const source = fs.readFileSync(path.join(projectRoot, file), "utf8");
  for (const match of source.matchAll(decorator)) {
    if (
      removedPrefixes.some(
        (prefix) => match[2] === prefix || match[2].startsWith(`${prefix}/`),
      )
    )
      continue;
    routes.push({
      path: match[2],
      methods: match[3]
        ? [...match[3].matchAll(/['"]([A-Z]+)['"]/g)].map((item) => item[1])
        : ["GET"],
      source: file,
      migrated: false,
    });
  }
}

const migrated = new Set([
  "GET /api/auth/session",
  "POST /api/auth/login",
  "POST /api/auth/logout",
  "GET /api/branding",
  "GET /api/status",
  "GET /api/database/config",
  "POST /api/database/config",
  "POST /api/database/test",
  "GET /api/schema",
  "POST /api/query",
  ...[
    "options",
    "views",
    "summary",
    "charts",
    "heatmap",
    "all",
    "sem-giro",
  ].map((name) => `GET /api/dashboard-vendas/${name}`),
  ...[
    "options",
    "kpis",
    "ranking",
    "abc",
    "inadimplencia",
    "recompra",
    "churn",
    "sem-compra",
    "inativos",
  ].map((name) => `GET /api/clientes/${name}`),
  ...["options", "views", "summary", "charts"].map(
    (name) => `GET /api/dashboard-financeiro/${name}`,
  ),
  ...["options", "views", "summary", "charts"].map(
    (name) => `GET /api/dashboard-compras/${name}`,
  ),
  ...[
    "resumo",
    "faturamento-diario",
    "faturamento-mensal",
    "produtos-mais-vendidos",
    "por-vendedor",
    "por-forma-pagamento",
  ].map((name) => `GET /api/vendas/${name}`),
  ...["resumo", "baixo", "negativos"].map((name) => `GET /api/estoque/${name}`),
  "GET /api/fiscal/nfe/notas",
  "GET /api/fiscal/nfe/acbr/status",
  "POST /api/fiscal/nfe/<int:idnf>/emitir",
  "GET /api/fiscal/nfe/<int:idnf>/pdf",
  "DELETE /api/fiscal/nfe/<int:idnf>",
  "GET /api/fiscal/nfe/<int:idnf>/consultar",
  "POST /api/fiscal/nfe/<int:idnf>/cancelar",
  "POST /api/fiscal/nfe/inutilizar",
  "POST /api/fiscal/nfe/<int:idnf>/carta-correcao",
  "GET /api/financeiro/fechamento-carteira/preview",
  "POST /api/financeiro/fechamento-carteira/gerar",
  "GET /api/financeiro/formas-pagamento",
  "GET /api/clientes/busca",
  "GET /api/schema/tabelas",
  "GET /api/debug",
  "GET /api/debug/rotas",
  "GET /api/debug/busca-cpfcnpj",
  "GET /api/fiscal/options",
  "GET /api/fiscal-impostos/options",
  "GET /api/expedicao/opcoes",
  "GET /api/expedicao/pedidos",
  "POST /api/expedicao/pedido/status",
  "GET /api/expedicao/cargas",
  "POST /api/expedicao/cargas",
  "POST /api/expedicao/carga/<int:carga>/status",
  "GET /api/financeiro/fluxo-caixa",
  "GET /api/financeiro/saldo-bancos",
  "GET /api/financeiro/historico",
  "GET /api/fiscal/migrations/status",
  "GET /api/admin/nf-teste/listar",
  "GET /api/admin/nf-teste/comparar",
  "GET /api/conciliacao/formas-pagamento",
  "GET /api/conciliacao/centros-custo",
  "GET /api/conciliacao/contas-bancarias",
  "GET /api/conciliacao/pessoas",
  "GET /api/conciliacao/plano-contas",
  "GET /api/conciliacao/cartao/lotes",
  "GET /api/conciliacao/cartao/historico",
  "GET /api/conciliacao/itens-pendentes",
  "GET /api/conciliacao/listar-periodos",
  "GET /api/conciliacao/ultima-data-por-banco",
  "GET /api/conciliacao/cartao/depara",
  "POST /api/conciliacao/cartao/depara",
  "GET /api/boletos/bradesco/config",
  "POST /api/boletos/bradesco/config",
  "GET /api/boletos/bb/config",
  "POST /api/boletos/bb/config",
  "GET /api/boletos/sicredi/config",
  "POST /api/boletos/sicredi/config",
  "GET /api/boletos/caixa/config",
  "POST /api/boletos/caixa/config",
  "GET /api/whatsapp/webhook",
  "GET /api/whatsapp/config",
  "POST /api/whatsapp/config",
  "POST /api/whatsapp/sync",
  "GET /api/boletos/bancos",
  "POST /api/boletos/bradesco/preparar",
  "POST /api/boletos/bradesco/emitir",
  "POST /api/boletos/bb/preparar",
  "POST /api/boletos/bb/<int:boleto_id>/consultar",
  "POST /api/boletos/sicredi/preparar",
  "POST /api/boletos/sicredi/webhook",
  "POST /api/boletos/bb/emitir",
  "POST /api/boletos/sicredi/emitir",
  "POST /api/boletos/caixa/nfe/<int:idnf>/gerar",
  "GET /api/boletos/caixa/<int:boleto_id>/pdf",
  "GET /api/boletos/caixa/remessa/<int:remessa_id>",
  "POST /api/admin/nf-teste/limpar",
  "GET /",
  "POST /api/fiscal/nfe/<int:idnf>/email",
  "GET /api/fiscal-impostos",
  "GET /api/dre-completo",
  "GET /api/dre-completo/export",
  "GET /api/dashboard-compras/sugestao",
  "POST /api/dashboard-compras/sugestao/gerar",
  "GET /api/dashboard-compras/sugestao/rascunhos",
  "GET /api/dashboard-compras/sugestao/rascunhos/<int:id_sugestao>",
  "POST /api/dashboard-compras/sugestao/rascunhos/<int:id_sugestao>/aprovar",
  "POST /api/dashboard-compras/sugestao/rascunhos/<int:id_sugestao>/cancelar",
  "POST /api/auth/debug-login",
  "GET /api/dre-vs-conciliacao",
  "POST /api/whatsapp/webhook",
  "GET /api/fiscal/regras",
  "POST /api/fiscal/regras",
  "PUT /api/fiscal/regras/<int:rule_id>",
  "POST /api/fiscal/regras/<int:rule_id>/inativar",
  "GET /api/financeiro/contas-pagar",
  "GET /api/financeiro/contas-receber",
  "GET /api/financeiro/controle-caixa",
  "GET /api/financeiro/controle-caixa/opcoes",
  "GET /api/financeiro/controle-caixa/apuracao",
  "GET /api/financeiro/controle-caixa/fechamentos",
  "GET /api/financeiro/controle-caixa/transferencias",
  "GET /api/financeiro/controle-caixa/analises",
  "POST /api/financeiro/controle-caixa/fechar",
  "POST /api/financeiro/controle-caixa/movimentar",
  "POST /api/financeiro/controle-caixa/mover",
  "GET /api/financeiro/pdv/produtos",
  "GET /api/financeiro/pdv/produtos/<produto_id>/imagem",
  "GET /api/financeiro/pdv/liberacoes",
  "POST /api/financeiro/pdv/liberacoes",
  "POST /api/financeiro/pdv/liberacoes/<int:liberacao_id>",
  "GET /api/fiscal/guias",
  "POST /api/fiscal/guias",
  "GET /api/fiscal/valores-fiscais/email-config",
  "POST /api/conciliacao/deletar-periodo",
  "GET /api/conciliacao/transferencia/espelho",
  "GET /api/conciliacao/verificar-unificar-conta",
  "POST /api/conciliacao/verificar-unificar-conta",
  "POST /api/fiscal/guias/importar-pdf",
  "POST /api/fiscal/migrations/apply",
  "POST /api/fiscal/regras/carga-inicial",
  "POST /api/financeiro/operacoes/cancelar-baixa",
  "POST /api/financeiro/operacoes/desfazer-acordo",
  "POST /api/financeiro/operacoes/desfazer-acordo-legado",
  "GET /api/conciliacao/titulos",
  "POST /api/conciliacao/ofx/preview",
  "POST /api/conciliacao/ofx/importar",
  "POST /api/financeiro/operacoes/baixar",
  "POST /api/conciliacao/associar",
  "POST /api/conciliacao/transferencia",
  "POST /api/conciliacao/ctapagar/criar-de-extrato",
  "POST /api/conciliacao/cartao/preview",
  "POST /api/conciliacao/cartao/aprovar",
  "POST /api/financeiro/operacoes/acordo",
  "POST /api/financeiro/pdv/venda",
  "POST /api/fiscal/nfe/devolucao/xml",
  "POST /api/ia/perguntar",
  "GET /api/fiscal/apuracao/resumo",
  "GET /api/fiscal/apuracao/itens",
  "GET /api/fiscal/apuracao/nota/<path:chave>",
  "GET /api/fiscal/apuracao/comparativo-guia",
  "GET /api/fiscal/apuracao/exportar/excel",
  "GET /api/fiscal/apuracao/exportar/pdf",
  "POST /api/fiscal/contabil-revisao",
  "POST /api/fiscal/revisao-item",
  "GET /api/financeiro/operacoes/opcoes",
  "GET /api/fiscal/valores-fiscais",
  "POST /api/fiscal/valores-fiscais/email",
]);
for (const route of routes) {
  route.migrated = route.methods.every((method) =>
    migrated.has(`${method} ${route.path}`),
  );
}
routes.sort(
  (a, b) =>
    a.path.localeCompare(b.path) ||
    a.methods.join().localeCompare(b.methods.join()),
);
const output = {
  generated_at: new Date().toISOString(),
  total_routes: routes.reduce((sum, route) => sum + route.methods.length, 0),
  migrated_routes: routes.reduce(
    (sum, route) =>
      sum +
      route.methods.filter((method) => migrated.has(`${method} ${route.path}`))
        .length,
    0,
  ),
  routes,
};
const target = path.join(import.meta.dirname, "route-inventory.json");
fs.writeFileSync(target, `${JSON.stringify(output, null, 2)}\n`, "utf8");
console.log(
  `Inventario: ${output.migrated_routes}/${output.total_routes} contratos migrados.`,
);
