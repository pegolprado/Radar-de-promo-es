/**
 * RADAR INTELIGENTE DE PROMOÇÕES — MercadoLivre.gs
 * Etapa 5.3 (parte 1): conexão com a API oficial do Mercado Livre e diagnóstico.
 *
 * Documentação oficial: https://developers.mercadolivre.com.br (Autenticação e Autorização).
 * Credenciais ficam SÓ nas Propriedades do script:
 *   ML_APP_ID        = "App ID" (Client ID) da sua aplicação no DevCenter
 *   ML_CLIENT_SECRET = "Secret Key" da aplicação
 *   ML_REDIRECT_URI  = exatamente a mesma "URI de redirect" cadastrada na aplicação
 * Os tokens gerados (ML_ACCESS_TOKEN, ML_REFRESH_TOKEN, ML_TOKEN_EXPIRA) são gravados pelo próprio script.
 */

const ML_URL_AUTORIZACAO = 'https://auth.mercadolivre.com.br/authorization';
const ML_URL_API = 'https://api.mercadolibre.com';

function credenciaisML_() {
  const p = PropertiesService.getScriptProperties();
  const c = {
    appId: String(p.getProperty('ML_APP_ID') || '').trim(),
    secret: String(p.getProperty('ML_CLIENT_SECRET') || '').trim(),
    redirect: String(p.getProperty('ML_REDIRECT_URI') || '').trim()
  };
  const faltam = [];
  if (!c.appId) faltam.push('ML_APP_ID');
  if (!c.secret) faltam.push('ML_CLIENT_SECRET');
  if (!c.redirect) faltam.push('ML_REDIRECT_URI');
  if (faltam.length) throw new Error('Faltam as propriedades do script: ' + faltam.join(', ') + '. Veja docs/ETAPA-5-FONTES.md, parte 5.3.');
  if (!/^\d+$/.test(c.appId)) throw new Error('ML_APP_ID deve conter só números (é o "App ID" da aplicação).');
  if (!/^https:\/\//.test(c.redirect)) throw new Error('ML_REDIRECT_URI deve começar com https:// e ser idêntica à cadastrada na aplicação.');
  return c;
}

function linkAutorizacaoML_() {
  const c = credenciaisML_();
  return ML_URL_AUTORIZACAO + '?response_type=code&client_id=' + encodeURIComponent(c.appId) +
    '&redirect_uri=' + encodeURIComponent(c.redirect);
}

/** Menu: abre uma janela com o link de autorização e um campo para colar o endereço de retorno. */
function conectarMercadoLivre() {
  let link;
  try { link = linkAutorizacaoML_(); } catch (e) { avisar_('❌ ' + mensagemErro_(e)); return; }
  const html = HtmlService.createHtmlOutput(
    '<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">' +
    '<p><b>1.</b> <a href="' + escaparHtml_(link) + '" target="_blank">Clique aqui para autorizar o Radar no Mercado Livre</a> ' +
    '(abre outra aba; entre com a sua conta e clique em <i>Permitir</i>).</p>' +
    '<p><b>2.</b> Você será levado para o endereço de retorno. <b>Copie o endereço inteiro</b> da barra do navegador ' +
    '(ele contém <code>?code=...</code>) e cole abaixo. O código vale poucos minutos.</p>' +
    '<input id="c" style="width:100%;padding:6px" placeholder="https://...?code=TG-..."><br><br>' +
    '<button onclick="enviar()">Conectar</button> <span id="s"></span>' +
    '<script>function enviar(){document.getElementById("s").innerText="Conectando...";' +
    'google.script.run.withSuccessHandler(function(m){document.getElementById("s").innerText=m;})' +
    '.withFailureHandler(function(e){document.getElementById("s").innerText="❌ "+e.message;})' +
    '.trocarCodigoML(document.getElementById("c").value);}</script></div>'
  ).setWidth(520).setHeight(300);
  SpreadsheetApp.getUi().showModalDialog(html, 'Conectar Mercado Livre');
}

/** Troca o código de autorização por tokens. Aceita o código ou o endereço inteiro com ?code=. Nunca devolve tokens. */
function trocarCodigoML(textoColado) {
  const t = String(textoColado || '').trim();
  const m = /[?&]code=([^&#\s]+)/.exec(t);
  const codigo = m ? decodeURIComponent(m[1]) : t;
  if (!codigo || /\s/.test(codigo)) throw new Error('Não encontrei o código. Cole o endereço inteiro que contém ?code=');
  const c = credenciaisML_();
  const r = UrlFetchApp.fetch(ML_URL_API + '/oauth/token', {
    method: 'post', muteHttpExceptions: true, headers: { Accept: 'application/json' },
    payload: { grant_type: 'authorization_code', client_id: c.appId, client_secret: c.secret, code: codigo, redirect_uri: c.redirect }
  });
  const j = lerJsonSeguro_(r);
  if (r.getResponseCode() !== 200 || !j.access_token) {
    throw new Error('O Mercado Livre recusou (HTTP ' + r.getResponseCode() + '): ' + ocultar_(String(j.message || j.error || ''), c.secret) +
      '. Se o código expirou, gere outro clicando no link de novo.');
  }
  salvarTokensML_(j);
  return '✅ Conectado (usuário ' + j.user_id + '). Agora rode 📡 Radar > Diagnosticar Mercado Livre.';
}

function salvarTokensML_(j) {
  const p = PropertiesService.getScriptProperties();
  p.setProperty('ML_ACCESS_TOKEN', j.access_token);
  if (j.refresh_token) p.setProperty('ML_REFRESH_TOKEN', j.refresh_token);
  p.setProperty('ML_TOKEN_EXPIRA', String(Date.now() + (Number(j.expires_in) || 21600) * 1000));
}

/** Token válido; renova sozinho quando faltar menos de 5 minutos (o refresh token muda a cada renovação). */
function tokenML_() {
  const p = PropertiesService.getScriptProperties();
  const atual = p.getProperty('ML_ACCESS_TOKEN');
  const expira = Number(p.getProperty('ML_TOKEN_EXPIRA') || 0);
  if (atual && expira - Date.now() > 5 * 60000) return atual;
  const refresh = p.getProperty('ML_REFRESH_TOKEN');
  if (!refresh) throw new Error('Mercado Livre não conectado. Use 📡 Radar > Conectar Mercado Livre.');
  const c = credenciaisML_();
  const r = UrlFetchApp.fetch(ML_URL_API + '/oauth/token', {
    method: 'post', muteHttpExceptions: true, headers: { Accept: 'application/json' },
    payload: { grant_type: 'refresh_token', client_id: c.appId, client_secret: c.secret, refresh_token: refresh }
  });
  const j = lerJsonSeguro_(r);
  if (r.getResponseCode() !== 200 || !j.access_token) {
    throw new Error('Não foi possível renovar o acesso ao Mercado Livre (HTTP ' + r.getResponseCode() + ' ' +
      String(j.error || j.message || '') + '). Conecte de novo: 📡 Radar > Conectar Mercado Livre.');
  }
  salvarTokensML_(j);
  return j.access_token;
}

/** GET autenticado na API. Devolve {codigo, json}. Nunca expõe o token. */
function apiML_(caminho) {
  const token = tokenML_();
  const r = UrlFetchApp.fetch(ML_URL_API + caminho, {
    muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token, Accept: 'application/json' }
  });
  return { codigo: r.getResponseCode(), json: lerJsonSeguro_(r) };
}

function lerJsonSeguro_(r) {
  try { return JSON.parse(r.getContentText()) || {}; } catch (e) { return {}; }
}

/**
 * IDs do Mercado Livre num texto (links ou IDs soltos, separados por vírgula):
 *   .../p/MLB12345678        → produto de catálogo  {tipo:'produto', id:'MLB12345678'}
 *   .../MLB-1234567890-nome  → anúncio              {tipo:'item',    id:'MLB1234567890'}
 *   MLB1234567890            → anúncio
 */
function idsMercadoLivre_(texto) {
  const saida = [], vistos = {};
  String(texto || '').split(/[,\s]+/).forEach(function (parte) {
    let m = /\/p\/(MLB\d{5,})/i.exec(parte);
    let r = m ? { tipo: 'produto', id: m[1].toUpperCase() } : null;
    if (!r) {
      m = /(?:item_id[=:]|wid=)?\bMLB-?(\d{6,})/i.exec(parte);
      if (m) r = { tipo: 'item', id: 'MLB' + m[1] };
    }
    if (r && !vistos[r.tipo + r.id]) { vistos[r.tipo + r.id] = true; saida.push(r); }
  });
  return saida;
}

/** Menu / editor: testa, com o seu acesso, o que a API do Mercado Livre permite consultar. Não coleta nada. */
function diagnosticarMercadoLivre() {
  const linhas = [];
  const add = function (ok, texto) { linhas.push((ok === true ? '✅ ' : ok === false ? '❌ ' : '➖ ') + texto); };
  try {
    tokenML_();
  } catch (e) {
    add(false, 'Acesso: ' + mensagemErro_(e));
    return finalizarDiagnosticoML_(linhas);
  }

  let r = apiML_('/users/me');
  add(r.codigo === 200, 'Acesso (users/me): HTTP ' + r.codigo + (r.codigo === 200 ? ' — conta ' + (r.json.nickname || r.json.id) : ' ' + (r.json.message || '')));

  r = apiML_('/sites/MLB/search?q=' + encodeURIComponent('galaxy tab s10 fe') + '&limit=1');
  const achado = r.codigo === 200 && r.json.results && r.json.results[0];
  add(r.codigo === 200, 'Busca por palavra (com acesso): HTTP ' + r.codigo + (achado ? ' — ex.: "' + String(achado.title).slice(0, 60) + '" ' + reais_(Number(achado.price)) : ' ' + (r.json.message || '')));

  // IDs para testar: links que você colou na aba PRODUTOS + o resultado da busca, se houver.
  let ids = [];
  try {
    lerTabela_('PRODUTOS').linhas.forEach(function (l) { ids = ids.concat(idsMercadoLivre_(l.get('Links ou IDs monitorados'))); });
  } catch (e) { /* sem planilha: segue */ }
  if (achado) ids.push({ tipo: 'item', id: achado.id });
  if (!ids.length) {
    add(null, 'Consulta de anúncio/produto: não testada. Cole o link de um anúncio do Mercado Livre na coluna ' +
      '"Links ou IDs monitorados" de um produto (aba PRODUTOS) e rode este diagnóstico de novo.');
  }
  ids.slice(0, 4).forEach(function (x) {
    if (x.tipo === 'item') {
      const ri = apiML_('/items/' + x.id);
      add(ri.codigo === 200, 'Anúncio ' + x.id + ': HTTP ' + ri.codigo + (ri.codigo === 200
        ? ' — "' + String(ri.json.title).slice(0, 60) + '" ' + reais_(Number(ri.json.price)) + ', status ' + ri.json.status
        : ' ' + (ri.json.message || '')));
    } else {
      const rp = apiML_('/products/' + x.id);
      const bb = rp.json.buy_box_winner;
      add(rp.codigo === 200, 'Produto de catálogo ' + x.id + ': HTTP ' + rp.codigo + (rp.codigo === 200
        ? ' — "' + String(rp.json.name).slice(0, 60) + '"' + (bb && bb.price ? ', melhor oferta ' + reais_(Number(bb.price)) : ', sem preço de oferta vencedora')
        : ' ' + (rp.json.message || '')));
    }
    Utilities.sleep(300);
  });
  return finalizarDiagnosticoML_(linhas);
}

function finalizarDiagnosticoML_(linhas) {
  const texto = 'DIAGNÓSTICO MERCADO LIVRE (' + Utilities.formatDate(new Date(), RADAR_FUSO, 'dd/MM/yyyy HH:mm') + ')\n\n' + linhas.join('\n');
  const ctx = { logs: [] };
  log_(ctx, 'INFO', 'diagnóstico:ML', texto.slice(0, 480), '');
  try { gravarLogs_(ctx); } catch (e) { /* sem planilha */ }
  console.log(texto);
  try { SpreadsheetApp.getUi().alert(texto); } catch (e) { /* editor */ }
  return texto;
}
