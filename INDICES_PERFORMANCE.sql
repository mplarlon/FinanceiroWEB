/* ============================================================
   ÍNDICES PARA MELHORAR PERFORMANCE DO DASHBOARD DE VENDAS
   Execute este script no Firebird (isql ou IBExpert/FlameRobin)
   Cada CREATE INDEX pode demorar alguns minutos na primeira vez.
   ============================================================ */

/* 1. O mais importante: filtro de data nas saídas */
CREATE INDEX IF NOT EXISTS IDX_SAIDAESTOQUE_DTSAIDA
    ON SAIDAESTOQUE (DTSAIDA);

/* 2. Cancelamentos (filtro WHERE DTCANCELAMENTO IS NULL) */
CREATE INDEX IF NOT EXISTS IDX_SAIDAESTOQUE_CANCELAMENTO
    ON SAIDAESTOQUE (DTCANCELAMENTO);

/* 3. Join entre SAIDAPRODUTO e SAIDAESTOQUE */
CREATE INDEX IF NOT EXISTS IDX_SAIDAPRODUTO_NRPEDIDO_IDEMPRESA
    ON SAIDAPRODUTO (NRPEDIDO, IDEMPRESA);

/* 4. Filtro por loja */
CREATE INDEX IF NOT EXISTS IDX_SAIDAESTOQUE_IDEMPRESA
    ON SAIDAESTOQUE (IDEMPRESA);

/* 5. Filtro por vendedor */
CREATE INDEX IF NOT EXISTS IDX_SAIDAESTOQUE_CDVENDEDOR
    ON SAIDAESTOQUE (CDVENDEDOR);

/* 6. Join de produto */
CREATE INDEX IF NOT EXISTS IDX_SAIDAPRODUTO_CDPRODUTO
    ON SAIDAPRODUTO (CDPRODUTO);

/* 7. Índice composto: data + loja (cobre o caso mais comum) */
CREATE INDEX IF NOT EXISTS IDX_SAIDAESTOQUE_DATA_LOJA
    ON SAIDAESTOQUE (DTSAIDA, IDEMPRESA);

/* ============================================================
   NOTA: Se "IF NOT EXISTS" não funcionar na sua versão do
   Firebird, remova essa cláusula. Firebird 3.0+ suporta.
   Para Firebird 2.5, use:
     CREATE INDEX IDX_SAIDAESTOQUE_DTSAIDA ON SAIDAESTOQUE (DTSAIDA);
   (e ignore erros de índice já existente)
   ============================================================ */
