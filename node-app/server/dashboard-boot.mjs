import http from "node:http";

process.on("uncaughtException", (error) => {
  console.error("[dashboard] excecao:", error?.stack || error);
});
process.on("unhandledRejection", (error) => {
  console.error("[dashboard] rejeicao:", error?.stack || error);
});

const port = Number(process.env.DASHBOARD_PORT || 805);

try {
  await import("./dashboard.mjs");
} catch (error) {
  const texto = String(error?.stack || error);
  console.error("[dashboard] falha ao iniciar:", texto);
  http.createServer((_req, res) => {
    res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
    res.end(`O Dashboard nao concluiu a inicializacao.\n\n${texto}`);
  }).listen(port, "0.0.0.0");
}
