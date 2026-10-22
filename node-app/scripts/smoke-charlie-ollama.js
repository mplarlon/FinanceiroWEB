import { withReadOnlyDatabase } from "../server/db.js";
import { answerOllamaSqlQuestion } from "../server/lib/charlie-sql.js";
import { refreshFirebirdCatalog } from "../server/lib/charlie-metadata.js";

const question = "Quantos fornecedores ativos existem?";
const result = await withReadOnlyDatabase(async (db) => {
  let resposta = null;
  try {
    const answer = await answerOllamaSqlQuestion(db, question);
    resposta = {
      resposta: answer.resposta,
      origem: answer.origem,
      registros: answer.dados?.length || 0,
      sql: answer.sql,
    };
  } catch (error) {
    resposta = { erro: error.message };
  }
  let catalogo = null;
  try {
    catalogo = await refreshFirebirdCatalog(db);
  } catch (error) {
    catalogo = { erro: error.message };
  }
  return { pergunta: question, ...resposta, catalogo };
});
console.log(JSON.stringify(result, null, 2));
