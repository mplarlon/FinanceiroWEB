// credito_trabalhador.js — funções do módulo Crédito do Trabalhador

// -----------------------------------------------------------------------
// Configuração / certificado
// -----------------------------------------------------------------------
async function salvarConfigCreditoTrabalhador() {
  const btn = document.querySelector('[onclick="salvarConfigCreditoTrabalhador()"]');
  const status = document.getElementById('ct-config-status');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Salvando...'; }
  status.innerHTML = '';

  const fd = new FormData();
  const cnpj = document.getElementById('ct-config-cnpj')?.value?.trim();
  const senha = document.getElementById('ct-cert-senha')?.value?.trim();
  const certFile = document.getElementById('ct-certificado')?.files?.[0];
  const chaveFile = document.getElementById('ct-chave')?.files?.[0];

  if (cnpj)     fd.append('cnpj', cnpj);
  if (senha)    fd.append('cert_password', senha);
  if (certFile) fd.append('certificado', certFile);
  if (chaveFile) fd.append('chave', chaveFile);

  try {
    const res = await fetch('/api/credito/config', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.ok) {
      status.innerHTML = `<span style="color:#16a34a;font-weight:600">✔ ${data.msg}</span>`;
    } else {
      status.innerHTML = `<span style="color:#dc2626">Erro: ${data.erro}</span>`;
    }
  } catch(e) {
    status.innerHTML = `<span style="color:#dc2626">Erro: ${e.message}</span>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Salvar certificado'; }
  }
}

// -----------------------------------------------------------------------
// Carrega lista do banco local (se existir) ao entrar na aba
// -----------------------------------------------------------------------
async function loadCreditoTrabalhador() {
  buscarExtratoCreditoTrabalhador();
}

// -----------------------------------------------------------------------
// Busca extrato na API Dataprev
// -----------------------------------------------------------------------
async function buscarExtratoCreditoTrabalhador() {
  const idempresa   = document.getElementById('ct-idempresa')?.value || 1;
  const competencia = document.getElementById('ct-competencia')?.value || '';
  const tabela      = document.getElementById('ct-tabela-contratos');
  const btnExp      = document.getElementById('ct-btn-exportar');

  if (!competencia) {
    tabela.innerHTML = '<div style="padding:16px;color:#dc2626">Selecione a competência antes de buscar.</div>';
    return;
  }

  tabela.innerHTML = '<div class="loading"><div class="spinner"></div> Consultando Dataprev...</div>';
  if (btnExp) btnExp.style.display = 'none';

  try {
    const res = await fetch('/api/credito/buscar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idempresa, competencia }),
    });
    const data = await res.json();
    if (!data.ok) {
      tabela.innerHTML = `<div style="padding:16px;color:#dc2626">Erro: ${data.erro || data.error}</div>`;
      return;
    }

    const rows = data.dados || [];
    _ctAtualizarKPIs(rows);

    if (!rows.length) {
      tabela.innerHTML = '<div style="padding:16px;color:#6b7280">Nenhum registro encontrado para esta competência.</div>';
      return;
    }

    // Filtra pelo situação se selecionado
    const situacaoFiltro = document.getElementById('ct-situacao')?.value || '';
    const exibir = situacaoFiltro ? rows.filter(r => r.situacao === situacaoFiltro) : rows;

    const fmt = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    const badge = s => {
      const cores = { ATIVO:'#16a34a', APROVADO:'#2563eb', PENDENTE:'#d97706', DIVERGENTE:'#dc2626', QUITADO:'#6b7280' };
      const cor = cores[s] || '#6b7280';
      return `<span style="background:${cor}1a;color:${cor};padding:2px 8px;border-radius:10px;font-size:11px;font-weight:600">${s}</span>`;
    };

    const trs = exibir.map(r => `
      <tr>
        <td>${r.cpf || ''}</td>
        <td>${r.nome || ''}</td>
        <td>${r.banco_codigo || ''} ${r.banco_nome ? '- ' + r.banco_nome : ''}</td>
        <td>${r.numero_contrato || ''}</td>
        <td>${r.data_contrato || ''}</td>
        <td style="text-align:right">${fmt(r.valor_contrato)}</td>
        <td style="text-align:right">${fmt(r.valor_parcela)}</td>
        <td style="text-align:center">${r.parcelas_pagas}/${r.qtde_parcelas}</td>
        <td style="text-align:center">${r.parcelas_restantes}</td>
        <td>${badge(r.situacao)}</td>
      </tr>`).join('');

    tabela.innerHTML = `
      <div style="padding:8px 16px;font-size:12px;color:#6b7280">
        ${rows.length} contrato(s) encontrado(s) · competência ${competencia}
      </div>
      <div style="overflow-x:auto">
        <table class="data-table">
          <thead><tr>
            <th>CPF</th><th>Nome</th><th>Banco</th><th>Contrato</th>
            <th>Data</th><th>Vlr Contrato</th><th>Vlr Parcela</th>
            <th>Parcelas</th><th>Restantes</th><th>Situação</th>
          </tr></thead>
          <tbody>${trs}</tbody>
        </table>
      </div>`;

    if (btnExp) {
      btnExp.style.display = '';
      btnExp.onclick = () => exportarCreditoTrabalhador(idempresa, competencia);
    }

  } catch(e) {
    tabela.innerHTML = `<div style="padding:16px;color:#dc2626">Erro: ${e.message}</div>`;
  }
}

// -----------------------------------------------------------------------
// KPIs
// -----------------------------------------------------------------------
function _ctAtualizarKPIs(rows) {
  const fmt = v => (v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const ativos    = rows.filter(r => r.situacao === 'ATIVO' || r.situacao === 'APROVADO');
  const totalMes  = ativos.reduce((s, r) => s + (r.valor_parcela || 0), 0);
  const cpfs      = new Set(ativos.map(r => r.cpf).filter(Boolean));
  const diverg    = rows.filter(r => r.situacao === 'DIVERGENTE').length;
  const quitados  = rows.filter(r => r.situacao === 'QUITADO').length;

  const set = (id, v) => { const el = document.getElementById(id); if (el) el.textContent = v; };
  set('ct-kpi-ativos', ativos.length);
  set('ct-kpi-total', fmt(totalMes));
  set('ct-kpi-func', cpfs.size);
  set('ct-kpi-div', diverg);
  set('ct-kpi-quit', quitados);
}

// -----------------------------------------------------------------------
// Exportar Excel
// -----------------------------------------------------------------------
function exportarCreditoTrabalhador(idempresa, competencia) {
  idempresa   = idempresa   || document.getElementById('ct-idempresa')?.value   || 1;
  competencia = competencia || document.getElementById('ct-competencia')?.value || '';
  if (!competencia) { alert('Selecione a competência.'); return; }
  window.location.href = `/api/credito/exportar?idempresa=${idempresa}&competencia=${encodeURIComponent(competencia)}`;
}

// -----------------------------------------------------------------------
// Gerar eventos na folha (placeholder — implementar conforme regra de negócio)
// -----------------------------------------------------------------------
async function gerarEventosCreditoTrabalhador() {
  alert('Funcionalidade "Gerar eventos na folha" em desenvolvimento.\nEm breve integrará os descontos do Crédito do Trabalhador diretamente na folha de pagamento.');
}

// -----------------------------------------------------------------------
// Importar arquivo autorizado (CSV/JSON)
// -----------------------------------------------------------------------
async function importarArquivoCreditoTrabalhador() {
  const file = document.getElementById('ct-arquivo')?.files?.[0];
  const result = document.getElementById('ct-import-result');
  if (!file) { result.innerHTML = '<div style="color:#dc2626;font-size:12px">Selecione um arquivo.</div>'; return; }

  result.innerHTML = '<div style="font-size:12px;color:#6b7280">⏳ Importando...</div>';
  const fd = new FormData();
  fd.append('arquivo', file);
  fd.append('idempresa', document.getElementById('ct-idempresa')?.value || 1);

  try {
    const res = await fetch('/api/credito/importar', { method: 'POST', body: fd });
    const data = await res.json();
    if (data.ok) {
      result.innerHTML = `<div style="color:#16a34a;font-size:12px">✔ ${data.total} registro(s) importado(s).</div>`;
      buscarExtratoCreditoTrabalhador();
    } else {
      result.innerHTML = `<div style="color:#dc2626;font-size:12px">Erro: ${data.erro}</div>`;
    }
  } catch(e) {
    result.innerHTML = `<div style="color:#dc2626;font-size:12px">Erro: ${e.message}</div>`;
  }
}
