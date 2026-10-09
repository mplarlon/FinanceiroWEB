/*
  Corrige o erro do Dashboard de Vendas:
  Column unknown SP.VLCUSTOREAL

  Execute este script no banco da maquina afetada usando o IBExpert
  (Tools > Script Executive) ou outro cliente Firebird.

  O bloco e idempotente: se a coluna ja existir, nenhuma alteracao e feita.
*/

SET SQL DIALECT 3;
SET TERM ^ ;

EXECUTE BLOCK AS
BEGIN
    IF (NOT EXISTS(
        SELECT 1
          FROM RDB$RELATION_FIELDS RF
         WHERE RF.RDB$RELATION_NAME = 'SAIDAPRODUTO'
           AND RF.RDB$FIELD_NAME = 'VLCUSTOREAL'
    )) THEN
        EXECUTE STATEMENT
            'ALTER TABLE SAIDAPRODUTO ADD VLCUSTOREAL DOUBLE PRECISION';
END^

SET TERM ; ^
COMMIT;

/* Conferencia: deve retornar VLCUSTOREAL. */
SELECT TRIM(RF.RDB$RELATION_NAME) AS TABELA,
       TRIM(RF.RDB$FIELD_NAME) AS CAMPO
  FROM RDB$RELATION_FIELDS RF
 WHERE RF.RDB$RELATION_NAME = 'SAIDAPRODUTO'
   AND RF.RDB$FIELD_NAME = 'VLCUSTOREAL';
