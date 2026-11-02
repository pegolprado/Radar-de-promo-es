// Simulador do Google Sheets / Apps Script usado pelos testes (Node, sem dependências).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function criarPlanilhaFalsa(sep = ',') {
  const abas = [];
  function novaAba(nome) {
    const celulas = {}; // "l,c" -> valor
    let maxRows = 1000;
    const aba = {
      nome, celulas, formulas: {}, notas: {}, validacoes: {},
      getName: () => nome,
      getLastRow() { let m = 0; for (const k in celulas) if (celulas[k] !== '' && celulas[k] != null) m = Math.max(m, +k.split(',')[0]); return m; },
      getLastColumn() { let m = 0; for (const k in celulas) if (celulas[k] !== '' && celulas[k] != null) m = Math.max(m, +k.split(',')[1]); return m; },
      getMaxRows: () => maxRows,
      insertRowsAfter(_, n) { maxRows += n; },
      setTabColor() { return aba; }, setFrozenRows() { return aba; }, setColumnWidth() { return aba; },
      clear() { for (const k in celulas) delete celulas[k]; aba.formulas = {}; return aba; },
      clearNotes() { aba.notas = {}; return aba; },
      getRange(l, c, nl = 1, nc = 1) {
        if (l < 1 || c < 1 || nl < 1 || nc < 1) throw new Error(`getRange inválido em ${nome}: ${l},${c},${nl},${nc}`);
        if (l + nl - 1 > maxRows) throw new Error(`Faixa além do limite de linhas em ${nome}`);
        const r = {
          setValues(v) {
            assert.strictEqual(v.length, nl, `setValues: linhas ${v.length} != ${nl} em ${nome}`);
            v.forEach((linha, i) => { assert.strictEqual(linha.length, nc, `setValues: colunas ${linha.length} != ${nc} em ${nome}`);
              linha.forEach((x, j) => { celulas[`${l + i},${c + j}`] = x; }); });
            return r;
          },
          setValue(x) { celulas[`${l},${c}`] = x; return r; },
          setFormula(f) {
            assert.ok(f.startsWith('='), 'fórmula sem =');
            // Simula a planilha real: fórmula com separador errado vira #ERROR!
            const semAspas = f.replace(/"[^"]*"/g, '');
            const errado = sep === ';' ? semAspas.includes(',') : semAspas.includes(';');
            const valor = errado ? '#ERROR!' : (/^=SUM\(1.2\)$/.test(f) ? 3 : f);
            aba.formulas[`${l},${c}`] = f; celulas[`${l},${c}`] = valor; return r;
          },
          getValue() { const v = celulas[`${l},${c}`]; return v == null ? '' : v; },
          clearContent() { delete celulas[`${l},${c}`]; delete aba.formulas[`${l},${c}`]; return r; },
          getValues() { const out = []; for (let i = 0; i < nl; i++) { const linha = []; for (let j = 0; j < nc; j++) { const v = celulas[`${l + i},${c + j}`]; linha.push(v == null ? '' : v); } out.push(linha); } return out; },
          setNote(t) { aba.notas[`${l},${c}`] = t; return r; },
          setDataValidation(v) {
            aba.validacoes[`${c}`] = v;
            // Como no Google: caixa de seleção faz as células "contarem" como preenchidas (FALSE).
            if (v.checkbox) for (let i = 0; i < nl; i++) if (celulas[`${l + i},${c}`] == null || celulas[`${l + i},${c}`] === '') celulas[`${l + i},${c}`] = false;
            return r;
          },
        };
        ['setFontWeight', 'setFontColor', 'setBackground', 'setWrap', 'setVerticalAlignment', 'setNumberFormat',
          'setHorizontalAlignment', 'setFontSize'].forEach(m => { r[m] = () => r; });
        return r;
      }
    };
    return aba;
  }
  abas.push(novaAba('Página1'));
  return {
    abas,
    getSheetByName: n => abas.find(a => a.nome === n) || null,
    getSheets: () => abas.slice(),
    insertSheet(n, i) { const a = novaAba(n); abas.splice(i, 0, a); return a; },
    deleteSheet(a) { abas.splice(abas.indexOf(a), 1); },
    setSpreadsheetTimeZone(tz) { this.tz = tz; },
    setSpreadsheetLocale(l) { this.locale = l; },
  };
}


/** Formata datas como o Utilities.formatDate no fuso de São Paulo (UTC-3, sem horário de verão). */
function formatDate(d, tz, fmt) {
  const x = new Date(d.getTime() - 3 * 3600 * 1000);
  const p = (n, t = 2) => String(n).padStart(t, '0');
  const map = { yyyy: x.getUTCFullYear(), MM: p(x.getUTCMonth() + 1), dd: p(x.getUTCDate()), HH: p(x.getUTCHours()), mm: p(x.getUTCMinutes()), ss: p(x.getUTCSeconds()) };
  let out = fmt.replace(/'T'/g, 'T').replace('XXX', '-03:00');
  out = out.replace(/yyyy|MM|dd|HH|mm|ss/g, k => map[k]);
  if (fmt === 'H') return String(x.getUTCHours());
  return out;
}

/**
 * Carrega os arquivos .gs num contexto isolado, como o Apps Script faz (escopo global compartilhado).
 * telegram: função (url, opcoes) => {codigo, corpo} para simular a API.
 */
function carregarProjeto(ss, { arquivos, props = {}, telegram } = {}) {
  const validacao = () => { const b = { requireCheckbox: () => { b.checkbox = true; return b; }, requireValueInList: (l) => { b.lista = l; return b; }, setAllowInvalid: () => b, build: () => b }; return b; };
  const chamadas = [];
  const propriedades = Object.assign({}, props);
  const ctx = {
    console: { log: () => {} },
    Date, JSON, Math,
    SpreadsheetApp: { flush: () => {}, getActiveSpreadsheet: () => ss, newDataValidation: validacao, getUi: () => { throw new Error('sem UI'); } },
    Utilities: { formatDate, sleep: () => {} },
    LockService: { getScriptLock: () => ({ tryLock: () => true, releaseLock: () => {} }) },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => (k in propriedades ? propriedades[k] : null), setProperty: (k, v) => { propriedades[k] = String(v); } }) },
    UrlFetchApp: {
      fetch: (url, opcoes) => {
        chamadas.push({ url, opcoes, corpo: opcoes && typeof opcoes.payload === 'string' ? JSON.parse(opcoes.payload) : (opcoes && opcoes.payload) || null });
        const r = telegram ? telegram(url, opcoes) : { codigo: 200, corpo: { ok: true, result: { message_id: chamadas.length } } };
        if (r.excecao) throw new Error(r.excecao);
        return { getResponseCode: () => r.codigo, getContentText: () => (r.corpoTexto !== undefined ? r.corpoTexto : JSON.stringify(r.corpo)) };
      }
    }
  };
  vm.createContext(ctx);
  const codigo = arquivos.map(a => fs.readFileSync(path.join(__dirname, '..', 'apps-script', a), 'utf8')).join('\n;\n');
  vm.runInContext(codigo, ctx, { filename: 'projeto.gs' });
  ctx.__chamadas = chamadas;
  ctx.__props = propriedades;
  return ctx;
}

module.exports = { criarPlanilhaFalsa, carregarProjeto, assert };
