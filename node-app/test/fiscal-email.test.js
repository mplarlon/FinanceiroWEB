import assert from "node:assert/strict";
import test from "node:test";
import { extractEmails } from "../server/lib/fiscal-email.js";

test("extrai, valida e elimina e-mails duplicados",()=>{assert.deepEqual(extractEmails("Fiscal@Empresa.com; invalido","fiscal@empresa.com, outro@empresa.com"),["fiscal@empresa.com","outro@empresa.com"])});
