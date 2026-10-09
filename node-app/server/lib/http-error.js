// Erro HTTP com status explicito, pra rotas devolverem 400/404/409/502 etc.
// em vez de sempre 500 (equivalente ao api_error(msg, code) do Flask).
export class HttpError extends Error {
  constructor(message, status = 500) {
    super(message instanceof Error ? message.message : String(message));
    this.status = status;
    if (message instanceof Error && message.stack) this.stack = message.stack;
  }
}

export function sendError(res, error, fallbackStatus = 500) {
  const status = error instanceof HttpError ? error.status : fallbackStatus;
  res.status(status).json({ ok: false, erro: error?.message || String(error) });
}
