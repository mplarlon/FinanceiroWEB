/* ============================================================
   DIAGNOSTICO LOGIN JOSE

   Execute no banco onde o JOSE nao conecta.
   Este SQL mostra:
   - cadastro do usuario
   - status/senha
   - permissoes Dashboard 9000..9017
   - auditoria recente do login
   ============================================================ */

/* 1. Cadastro do usuario */
SELECT
    IDUSUARIO,
    LOGIN,
    NOMECOMPLETO,
    INATIVO,
    CASE
        WHEN SENHA IS NULL THEN 'SEM SENHA'
        WHEN SENHA = '' THEN 'SEM SENHA'
        ELSE 'COM SENHA'
    END AS STATUS_SENHA
FROM USUARIOS
WHERE UPPER(LOGIN) = 'JOSE';

/* 2. Permissoes esperadas para o Dashboard */
SELECT
    ou.IDUSUARIO,
    ou.IDMENUITEM,
    mm.MENUITEM,
    ou.IDOPERACAO,
    ou.APPID
FROM SIS_OPERACAOUSUARIO ou
LEFT JOIN SIS_MAINMENU mm
       ON mm.IDMENUITEM = ou.IDMENUITEM
      AND mm.APPID = ou.APPID
WHERE ou.IDUSUARIO = (
    SELECT FIRST 1 u.IDUSUARIO
    FROM USUARIOS u
    WHERE UPPER(u.LOGIN) = 'JOSE'
)
  AND ou.IDOPERACAO = 900
  AND ou.APPID = 1
  AND ou.IDMENUITEM BETWEEN 9000 AND 9017
ORDER BY ou.IDMENUITEM;

/* 3. Contagem das permissoes do Dashboard.
   Esperado: pelo menos 1 para conseguir logar.
   Ideal: 18 se ele pode acessar todos os menus. */
SELECT
    COUNT(*) AS TOTAL_PERMISSOES_DASHBOARD
FROM SIS_OPERACAOUSUARIO ou
WHERE ou.IDUSUARIO = (
    SELECT FIRST 1 u.IDUSUARIO
    FROM USUARIOS u
    WHERE UPPER(u.LOGIN) = 'JOSE'
)
  AND ou.IDOPERACAO = 900
  AND ou.APPID = 1
  AND ou.IDMENUITEM BETWEEN 9000 AND 9017;

/* 4. Permissoes 900 em outros menus, para detectar APPID/IDMENUITEM errado */
SELECT
    ou.IDUSUARIO,
    ou.IDMENUITEM,
    ou.IDOPERACAO,
    ou.APPID
FROM SIS_OPERACAOUSUARIO ou
WHERE ou.IDUSUARIO = (
    SELECT FIRST 1 u.IDUSUARIO
    FROM USUARIOS u
    WHERE UPPER(u.LOGIN) = 'JOSE'
)
  AND ou.IDOPERACAO = 900
ORDER BY ou.APPID, ou.IDMENUITEM;

/* 5. Auditoria recente, se a tabela existir */
SELECT FIRST 20
    DATA_HORA,
    LOGIN_INFORMADO,
    IDUSUARIO,
    EVENTO,
    SUCESSO,
    MOTIVO,
    IP_ORIGEM
FROM DASHBOARD_LOGIN_AUDIT
WHERE UPPER(LOGIN_INFORMADO) = 'JOSE'
   OR IDUSUARIO = (
        SELECT FIRST 1 u.IDUSUARIO
        FROM USUARIOS u
        WHERE UPPER(u.LOGIN) = 'JOSE'
   )
ORDER BY DATA_HORA DESC;
