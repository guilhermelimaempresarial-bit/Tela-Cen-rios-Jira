let subtasksCarregadas = [];
let ultimoParse = { cenarios: [], warnings: [] };
let jsonVisible = false;

// ===== NAVEGAÇÃO E TEMA =====
function switchTab(tabId, btnEl) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(el => el.classList.remove('active'));
  const target = document.getElementById(tabId);
  if (target) target.classList.add('active');
  if (btnEl) btnEl.classList.add('active');
}

function toggleSectionConfig() {
  const body = document.getElementById('sectionConfigBody');
  const btn = document.getElementById('toggleSectionConfig');
  if (!body || !btn) return;
  const isOpen = body.style.display !== 'none';
  body.style.display = isOpen ? 'none' : 'block';
  btn.textContent = isOpen ? 'Mostrar' : 'Ocultar';
}

function applyThemeLabel() {
  const atual = document.documentElement.getAttribute('data-theme') || 'light';
  const btn = document.getElementById('themeToggle');
  if (btn) btn.textContent = atual === 'dark' ? '☀️ Tema claro' : '🌙 Tema escuro';
}

function toggleTheme() {
  const atual = document.documentElement.getAttribute('data-theme') || 'light';
  const novo = atual === 'dark' ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', novo);
  try { localStorage.setItem('jiraTool.theme', novo); } catch (e) {}
  applyThemeLabel();
}

async function checkSession() {
  try {
    const resp = await fetch('/api/auth/session');
    if (!resp.ok) {
      window.location.href = '/login.html';
      return;
    }
    const result = await resp.json();
    const info = document.getElementById('sessionUserInfo');
    
    if (!result.authenticated) {
      window.location.href = '/login.html';
      return;
    }

    if (result.user && result.user.requirePasswordChange) {
      window.location.href = '/change-password.html?forced=1';
      return;
    }

    if (info) {
      info.textContent = `${result.user.name || ''} · ${result.user.jiraEmail || ''}`;
    }

    const adminLink = document.getElementById('adminLink');
    if (adminLink) {
      adminLink.style.display = (result.user && result.user.role === 'admin') ? 'inline-flex' : 'none';
    }
  } catch (error) {
    console.error('Erro de sessão:', error);
  }
}

async function logout() {
  try {
    await fetch('/api/auth/logout', { method: 'POST' });
  } finally {
    window.location.href = '/login.html';
  }
}

function addLog(msg) {
  const logEl = document.getElementById('log');
  if (!logEl) return;
  logEl.textContent += msg + '\n';
  logEl.scrollTop = logEl.scrollHeight;
}

async function jiraCall(method, endpoint, body) {
  const resp = await fetch('/api/jira', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ method, endpoint, body }),
  });

  // 🛡️ INTERCEPTADOR GLOBAL DE SESSÃO PERDIDA
  // Se o servidor avisar que a sessão morreu (401), expulsa o usuário na hora!
  if (resp.status === 401) {
    window.location.href = '/login.html?motivo=sessao_expirada';
    return { status: 401, data: { error: 'Sessão expirada' } };
  }

  const text = await resp.text();
  try { return { status: resp.status, data: JSON.parse(text) }; }
  catch { return { status: resp.status, data: text }; }
}

function escapeHtml(str) {
  return String(str || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// ===== PARSER DE CENÁRIOS (SMART ENGINE) =====
const DEFAULT_SECTION_LABELS = { pre: 'Pré-condição', acao: 'Ação', resultado: 'Resultado Esperado' };

function escapeRegExp(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getConfiguredSectionLabels() {
  const elPre = document.getElementById('sectionLabelPre');
  const elAcao = document.getElementById('sectionLabelAcao');
  const elRes = document.getElementById('sectionLabelResultado');

  const labels = {
    pre: elPre?.value || DEFAULT_SECTION_LABELS.pre,
    acao: elAcao?.value || DEFAULT_SECTION_LABELS.acao,
    resultado: elRes?.value || DEFAULT_SECTION_LABELS.resultado,
  };
  labels.pre = (labels.pre || DEFAULT_SECTION_LABELS.pre).trim() || DEFAULT_SECTION_LABELS.pre;
  labels.acao = (labels.acao || DEFAULT_SECTION_LABELS.acao).trim() || DEFAULT_SECTION_LABELS.acao;
  labels.resultado = (labels.resultado || DEFAULT_SECTION_LABELS.resultado).trim() || DEFAULT_SECTION_LABELS.resultado;
  return labels;
}

// 💡 CORREÇÃO: Função restaurada para ler as cores escolhidas pelo QA no HTML
function getConfiguredSectionColors() {
  return {
    pre: document.getElementById('colorPre')?.value || 'warning',
    acao: document.getElementById('colorAcao')?.value || 'note',
    resultado: document.getElementById('colorResultado')?.value || 'success'
  };
}

function buildSectionAliases(customLabels = getConfiguredSectionLabels()) {
  const labels = {
    pre: customLabels.pre || DEFAULT_SECTION_LABELS.pre,
    acao: customLabels.acao || DEFAULT_SECTION_LABELS.acao,
    resultado: customLabels.resultado || DEFAULT_SECTION_LABELS.resultado,
  };

  const prefixoPermissivo = '^(?:[\\s\\-\\*\\•\\d\\.\\)]*)';
  const sufixoPermissivo = '\\b\\s*[:\\-\\-]?\\s*';

  return [
    { sec: 'pre', re: new RegExp(prefixoPermissivo + '(?:' + [labels.pre, 'Pré-condição', 'Pre-condicao', 'Pré-requisito', 'Contexto', 'Setup', 'Dado', 'Given', 'Precondition'].map(escapeRegExp).join('|') + ')' + sufixoPermissivo, 'i') },
    { sec: 'acao', re: new RegExp(prefixoPermissivo + '(?:' + [labels.acao, 'Ação', 'Acao', 'Passos', 'Procedimento', 'Steps', 'Quando', 'When'].map(escapeRegExp).join('|') + ')' + sufixoPermissivo, 'i') },
    { sec: 'resultado', re: new RegExp(prefixoPermissivo + '(?:' + [labels.resultado, 'Resultado Esperado', 'Resultado', 'Esperado', 'Critério de aceite', 'Expected', 'Then', 'Então', 'Entao'].map(escapeRegExp).join('|') + ')' + sufixoPermissivo, 'i') },
  ];
}

const TITLE_RE = /^(?:[\s\-\*\•]*)(?:(?:CT[-\s]?\d+)|(?:(?:nome\s*do\s*|caso\s*de\s*)?cen[aá]rio(?:\s*\d+)?)|(?:scenario)|(?:(?:nome\s*do\s*)?teste\s*\d*)|(?:t[íi]tulo)|(?:\d+[\.\)]))\s*[:\-]?\s*(.*)$/i;
function matchSectionAlias(linha) {
  for (const a of buildSectionAliases()) {
    const m = linha.match(a.re);
    if (m) {
      const resto = linha.replace(a.re, '').trim();
      return { sec: a.sec, resto, keyword: m[0].trim() };
    }
  }
  return null;
}

function splitBlocos(texto) {
  // 1. HIGIENIZAÇÃO SÊNIOR: Varre wrappers de metadados de IA (ex: "Task de Teste 10: Detalhamento...")
  const textoLimpo = texto
    .split('\n')
    .filter(linha => {
      const t = linha.trim();
      const ehLixoIA = /^\s*task\s*de\s*teste\s*\d*/i.test(t) || /^\s*detalhamento\s*do\s*cen[aá]rio/i.test(t);
      return !ehLixoIA;
    })
    .join('\n');

  const linhas = textoLimpo.replace(/\r/g, '').split('\n');
  const blocos = [];
  let atual = [];
  let ultimaVazia = false;

  const flush = () => { if (atual.some(l => l.trim())) blocos.push(atual.join('\n')); atual = []; };

  for (const raw of linhas) {
    const linha = raw.trimEnd();
    const t = linha.trim();

    // Quebra por separadores horizontais (ex: --- ou ===)
    if (/^[-=_*]{3,}$/.test(t)) { flush(); ultimaVazia = false; continue; }

    const ehTitulo = TITLE_RE.test(t) && !matchSectionAlias(t);
    if (ehTitulo && atual.some(l => l.trim())) { flush(); }

    if (t === '') {
      if (ultimaVazia && atual.some(l => l.trim())) flush();
      ultimaVazia = true;
    } else {
      ultimaVazia = false;
    }
    atual.push(linha);
  }
  flush();
  return blocos;
}

function parseBloco(bloco, indexAuto) {
  const labels = getConfiguredSectionLabels();
  const preKeys = [labels.pre, 'Pré-condição', 'Pre-condicao', 'Pré-requisito', 'Contexto', 'Setup', 'Dado', 'Given', 'Precondition'].map(escapeRegExp).join('|');
  const acaoKeys = [labels.acao, 'Ação', 'Acao', 'Passos', 'Procedimento', 'Steps', 'Quando', 'When'].map(escapeRegExp).join('|');
  const resKeys = [labels.resultado, 'Resultado Esperado', 'Resultado', 'Esperado', 'Critério de aceite', 'Expected', 'Then', 'Então', 'Entao'].map(escapeRegExp).join('|');
  
  const allKeys = `(?:${preKeys}|${acaoKeys}|${resKeys})`;
  const inlineRegex = new RegExp(`([^\\n])\\s*\\b(${allKeys}\\s*[:\\-])`, 'gi');
  
  bloco = bloco.replace(inlineRegex, '$1\n$2');

  const linhas = bloco.split('\n').map(l => l.trim()).filter(l => l);
  if (linhas.length === 0) return null;

  const warnings = [];
  let idx = 0;
  let summary = '';

 if (!matchSectionAlias(linhas[0])) {
    const bruto = extrairTitulo(linhas[0]);
    summary = garantirPrefixoCT(bruto, indexAuto);
    idx = 1;
  } else {
    summary = garantirPrefixoCT('Cenário Mapeado', indexAuto);
    // Removemos também o aviso de "sem título", assumindo que a criação automática é o fluxo feliz
  }

  let precondition = '';
  const action = [];
  const expected = [];
  let secaoAtual = null;

  for (let i = idx; i < linhas.length; i++) {
    let linha = linhas[i];
    const linhaLimpa = linha.replace(/^(?:e|and|mas|but)\s+/i, '').trim();
    
    const alias = matchSectionAlias(linha);
    if (alias) {
      secaoAtual = alias.sec;
      if (alias.resto) {
        if (alias.sec === 'pre') precondition += (precondition ? '\n' : '') + limparBullet(alias.resto);
        else if (alias.sec === 'acao') action.push(limparBullet(alias.resto));
        else if (alias.sec === 'resultado') expected.push(limparBullet(alias.resto));
      }
      continue;
    }

    if (secaoAtual === 'pre') precondition += (precondition ? '\n' : '') + limparBullet(linhaLimpa);
    else if (secaoAtual === 'acao') action.push(limparBullet(linhaLimpa));
    else if (secaoAtual === 'resultado') expected.push(limparBullet(linhaLimpa));
    else {
      action.push(limparBullet(linhaLimpa));
      if (secaoAtual === null) secaoAtual = 'acao';
    }
  }

  if (!precondition) warnings.push('sem ' + labels.pre);
  if (action.length === 0) warnings.push('sem ' + labels.acao);
  if (expected.length === 0) warnings.push('sem ' + labels.resultado);

  return { summary, precondition, action, expected, _warnings: warnings };
}

function limparBullet(linha) { 
  return linha.replace(/^[\-\*\u2022\u2023\u25E6\u2043\u2219]\s*/, '').replace(/^\d+[\.\)\-]\s*/, '').trim(); 
}

// ===== LIMPEZA E FORMATAÇÃO AVANÇADA DE TÍTULOS (SMART ENGINE) =====

function extrairTitulo(linha) {
  let t = (linha || '').trim();

  // 1. Remove rótulos comuns gerados por IA no início do texto (ex: "Nome do Cenário:", "Título:", "Caso de Teste -")
  const rotulosIA = /^(?:nome\s*do\s*cen[aá]rio|nome\s*do\s*teste|t[íi]tulo|caso\s*de\s*teste|scenario\s*name|test\s*name)\s*[:\-\u2013]?\s*/i;
  t = t.replace(rotulosIA, '');

  // 2. Remove palavras-chave secundárias ("Cenário 1.1:", "Teste 2 -", etc)
  t = t.replace(/^(?:cen[aá]rio|scenario|teste)\s*[\d\.\-]*\s*[:\-\u2013]?\s*/i, '');

  // 3. Remove numerações no padrão de listas de IA (ex: "1.1 ", "1.1.2 ", "1) ", "2 - ")
  t = t.replace(/^[\d\.\)]+\s*[:\-\u2013]?\s*/, '').trim();

  // 4. Se sobrou um ':' ou '-' solto no início após a limpeza, remove
  t = t.replace(/^[:\-\u2013]\s*/, '').trim();

  return t || linha;
}

function garantirPrefixoCT(summary, autoIdx) {
  const s = (summary || '').trim();
  
  // Verifica se o título já possui o prefixo CT (ex: CT-01, CT1, CT 02)
  const jaTemCT = /^ct[-\s]?\d+/i.test(s);
  if (jaTemCT) return s;

  const prefixo = `CT-${String(autoIdx).padStart(2, '0')}`;
  
  // Se o título estiver vazio após a limpeza, retorna apenas o CT-01
  return s ? `${prefixo}: ${s}` : prefixo;
}

function parseEntrada(texto) {
  const trimmed = texto.trim();
  const warnings = [];

  if (trimmed.startsWith('[') || trimmed.startsWith('{')) {
    try {
      let data = JSON.parse(trimmed);
      if (!Array.isArray(data)) data = [data];
      const cenarios = data.map((c, i) => normalizarJson(c, i + 1, warnings));
      return { cenarios, warnings, origem: 'json' };
    } catch (e) {
      warnings.push('Parece JSON mas é inválido — interpretando como texto. (' + e.message + ')');
    }
  }

  const blocos = splitBlocos(texto);
  const cenarios = [];
  blocos.forEach((b, i) => {
    const c = parseBloco(b, cenarios.length + 1);
    if (c) cenarios.push(c);
  });
  return { cenarios, warnings, origem: 'texto' };
}

function normalizarJson(c, autoIdx, warnings) {
  const tituloBruto = c.summary || c.titulo || c.title || '';
  const summary = garantirPrefixoCT(tituloBruto, autoIdx);
  const asArray = (v) => Array.isArray(v) ? v.filter(Boolean) : (v ? [v] : []);
  const cen = {
    summary,
    precondition: c.precondition || c.precondicao || c['pré-condição'] || c.contexto || '',
    action: asArray(c.action || c.acao || c['ação'] || c.passos || c.steps),
    expected: asArray(c.expected || c.resultado || c.esperado || c['resultado esperado']),
    _warnings: []
  };
  const labels = getConfiguredSectionLabels();
  if (!cen.precondition) cen._warnings.push('sem ' + labels.pre);
  if (cen.action.length === 0) cen._warnings.push('sem ' + labels.acao);
  if (cen.expected.length === 0) cen._warnings.push('sem ' + labels.resultado);
  return cen;
}

function coletarCenarios() {
  const modeElement = document.querySelector('input[name="inputMode"]:checked');
  if (!modeElement) return { cenarios: [], warnings: [], origem: 'nenhum' };
  
  const mode = modeElement.value;
  if (mode === 'form') return { cenarios: coletarFormScenarios(), warnings: [], origem: 'form' };
  
  const cenariosInput = document.getElementById('cenarios');
  if (!cenariosInput) return { cenarios: [], warnings: [], origem: 'nenhum' };
  
  return parseEntrada(cenariosInput.value);
}

function onTextInput() {
  const box = document.getElementById('previewBox');
  if (box && box.dataset.dirty !== '1') box.dataset.dirty = '1';
}

function toggleEditorFull() {
  const split = document.getElementById('editorSplit');
  const btn = document.getElementById('btnExpandir');
  if (!split || !btn) return;
  const full = split.classList.toggle('editor-full');
  btn.textContent = full ? '🗗 Recolher editor' : '⛶ Expandir editor';
}

function preview() {
  const res = coletarCenarios();
  ultimoParse = res;
  renderPreview(res);
}

function renderPreview(res) {
  const box = document.getElementById('previewBox');
  const bar = document.getElementById('summaryBar');
  if (!box || !bar) return;
  
  const cenarios = res.cenarios || [];
  const labels = getConfiguredSectionLabels();

  const totalWarnings = cenarios.reduce((acc, c) => acc + (c._warnings?.length || 0), 0);
  bar.innerHTML = '';
  bar.innerHTML += `<span class="chip ok">${cenarios.length} cenário(s)</span>`;
  if (totalWarnings > 0) bar.innerHTML += `<span class="chip warn">${totalWarnings} aviso(s)</span>`;
  if (cenarios.length === 0) bar.innerHTML += `<span class="chip err">nada detectado</span>`;
  if (res.origem) bar.innerHTML += `<span class="chip ok">origem: ${res.origem}</span>`;

  if (jsonVisible) { renderJson(cenarios); return; }

  if (cenarios.length === 0) {
    box.innerHTML = '<div class="preview-empty">Nenhum cenário detectado. Verifique o texto colado.</div>';
    return;
  }

  box.innerHTML = cenarios.map(c => {
    const warns = (c._warnings || []).length ? `<span class="warn-badge">⚠ ${c._warnings.join(', ')}</span>` : '';
    const actionList = c.action.length ? `<ul>${c.action.map(a => `<li>${escapeHtml(a)}</li>`).join('')}</ul>` : '<em style="color:#7a869a">—</em>';
    const expList = c.expected.length ? `<ul>${c.expected.map(e => `<li>${escapeHtml(e)}</li>`).join('')}</ul>` : '<em style="color:#7a869a">—</em>';
    return `<div class="scn-card">
      <h4>${escapeHtml(c.summary)} ${warns}</h4>
      <div class="sec"><strong>${escapeHtml(labels.pre)}:</strong> ${c.precondition ? escapeHtml(c.precondition) : '<em style="color:#7a869a">—</em>'}</div>
      <div class="sec"><strong>${escapeHtml(labels.acao)}:</strong> ${actionList}</div>
      <div class="sec"><strong>${escapeHtml(labels.resultado)}:</strong> ${expList}</div>
    </div>`;
  }).join('');
}

function renderJson(cenarios) {
  const box = document.getElementById('previewBox');
  if (!box) return;
  const limpos = cenarios.map(({ _warnings, ...rest }) => rest);
  box.innerHTML = `<div class="json-view">${escapeHtml(JSON.stringify(limpos, null, 2))}</div>`;
}

function toggleJsonView() {
  jsonVisible = !jsonVisible;
  const res = ultimoParse.cenarios?.length ? ultimoParse : coletarCenarios();
  ultimoParse = res;
  renderPreview(res);
}

async function copyJson() {
  const res = coletarCenarios();
  const limpos = (res.cenarios || []).map(({ _warnings, ...rest }) => rest);
  const txt = JSON.stringify(limpos, null, 2);
  try {
    await navigator.clipboard.writeText(txt);
    addLog('📋 JSON copiado para a área de transferência (' + limpos.length + ' cenário(s)).');
  } catch (e) {
    addLog('⚠️ Não foi possível copiar automaticamente. JSON abaixo:\n' + txt);
  }
}

function toggleInputMode() {
  const modeElement = document.querySelector('input[name="inputMode"]:checked');
  if (!modeElement) return;
  const mode = modeElement.value;
  const elTexto = document.getElementById('modeTexto');
  const elForm = document.getElementById('modeForm');
  
  if (elTexto) elTexto.style.display = mode === 'texto' ? 'block' : 'none';
  if (elForm) elForm.style.display = mode === 'form' ? 'block' : 'none';
  
  if (mode === 'form' && document.querySelectorAll('#formScenarios .form-scn').length === 0) {
    addFormScenario();
  }
}

function addFormScenario(data) {
  data = data || { summary: '', precondition: '', action: '', expected: '' };
  const container = document.getElementById('formScenarios');
  if (!container) return;
  
  const div = document.createElement('div');
  div.className = 'form-scn';
  div.innerHTML = `
    <button class="del-btn" onclick="this.parentNode.remove()">✕ Remover</button>
    <label style="margin-top:0;">Título</label>
    <input type="text" class="fs-summary" placeholder="CT-01: Nome do cenário" value="${escapeHtml(data.summary)}">
    <label>Pré-condição</label>
    <textarea class="fs-pre" style="height:70px;" placeholder="Contexto necessário antes do teste">${escapeHtml(data.precondition)}</textarea>
    <div class="row">
      <div>
        <label>Ação (uma por linha)</label>
        <textarea class="fs-action" style="height:110px;" placeholder="Abrir filtros&#10;Selecionar opção">${escapeHtml(data.action)}</textarea>
      </div>
      <div>
        <label>Resultado Esperado (um por linha)</label>
        <textarea class="fs-expected" style="height:110px;" placeholder="Filtro aplicado&#10;Lista atualizada">${escapeHtml(data.expected)}</textarea>
      </div>
    </div>`;
  container.appendChild(div);
}

function coletarFormScenarios() {
  const cards = document.querySelectorAll('#formScenarios .form-scn');
  const cenarios = [];
  cards.forEach((card, i) => {
    const summary = garantirPrefixoCT(card.querySelector('.fs-summary').value.trim(), i + 1);
    const precondition = card.querySelector('.fs-pre').value.trim();
    const action = card.querySelector('.fs-action').value.split('\n').map(l => l.trim()).filter(Boolean);
    const expected = card.querySelector('.fs-expected').value.split('\n').map(l => l.trim()).filter(Boolean);
    const _warnings = [];
    if (!precondition) _warnings.push('sem Pré-condição');
    if (action.length === 0) _warnings.push('sem Ação');
    if (expected.length === 0) _warnings.push('sem Resultado Esperado');
    cenarios.push({ summary, precondition, action, expected, _warnings });
  });
  return cenarios;
}

function buildDescription(c) {
  const labels = getConfiguredSectionLabels();
  // 💡 CORREÇÃO: Chama a função recuperada acima para aplicar a cor do painel selecionada pelo usuário
  const colors = getConfiguredSectionColors();
    
  const content = [];

  const buildSection = (labelText, colorType, innerContentBlocks) => {
    const titleBlock = { 
      type: 'paragraph', 
      content: [{ type: 'text', text: labelText + ':', marks: [{ type: 'strong' }] }] 
    };
    
    if (colorType === 'none') {
      content.push(titleBlock, ...innerContentBlocks);
    } else {
      content.push({
        type: 'panel', 
        attrs: { panelType: colorType },
        content: [titleBlock, ...innerContentBlocks]
      });
    }
  };

  const preText = c.precondition || '—';
  const preParagraphs = preText.split('\n').map(linha => ({
    type: 'paragraph',
    content: [{ type: 'text', text: linha }]
  }));
  buildSection(labels.pre, colors.pre, preParagraphs);

  buildSection(
    labels.acao, 
    colors.acao, 
    [{ 
      type: 'bulletList', 
      content: (c.action.length ? c.action : ['—']).map(a => ({ 
        type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: a }] }] 
      })) 
    }]
  );

  buildSection(
    labels.resultado, 
    colors.resultado, 
    [{ 
      type: 'bulletList', 
      content: (c.expected.length ? c.expected : ['—']).map(e => ({ 
        type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: e }] }] 
      })) 
    }]
  );

  return { version: 1, type: 'doc', content };
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runner() {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await worker(items[idx], idx);
    }
  }
  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runner());
  await Promise.all(runners);
  return results;
}
// ===== MOTOR DO MULTI-SELECT CUSTOMIZADO =====
let allCategories = [];
let selectedCategoriesList = [];

function renderMultiSelectTags() {
  const container = document.getElementById('categoryTags');
  const searchInput = document.getElementById('categorySearch');
  if (!container || !searchInput) return;

  // Limpa as tags antigas da tela sem apagar o input de busca
  container.querySelectorAll('.multiselect-tag').forEach(el => el.remove());

  // Renderiza as novas pílulas
  selectedCategoriesList.forEach(cat => {
    const tag = document.createElement('div');
    tag.className = 'multiselect-tag';
    tag.innerHTML = `${escapeHtml(cat)} <span onclick="removeCategory('${escapeHtml(cat)}')">✕</span>`;
    container.insertBefore(tag, searchInput);
  });
}

function renderMultiSelectDropdown(filterText = '') {
  const dropdown = document.getElementById('categoryDropdown');
  if (!dropdown) return;
  dropdown.innerHTML = '';
  
  // Exibe apenas as categorias que ainda NÃO foram selecionadas
  const unselected = allCategories.filter(c => !selectedCategoriesList.includes(c));
  
  // 💡 LÓGICA SÊNIOR: Usa startsWith para buscar exatamente o prefixo digitado
  const filtered = unselected.filter(c => c.toLowerCase().startsWith(filterText.toLowerCase()));

  if (filtered.length === 0) {
    dropdown.innerHTML = '<div class="multiselect-option disabled">Nenhuma opção disponível</div>';
    return;
  }

  filtered.forEach(cat => {
    const div = document.createElement('div');
    div.className = 'multiselect-option';
    div.textContent = cat;
    div.onclick = () => {
      selectedCategoriesList.push(cat);
      document.getElementById('categorySearch').value = '';
      document.getElementById('categoryDropdown').style.display = 'none';
      renderMultiSelectTags();
      renderMultiSelectDropdown();
    };
    dropdown.appendChild(div);
  });
}

function removeCategory(cat) {
  selectedCategoriesList = selectedCategoriesList.filter(c => c !== cat);
  renderMultiSelectTags();
  renderMultiSelectDropdown(document.getElementById('categorySearch')?.value || '');
}

// Escuta eventos de clique fora do componente e digitação
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.getElementById('categorySearch');
  const dropdown = document.getElementById('categoryDropdown');
  const multiselect = document.getElementById('categoryMultiSelect');

  if (searchInput && dropdown && multiselect) {
    // Ao focar no input, abre a lista
    searchInput.addEventListener('focus', () => {
      if (allCategories.length > 0) {
        dropdown.style.display = 'block';
        renderMultiSelectDropdown(searchInput.value);
      }
    });

    // Ao digitar, filtra a lista em tempo real
    searchInput.addEventListener('input', (e) => {
      dropdown.style.display = 'block';
      renderMultiSelectDropdown(e.target.value);
    });

    // Se clicar fora do componente inteiro, fecha a lista dropdown
    document.addEventListener('click', (e) => {
      if (!multiselect.contains(e.target)) {
        dropdown.style.display = 'none';
      }
    });
  }
});

async function carregarCategorias() {
  const parentKey = document.getElementById('parentKey')?.value.trim();
  const dropdown = document.getElementById('categoryDropdown');
  
  if (!parentKey || !dropdown) return;

  dropdown.innerHTML = '<div class="multiselect-option disabled">⏳ Buscando categorias...</div>';
  allCategories = []; // Reseta estado

  try {
    const resp = await jiraCall('GET', '/rest/api/3/label');
    if (resp.status === 200 && resp.data?.values?.length > 0) {
      allCategories = resp.data.values.sort((a, b) => a.localeCompare(b));
      renderMultiSelectDropdown();
    } else {
      dropdown.innerHTML = '<div class="multiselect-option disabled">Nenhuma categoria encontrada</div>';
    }
  } catch (e) {
    dropdown.innerHTML = '<div class="multiselect-option disabled">Erro ao buscar</div>';
  }
}

async function criar() {
  const btn = document.getElementById('btnCriar');
  if (btn) btn.disabled = true;
  
  const logEl = document.getElementById('log');
  if (logEl) logEl.textContent = '';

  const parentKey = document.getElementById('parentKey')?.value.trim() || '';
  const issueType = document.getElementById('issueType')?.value.trim() || '';
  const componentName = 'QA';
  const statusAlvoFinal = document.getElementById('statusFinalAlvo')?.value.trim() || '';

  const res = coletarCenarios();
  const cenarios = res.cenarios || [];

  if (cenarios.length === 0) {
    addLog('❌ ERRO: Nenhum cenário encontrado.');
    addLog('Use o botão "Pré-visualizar" para conferir a interpretação do texto.');
    if (btn) btn.disabled = false;
    return;
  }
  if (!parentKey) { 
    addLog('❌ ERRO: Preencha a Issue Pai'); 
    if (btn) btn.disabled = false; 
    return; 
  }

  // 💡 TRAVA DE SEGURANÇA (UX): Confirmação explícita da História Pai antes de disparar a API
  const confirmacaoSeguranca = confirm(
    `⚠️ ATENÇÃO!\n\nVocê está prestes a criar ${cenarios.length} cenário(s) na História Pai:\n🎯 ${parentKey}\n\nConfirma que a chave da História está correta?`
  );
  
  if (!confirmacaoSeguranca) {
    addLog('⏹️ Criação cancelada pelo usuário para revisão da Issue Pai.');
    if (btn) btn.disabled = false;
    return;
  }

  // Validação de cenários incompletos (apenas 1 declaração)
  const comAvisos = cenarios.filter(c => (c._warnings || []).length > 0);
  if (comAvisos.length > 0) {
    const detalhe = comAvisos.map(c => `   • ${c.summary}: ${c._warnings.join(', ')}`).join('\n');
    const ok = confirm(`Atenção: ${comAvisos.length} cenário(s) têm campos faltando:\n\n` +
      comAvisos.map(c => `${c.summary}: ${c._warnings.join(', ')}`).join('\n') +
      `\n\nDeseja criar mesmo assim?`);
    addLog(`⚠️ ${comAvisos.length} cenário(s) com avisos:\n${detalhe}`);
    if (!ok) { addLog('⏹️ Criação cancelada pelo usuário.'); if (btn) btn.disabled = false; return; }
  }

  // Extração única da chave do projeto
  const projectKey = parentKey.split('-')[0];
  addLog(`Criando ${cenarios.length} subtarefas em ${parentKey}...\n`);

  addLog('Identificando usuário...');
  const me = await jiraCall('GET', '/rest/api/3/myself');
  const accountId = me.data?.accountId;
  if (!accountId) { 
    addLog('❌ ERRO: Não foi possível identificar o usuário. Verifique email/token.'); 
    if (btn) btn.disabled = false; 
    return; 
  }
  addLog(`Usuário identificado: ${me.data?.displayName || me.data?.emailAddress || 'OK'}\n`);

  const createdKeys = [];

  const montarFields = (c) => {
    const fields = {
      project: { key: projectKey },
      parent: { key: parentKey },
      summary: c.summary,
      issuetype: { name: issueType },
      assignee: { accountId },
      components: [{ name: componentName }],
      description: buildDescription(c),
    };

    // Aplicação das categorias selecionadas via Custom Multi-Select
    if (selectedCategoriesList && selectedCategoriesList.length > 0) {
      fields.labels = selectedCategoriesList; 
    }

    return fields;
  };

  const LOTE = 50;
  for (let start = 0; start < cenarios.length; start += LOTE) {
    const lote = cenarios.slice(start, start + LOTE);
    addLog(`Criando lote de ${lote.length} cenário(s) [${start + 1}–${start + lote.length}]...`);

    const resp = await jiraCall('POST', '/rest/api/3/issue/bulk', {
      issueUpdates: lote.map(c => ({ fields: montarFields(c) }))
    });

    if (resp.data?.issues && resp.data.issues.length) {
      resp.data.issues.forEach((iss, idx) => {
        addLog(`   ✅ ${iss.key}: ${lote[idx]?.summary || ''}`);
        createdKeys.push(iss.key);
      });
    }
    if (resp.data?.errors && resp.data.errors.length) {
      resp.data.errors.forEach(err => {
        const n = typeof err.failedElementNumber === 'number' ? (start + err.failedElementNumber + 1) : '?';
        const det = err.elementErrors ? JSON.stringify(err.elementErrors) : JSON.stringify(err);
        addLog(`   ❌ Cenário ${n} falhou: ${det}`);
      });
    }
    if (!resp.data?.issues && !resp.data?.errors) {
      addLog(`   ❌ ERRO ${resp.status}: ${typeof resp.data === 'object' ? JSON.stringify(resp.data) : resp.data}`);
    }
  }

  if (statusAlvoFinal && createdKeys.length > 0) {
    const selectAlvo = document.getElementById('statusFinalAlvo');
    const alvoLabel = selectAlvo ? selectAlvo.options[selectAlvo.selectedIndex].text : statusAlvoFinal;
    addLog(`\n🎯 Levando ${createdKeys.length} cenário(s) até o status "${alvoLabel}" (em paralelo)...\n`);
    let okT = 0, errT = 0;
    await runWithConcurrency(createdKeys, 5, async (key) => {
      const res = await navegarIssueParaStatus(key, statusAlvoFinal);
      if (res.ok) {
        const trajeto = res.passos.length ? ` (${res.passos.join(' → ')})` : '';
        addLog(`   ✅ ${key} → "${alvoLabel}"${trajeto}`);
        okT++;
      } else {
        addLog(`   ❌ ${key}: ${res.motivo}`);
        errT++;
      }
    });
    addLog(`\nStatus aplicado. OK: ${okT} | Falhas: ${errT}`);
  }

  addLog('\n✅ Concluído!');
  if (btn) btn.disabled = false;
}

function toggleMoveMode() {
  const toggleEl = document.getElementById('moveModeToggle');
  if (!toggleEl) return;
  const lista = toggleEl.checked;
  
  const elSource = document.getElementById('sectionSourceParent');
  const elSubKeys = document.getElementById('sectionSubtaskKeys');
  const elSubContainer = document.getElementById('subtasksContainer');
  const elMoveLabel = document.getElementById('moveModeLabel');
  
  if (elSource) elSource.style.display = lista ? 'none' : 'block';
  if (elSubKeys) elSubKeys.style.display = lista ? 'block' : 'none';
  if (lista && elSubContainer) elSubContainer.style.display = 'none';
  if (elMoveLabel) elMoveLabel.textContent = lista ? 'Digitar / Colar Lista de Chaves' : 'Listar cenários da História';
}

async function carregarSubtasksOrigem() {
  const btn = document.getElementById('btnBuscarSubtasks');
  const toggleEl = document.getElementById('moveModeToggle');
  const mode = (toggleEl && toggleEl.checked) ? 'lista' : 'origem';
  let subtaskKeys = [];

  if (mode === 'origem') {
    const sourceParent = document.getElementById('sourceParentKey')?.value.trim();
    if (!sourceParent) { addLog('❌ ERRO: Informe a História Origem (ex: COR-10179)'); return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Buscando...'; }
    addLog(`🔍 Buscando sub-tasks da história ${sourceParent}...`);

    let resp = await jiraCall('GET', `/rest/api/3/issue/${sourceParent}?fields=subtasks,summary`);
    if (resp.status === 200 && resp.data?.fields?.subtasks) {
      subtaskKeys = resp.data.fields.subtasks.map(s => s.key).filter(Boolean);
      addLog(`   Chaves encontradas: ${subtaskKeys.join(', ')}`);
    }

    if (subtaskKeys.length === 0) {
      if (btn) { btn.disabled = false; btn.textContent = '🔍 Buscar'; }
      const container = document.getElementById('subtasksContainer');
      if (container) container.style.display = 'none';
      
      if (resp.status !== 200) {
        const errDetail = typeof resp.data === 'object' ? JSON.stringify(resp.data) : resp.data;
        addLog(`❌ ERRO (Status ${resp.status}): ${errDetail}`);
      } else {
        addLog(`⚠️ Nenhuma sub-task encontrada associada à história ${sourceParent}.`);
      }
      return;
    }
  } else {
    const keysInput = document.getElementById('subtaskKeys')?.value || '';
    subtaskKeys = keysInput.split(/[\s,\n]+/).map(k => k.trim()).filter(Boolean);
    if (subtaskKeys.length === 0) { addLog('❌ ERRO: Cole ao menos uma chave de cenário (ex: COR-10236).'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Buscando...'; }
    addLog(`🔍 Carregando ${subtaskKeys.length} cenário(s) informado(s)...`);
  }

  addLog(`📌 ${subtaskKeys.length} issue(s). Carregando tipo, status e transições...`);
  const detailPromises = subtaskKeys.map(async (key) => {
    try {
      const [detail, trans] = await Promise.all([
        jiraCall('GET', `/rest/api/3/issue/${key}?fields=summary,status,issuetype`),
        jiraCall('GET', `/rest/api/3/issue/${key}/transitions`)
      ]);
      const fields = detail.status === 200 && detail.data ? detail.data.fields : { summary: '', status: null };
      const transitions = trans.status === 200 && trans.data?.transitions ? trans.data.transitions : [];
      return { key: detail.data?.key || key, fields, transitions };
    } catch (e) {
      return { key, fields: { summary: '(erro ao buscar)', status: null }, transitions: [] };
    }
  });
  let list = await Promise.all(detailPromises);

  if (mode === 'lista') {
    const antes = list.length;
    const excluidas = list.filter(i => !ehTipoSubtarefa(i.fields?.issuetype?.name));
    list = list.filter(i => ehTipoSubtarefa(i.fields?.issuetype?.name));
    if (excluidas.length > 0) {
      addLog(`🔎 ${excluidas.length} de ${antes} issue(s) ignorada(s) (tipo diferente de subtarefa).`);
    }
  }

  if (btn) { btn.disabled = false; btn.textContent = '🔍 Buscar'; }
  renderSubtasksChecklist(list); 
}

function updateSelectedCount() {
  const visibleItems = document.querySelectorAll('#subtasksChecklist > div:not([style*="display: none"])');
  const visibleCbs = Array.from(visibleItems).map(i => i.querySelector('.subtask-cb')).filter(Boolean);
  const selectedCbs = visibleCbs.filter(cb => cb.checked);
  
  const elSelected = document.getElementById('selectedCount');
  const elTotal = document.getElementById('totalCount');
  const checkAll = document.getElementById('checkAllSubtasks');
  
  if (elSelected) elSelected.textContent = selectedCbs.length;
  if (elTotal) elTotal.textContent = visibleCbs.length;
  if (checkAll) checkAll.checked = (visibleCbs.length > 0 && selectedCbs.length === visibleCbs.length);
}

function toggleSelectAllSubtasks(checked) {
  document.querySelectorAll('#subtasksChecklist > div').forEach(item => {
    if (item.style.display !== 'none') { const cb = item.querySelector('.subtask-cb'); if (cb) cb.checked = checked; }
  });
  updateSelectedCount();
}

function filterSubtasksByStatus() {
  const filterEl = document.getElementById('filterStatusMover');
  if (!filterEl) return;
  const filter = String(filterEl.value || '').toLowerCase();
  document.querySelectorAll('#subtasksChecklist > div').forEach(item => {
    const status = String(item.getAttribute('data-status') || '').toLowerCase();
    const visible = !filter || status === filter;
    item.style.display = visible ? 'flex' : 'none';
    const cb = item.querySelector('.subtask-cb');
    if (cb) cb.checked = visible;
  });
  const checkAll = document.getElementById('checkAllSubtasks');
  if (checkAll) checkAll.checked = true;
  updateSelectedCount();
}

async function mover() {
  const btn = document.getElementById('btnMover');
  if (btn) btn.disabled = true;
  
  const logEl = document.getElementById('log');
  if (logEl) logEl.textContent = '';

  const targetParent = document.getElementById('targetParentKey')?.value.trim();
  if (!targetParent) { addLog('❌ ERRO: Informe a Nova História Pai de Destino (ex: COR-10200)'); if (btn) btn.disabled = false; return; }

  const keysToMove = Array.from(document.querySelectorAll('.subtask-cb:checked')).map(cb => cb.value);
  if (keysToMove.length === 0) { addLog('❌ ERRO: Nenhum cenário na lista.'); if (btn) btn.disabled = false; return; }

  addLog(`🎯 Movendo ${keysToMove.length} cenário(s) para a nova História Pai: ${targetParent}...\n`);
  let sucessos = 0, falhas = 0;
  for (let i = 0; i < keysToMove.length; i++) {
    const key = keysToMove[i];
    addLog(`[${i + 1}/${keysToMove.length}] Movendo ${key} ➔ ${targetParent}...`);
    const resp = await jiraCall('PUT', `/rest/api/3/issue/${key}`, { fields: { parent: { key: targetParent } } });
    if (resp.status === 204 || resp.status === 200) { addLog('   ✅ OK'); sucessos++; }
    else { addLog(`   ❌ ERRO ${resp.status}: ${JSON.stringify(resp.data)}`); falhas++; }
    await new Promise(r => setTimeout(r, 400));
  }
  addLog(`\n✨ Concluído! Sucessos: ${sucessos} | Falhas: ${falhas}`);
  if (btn) btn.disabled = false;
}

function normalizarStatus(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\bpra\b/g, 'para')
    .replace(/\bpronta\b/g, 'pronto');
}

function ehTipoSubtarefa(tipoNome) {
  const t = String(tipoNome || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return t.includes('subtarefa') || t.includes('subtask') || t.includes('sub tarefa') || t.includes('sub task');
}

const WORKFLOW_STATUS = {
  'aberto': ['em construcao', 'fechado', 'obsoleto'],
  'em construcao': ['especificacao concluida', 'impedida construcao', 'obsoleto'],
  'impedida construcao': ['em construcao', 'obsoleto'],
  'especificacao concluida': ['pronto para teste', 'obsoleto'],
  'pronto para teste': ['impedida teste', 'em teste', 'obsoleto'],
  'impedida teste': ['pronto para teste', 'em teste', 'obsoleto'],
  'em teste': ['aprovado', 'impedida teste', 'aberto', 'reprovado', 'obsoleto'],
  'reprovado': ['pronto para teste', 'fechado', 'obsoleto'],
  'aprovado': ['fechado', 'obsoleto'],
  'fechado': ['obsoleto'],
  'obsoleto': ['aberto']
};

function caminhoStatus(origem, alvo) {
  origem = normalizarStatus(origem);
  alvo = normalizarStatus(alvo);
  if (origem === alvo) return [origem];
  
  // Programação Defensiva: Cria um grafo garantindo que TODAS as chaves e rotas fiquem minúsculas
  const graph = {};
  for (let key in WORKFLOW_STATUS) {
    graph[normalizarStatus(key)] = WORKFLOW_STATUS[key].map(normalizarStatus);
  }

  // Se o status de origem não existir no grafo blindado, retorna erro
  if (!(origem in graph)) return null;
  
  const fila = [[origem]];
  const visitados = new Set([origem]);
  
  while (fila.length) {
    const caminho = fila.shift();
    const atual = caminho[caminho.length - 1];
    
    for (const prox of (graph[atual] || [])) {
      if (visitados.has(prox)) continue;
      const novo = caminho.concat(prox);
      if (prox === alvo) return novo;
      visitados.add(prox);
      fila.push(novo);
    }
  }
  return null;
}

async function navegarIssueParaStatus(key, alvo, statusInicial) {
  const alvoNorm = normalizarStatus(alvo);
  let atualNorm = statusInicial ? normalizarStatus(statusInicial) : null;
  const passos = [];
  let guarda = 0;
  while (guarda++ < 15) {
    if (atualNorm === null) {
      const detail = await jiraCall('GET', `/rest/api/3/issue/${key}?fields=status`);
      atualNorm = normalizarStatus(detail.data?.fields?.status?.name || '');
    }

    if (atualNorm === alvoNorm) return { ok: true, key, passos };

    const caminho = caminhoStatus(atualNorm, alvoNorm);
    if (!caminho || caminho.length < 2) {
      return { ok: false, key, motivo: `sem caminho de "${atualNorm}" até o status desejado`, passos };
    }
    const proximo = caminho[1];
    const trans = await jiraCall('GET', `/rest/api/3/issue/${key}/transitions`);
    const transicoes = (trans.status === 200 && trans.data?.transitions) ? trans.data.transitions : [];
    const t = transicoes.find(tr => normalizarStatus(tr.to?.name) === proximo);
    if (!t) {
      return { ok: false, key, motivo: `transição indisponível de "${atualNorm}" para "${proximo}"`, passos };
    }
    const r = await jiraCall('POST', `/rest/api/3/issue/${key}/transitions`, { transition: { id: t.id } });
    if (r.status !== 204) {
      return { ok: false, key, motivo: `erro HTTP ${r.status}`, passos };
    }
    passos.push(t.to?.name || proximo);
    atualNorm = normalizarStatus(t.to?.name || proximo);
  }
  return { ok: false, key, motivo: 'excedeu o número máximo de transições', passos };
}

function toggleStatusModeV2() {
  const toggleEl = document.getElementById('statusModeToggleV2');
  if (!toggleEl) return;
  const lista = toggleEl.checked;
  
  const elStatusSource = document.getElementById('sectionStatusSourceParentV2');
  const elStatusKeys = document.getElementById('sectionStatusKeysV2');
  const elStatusContainer = document.getElementById('statusContainerV2');
  const elStatusLabel = document.getElementById('statusModeLabelV2');
  
  if (elStatusSource) elStatusSource.style.display = lista ? 'none' : 'block';
  if (elStatusKeys) elStatusKeys.style.display = lista ? 'block' : 'none';
  if (lista && elStatusContainer) elStatusContainer.style.display = 'none';
  if (elStatusLabel) elStatusLabel.textContent = lista ? 'Digitar / Colar Lista de Chaves' : 'Buscar por História Pai';
}

async function carregarSubtasksStatusV2() {
  const btn = document.getElementById('btnBuscarStatusV2');
  const toggleEl = document.getElementById('statusModeToggleV2');
  const mode = (toggleEl && toggleEl.checked) ? 'lista' : 'origem';
  let subtaskKeys = [];

  if (mode === 'origem') {
    const sourceParent = document.getElementById('statusSourceParentKeyV2')?.value.trim();
    if (!sourceParent) { addLog('❌ ERRO: Informe a História Pai (ex: COR-10179)'); return; }

    if (btn) { btn.disabled = true; btn.textContent = 'Buscando...'; }
    addLog(`🔍 Buscando sub-tasks de ${sourceParent}...`);

    let resp = await jiraCall('GET', `/rest/api/3/issue/${sourceParent}?fields=subtasks,summary`);
    if (resp.status === 200 && resp.data?.fields?.subtasks) subtaskKeys = resp.data.fields.subtasks.map(s => s.key);

    if (subtaskKeys.length === 0) {
      if (btn) { btn.disabled = false; btn.textContent = '🔍 Buscar Issues'; }
      const container = document.getElementById('statusContainerV2');
      if (container) container.style.display = 'none';
      if (resp.status !== 200) {
        addLog(`❌ ERRO (Status ${resp.status})`);
      } else { addLog(`⚠️ Nenhuma sub-task encontrada.`); }
      return;
    }
  } else {
    const keysInput = document.getElementById('statusIssueKeysV2')?.value || '';
    subtaskKeys = keysInput.split(/[\s,\n]+/).map(k => k.trim()).filter(Boolean);
    if (subtaskKeys.length === 0) { addLog('❌ ERRO: Cole ao menos uma chave.'); return; }
    if (btn) { btn.disabled = true; btn.textContent = 'Buscando...'; }
  }

  addLog(`📌 ${subtaskKeys.length} issue(s). Carregando status...`);
  const detailPromises = subtaskKeys.map(async (key) => {
    try {
      const [detail, trans] = await Promise.all([
        jiraCall('GET', `/rest/api/3/issue/${key}?fields=summary,status,issuetype`),
        jiraCall('GET', `/rest/api/3/issue/${key}/transitions`)
      ]);
      const fields = detail.status === 200 && detail.data ? detail.data.fields : { summary: '', status: null };
      const transitions = trans.status === 200 && trans.data?.transitions ? trans.data.transitions : [];
      return { key: detail.data?.key || key, fields, transitions };
    } catch (e) { return { key, fields: { summary: '(erro)', status: null }, transitions: [] }; }
  });
  let list = await Promise.all(detailPromises);

  if (mode === 'lista') {
    list = list.filter(i => ehTipoSubtarefa(i.fields?.issuetype?.name));
  }

  if (btn) { btn.disabled = false; btn.textContent = '🔍 Buscar Issues'; }
  
  renderStatusChecklistV2(list);
}

// ===== ABA MOVER: RENDERIZAÇÃO DO CHECKLIST =====
function renderSubtasksChecklist(list) {
  const container = document.getElementById('subtasksContainer');
  const checklist = document.getElementById('subtasksChecklist');
  const template = document.getElementById('tpl-checklist-item');
  
  if (!checklist || !template) return;
  checklist.innerHTML = ''; 

  const filterSelect = document.getElementById('filterStatusMover');
  const statusSet = new Set(list.map(i => (i.fields?.status?.name || '').toLowerCase()).filter(Boolean));
  
  if (filterSelect) {
    filterSelect.innerHTML = '<option value="">todos os status</option>';
    [...statusSet].sort().forEach(s => { 
      filterSelect.innerHTML += `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`; 
    });
  }

  subtasksCarregadas = list;
  if (subtasksCarregadas.length === 0) { 
    if (container) container.style.display = 'none'; 
    addLog(`⚠️ Nenhuma sub-task encontrada.`); 
    return; 
  }

  addLog(`📌 Encontradas ${subtasksCarregadas.length} sub-task(s). Marque as que deseja mover abaixo.\n`);
  if (container) container.style.display = 'block';

  const fragment = document.createDocumentFragment();

  subtasksCarregadas.forEach(issue => {
    const key = issue.key;
    const summary = issue.fields?.summary || '';
    const statusName = String(issue.fields?.status?.name || '—').toLowerCase();
    const transitions = issue.transitions || [];
    const transText = transitions
      .filter(t => t && t.name)
      .map(t => `${String(t.name).toLowerCase()}:${t.id}`)
      .join(', ');

    const clone = template.content.cloneNode(true);
    const itemWrapper = clone.querySelector('.checklist-item');
    const cb = clone.querySelector('.subtask-cb');
    const label = clone.querySelector('.checklist-label');
    
    itemWrapper.dataset.status = statusName;
    
    cb.value = key;
    cb.id = `chk-${key}`;
    cb.checked = true;
    cb.addEventListener('change', updateSelectedCount); 

    label.htmlFor = `chk-${key}`;
    clone.querySelector('.item-key').textContent = key;
    clone.querySelector('.item-summary').textContent = summary;
    clone.querySelector('.checklist-status').textContent = statusName;
    
    const transEl = clone.querySelector('.checklist-transitions');
    if (transText && transEl) {
      transEl.textContent = `→ próximas: ${transText}`;
    }

    fragment.appendChild(clone);
  });

  checklist.appendChild(fragment);
  const checkAll = document.getElementById('checkAllSubtasks');
  if (checkAll) checkAll.checked = true;
  updateSelectedCount();
}

// ===== ABA ALTERAR STATUS: RENDERIZAÇÃO DO CHECKLIST (ÚNICA) =====
function renderStatusChecklistV2(list) {
  const container = document.getElementById('statusContainerV2');
  const checklist = document.getElementById('statusChecklistV2');
  const template = document.getElementById('tpl-checklist-item'); 
  
  if (!checklist || !template) return;
  checklist.innerHTML = ''; 

  const filterSelect = document.getElementById('filterStatusAlterarV2');
  const statusSet = new Set(list.map(i => (i.fields?.status?.name || '').toLowerCase()).filter(Boolean));
  
  if (filterSelect) {
    filterSelect.innerHTML = '<option value="">todos os status</option>';
    [...statusSet].sort().forEach(s => { 
      filterSelect.innerHTML += `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`; 
    });
  }

  if (!list || list.length === 0) { 
    if (container) container.style.display = 'none'; 
    addLog(`⚠️ Nenhuma sub-task encontrada.`); 
    return; 
  }

  addLog(`📌 ${list.length} sub-task(s) encontrada(s). Marque as que deseja alterar.\n`);
  if (container) container.style.display = 'block';

  const fragment = document.createDocumentFragment();

  list.forEach(issue => {
    const key = issue.key;
    const summary = issue.fields?.summary || '';
    const statusName = String(issue.fields?.status?.name || '—').toLowerCase();
    const transitions = issue.transitions || [];
    const transText = transitions
      .filter(t => t && t.name)
      .map(t => `${String(t.name).toLowerCase()}:${t.id}`)
      .join(', ');

    const clone = template.content.cloneNode(true);
    const itemWrapper = clone.querySelector('.checklist-item');
    const cb = clone.querySelector('.subtask-cb'); 
    const label = clone.querySelector('.checklist-label');
    
    itemWrapper.dataset.status = statusName;
    
    cb.className = 'status-cb-v2';
    cb.value = key;
    cb.id = `st-chk-${key}`;
    cb.checked = true;
    cb.dataset.statusAtual = statusName;
    cb.addEventListener('change', updateStatusCountV2); 

    label.htmlFor = `st-chk-${key}`;
    clone.querySelector('.item-key').textContent = key;
    clone.querySelector('.item-summary').textContent = summary;
    clone.querySelector('.checklist-status').textContent = statusName;
    
    const transEl = clone.querySelector('.checklist-transitions');
    if (transText && transEl) {
      transEl.textContent = `→ próximas: ${transText}`;
    }

    fragment.appendChild(clone);
  });

  checklist.appendChild(fragment);
  const checkAll = document.getElementById('checkAllStatusV2');
  if (checkAll) checkAll.checked = true;
  updateStatusCountV2();
}

// ===== ABA ALTERAR STATUS: FILTRAGEM =====
function filterStatusByStatusV2() {
  const filterEl = document.getElementById('filterStatusAlterarV2');
  if (!filterEl) return;
  const filter = String(filterEl.value || '').toLowerCase();
  
  document.querySelectorAll('#statusChecklistV2 > div').forEach(item => {
    const status = String(item.getAttribute('data-status') || '').toLowerCase();
    const visible = !filter || status === filter;
    item.style.display = visible ? 'flex' : 'none';
    const cb = item.querySelector('.status-cb-v2');
    if (cb) cb.checked = visible;
  });
  const checkAll = document.getElementById('checkAllStatusV2');
  if (checkAll) checkAll.checked = true;
  updateStatusCountV2();
}

function updateStatusCountV2() {
  const visibleItems = document.querySelectorAll('#statusChecklistV2 > div:not([style*="display: none"])');
  const visibleCbs = Array.from(visibleItems).map(i => i.querySelector('.status-cb-v2')).filter(Boolean);
  const selectedCbs = visibleCbs.filter(cb => cb.checked);
  
  const elSelected = document.getElementById('statusSelectedCountV2');
  const elTotal = document.getElementById('statusTotalCountV2');
  const checkAll = document.getElementById('checkAllStatusV2');

  if (elSelected) elSelected.textContent = selectedCbs.length;
  if (elTotal) elTotal.textContent = visibleCbs.length;
  if (checkAll) checkAll.checked = (visibleCbs.length > 0 && selectedCbs.length === visibleCbs.length);
}

function toggleSelectAllStatusV2(checked) {
  document.querySelectorAll('#statusChecklistV2 > div').forEach(item => {
    if (item.style.display !== 'none') { const cb = item.querySelector('.status-cb-v2'); if (cb) cb.checked = checked; }
  });
  updateStatusCountV2();
}

async function alterarV2() {
  const btn = document.getElementById('btnAlterarV2');
  if (btn) btn.disabled = true;
  
  const logEl = document.getElementById('log');
  if (logEl) logEl.textContent = '';

  const alvoSelect = document.getElementById('statusAlvoV2');
  if (!alvoSelect) return;
  const alvo = alvoSelect.value;
  const alvoLabel = alvoSelect.options[alvoSelect.selectedIndex].text;
  if (!alvo) { addLog('❌ ERRO: Selecione o status desejado.'); if (btn) btn.disabled = false; return; }

  const keysToUpdate = Array.from(document.querySelectorAll('.status-cb-v2:checked')).map(cb => cb.value);
  if (keysToUpdate.length === 0) { addLog('❌ ERRO: Nenhuma issue selecionada.'); if (btn) btn.disabled = false; return; }

  addLog(`🎯 Alterando ${keysToUpdate.length} issue(s) até o status "${alvoLabel}"...\n`);

  let sucessos = 0, falhas = 0;
  await runWithConcurrency(keysToUpdate, 5, async (key) => {
    const cb = document.querySelector('.status-cb-v2[value="' + key + '"]');
    const statusInicial = cb ? cb.getAttribute('data-status-atual') : null;
    const res = await navegarIssueParaStatus(key, alvo, statusInicial);
    if (res.ok) {
      const trajeto = res.passos.length ? ` (${(statusInicial || '?')} → ${res.passos.join(' → ')})` : ' (já no status)';
      addLog(`   ✅ ${key} → "${alvoLabel}"${trajeto}`);
      sucessos++;
    } else {
      addLog(`   ❌ ${key}: ${res.motivo}`);
      falhas++;
    }
  });
  addLog(`\n✨ Alteração Concluída! Sucessos: ${sucessos} | Falhas: ${falhas}`);
  if (btn) btn.disabled = false;
}

document.addEventListener('DOMContentLoaded', async () => {
  applyThemeLabel();
  
  if (!window.location.pathname.includes('login.html')) {
    await checkSession();
  }
});
// ===== UX: CONTROLE DE INATIVIDADE POR SEGURANÇA =====
const TEMPO_INATIVIDADE_MINUTOS = 15; // Altere o tempo limite aqui (em minutos)
let timeoutSessao;

function resetarTemporizadorSessao() {
  clearTimeout(timeoutSessao);
  
  // Configura a bomba-relógio para X minutos
  timeoutSessao = setTimeout(async () => {
    console.warn('Sessão expirada por inatividade. Executando logout...');
    try {
      // Escurece a tela para dar feedback visual de que algo aconteceu
      document.body.style.opacity = '0.4';
      document.body.style.pointerEvents = 'none';
      await fetch('/api/auth/logout', { method: 'POST' });
    } finally {
      // Redireciona com um parâmetro para avisar o motivo (opcional para o login.html ler depois)
      window.location.href = '/login.html?motivo=inativo';
    }
  }, TEMPO_INATIVIDADE_MINUTOS * 60 * 1000);
}

// Só inicia o monitoramento se o usuário NÃO estiver na tela de login
if (!window.location.pathname.includes('login.html')) {
  // Lista de eventos que indicam que o usuário está vivo e trabalhando
  const eventosAtividade = ['mousemove', 'keydown', 'scroll', 'click', 'touchstart'];
  
  eventosAtividade.forEach(evento => {
    // { passive: true } garante que a performance de rolagem e clique do QA não seja afetada
    document.addEventListener(evento, resetarTemporizadorSessao, { passive: true });
  });

  // Dá o "Start" no cronômetro assim que a página carrega
  resetarTemporizadorSessao();
}