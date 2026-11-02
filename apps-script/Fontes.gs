/**
 * RADAR INTELIGENTE DE PROMOÇÕES — Fontes.gs
 * Etapa 5.1: diagnóstico das fontes candidatas.
 *
 * Nada aqui coleta ofertas. A função diagnosticarFontes() faz UMA consulta a cada candidata,
 * a partir dos servidores do Google (onde o radar realmente roda), e informa:
 * se respondeu, se é um feed RSS/Atom de verdade, quantos itens tem e se os títulos trazem preço.
 * Só as fontes aprovadas aqui serão implementadas na Etapa 5.2.
 *
 * Endereços marcados como "a confirmar" são suposições a testar: se falharem, simplesmente
 * não serão usados. Nenhuma fonte é declarada funcionando sem passar neste teste.
 */

const RADAR_CANDIDATOS_FONTES = [
  // Controle: prova que o Apps Script consegue ler RSS (serviço público e documentado do Google Notícias).
  { nome: 'Google Notícias (controle de RSS)', tipo: 'RSS', url: 'https://news.google.com/rss/search?q=promo%C3%A7%C3%A3o+notebook&hl=pt-BR&gl=BR&ceid=BR:pt-419' },

  // Comunidades de ofertas (endereços de feed a confirmar).
  { nome: 'Promobit (a confirmar)', tipo: 'RSS', url: 'https://www.promobit.com.br/feed/' },
  { nome: 'Pelando (a confirmar)', tipo: 'RSS', url: 'https://www.pelando.com.br/rss' },
  { nome: 'Gatry (a confirmar)', tipo: 'RSS', url: 'https://gatry.com/rss' },
  { nome: 'Hardmob – Promoções (a confirmar)', tipo: 'RSS', url: 'https://www.hardmob.com.br/external.php?type=RSS2&forumids=407' },

  // Mercado Livre — API oficial (https://developers.mercadolivre.com.br).
  { nome: 'Mercado Livre – API (site MLB)', tipo: 'JSON', url: 'https://api.mercadolibre.com/sites/MLB' },
  { nome: 'Mercado Livre – busca pública', tipo: 'JSON', url: 'https://api.mercadolibre.com/sites/MLB/search?q=galaxy%20tab%20s10%20fe&limit=1' }
];

/** Rode pelo editor (função diagnosticarFontes) ou pelo menu 📡 Radar > Diagnosticar fontes. */
function diagnosticarFontes() {
  const ctx = { logs: [] };
  const linhas = [];
  let mlItemId = '';

  RADAR_CANDIDATOS_FONTES.forEach(function (c) {
    const r = testarFonteCandidata_(c);
    if (r.mlItemId) mlItemId = r.mlItemId;
    linhas.push(r.icone + ' ' + c.nome + ': ' + r.texto);
    log_(ctx, r.icone === '✅' ? 'INFO' : 'AVISO', 'diagnóstico', c.nome + ': ' + r.texto, c.url);
    Utilities.sleep(500); // educado com os servidores
  });

  // Se a busca do ML funcionou, testa também a consulta de um anúncio específico.
  if (mlItemId) {
    const c = { nome: 'Mercado Livre – anúncio por ID', tipo: 'JSON', url: 'https://api.mercadolibre.com/items/' + mlItemId };
    const r = testarFonteCandidata_(c);
    linhas.push(r.icone + ' ' + c.nome + ': ' + r.texto);
    log_(ctx, r.icone === '✅' ? 'INFO' : 'AVISO', 'diagnóstico', c.nome + ': ' + r.texto, c.url);
  } else {
    linhas.push('➖ Mercado Livre – anúncio por ID: não testado (precisa de um ID de anúncio; a busca não devolveu nenhum).');
  }

  try { gravarLogs_(ctx); } catch (e) { console.log('LOGS não gravados: ' + e); }
  const texto = 'DIAGNÓSTICO DE FONTES (' + Utilities.formatDate(new Date(), RADAR_FUSO, 'dd/MM/yyyy HH:mm') + ')\n\n' + linhas.join('\n');
  console.log(texto);
  try { SpreadsheetApp.getUi().alert(texto); } catch (e) { /* executado pelo editor */ }
  return texto;
}

function testarFonteCandidata_(c) {
  let resp;
  try {
    resp = UrlFetchApp.fetch(c.url, {
      muteHttpExceptions: true,
      followRedirects: true,
      headers: { Accept: c.tipo === 'RSS' ? 'application/rss+xml, application/atom+xml, application/xml, text/xml' : 'application/json' }
    });
  } catch (e) {
    return { icone: '❌', texto: 'sem resposta (' + String(e.message || e).slice(0, 120) + ')' };
  }
  const codigo = resp.getResponseCode();
  const corpo = String(resp.getContentText() || '');
  if (codigo !== 200) {
    let det = '';
    try { const j = JSON.parse(corpo); det = j.message || j.error || ''; } catch (e) { /* não é JSON */ }
    return { icone: '❌', texto: 'HTTP ' + codigo + (det ? ' (' + String(det).slice(0, 100) + ')' : '') };
  }
  return c.tipo === 'RSS' ? avaliarRss_(corpo) : avaliarJson_(c, corpo);
}

function avaliarRss_(xml) {
  const itens = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) || [];
  if (!itens.length) {
    const html = /<html[\s>]/i.test(xml);
    return { icone: '⚠️', texto: 'HTTP 200, mas não é um feed RSS/Atom' + (html ? ' (devolveu uma página HTML)' : '') + '.' };
  }
  const titulos = itens.map(function (it) {
    const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(it);
    return m ? limparTextoXml_(m[1]) : '';
  });
  const comPreco = itens.filter(function (it) { return /R\$\s?\d/.test(limparTextoXml_(it)); }).length;
  return {
    icone: '✅',
    texto: 'feed OK, ' + itens.length + ' itens, ' + comPreco + ' com preço (R$). Ex.: "' + (titulos[0] || '').slice(0, 90) + '"'
  };
}

function avaliarJson_(c, corpo) {
  let j;
  try { j = JSON.parse(corpo); } catch (e) { return { icone: '⚠️', texto: 'HTTP 200, mas a resposta não é JSON.' }; }
  if (Array.isArray(j.results)) {
    const primeiro = j.results[0];
    return {
      icone: '✅', mlItemId: primeiro && primeiro.id,
      texto: 'respondeu, ' + j.results.length + ' resultado(s)' + (primeiro ? '. Ex.: "' + String(primeiro.title).slice(0, 70) + '" ' + reais_(Number(primeiro.price)) : '.')
    };
  }
  if (j.id && j.price !== undefined) {
    return { icone: '✅', texto: 'respondeu: "' + String(j.title).slice(0, 70) + '" ' + reais_(Number(j.price)) + ', status ' + j.status };
  }
  if (j.id && j.name) return { icone: '✅', texto: 'respondeu (site ' + j.id + ' – ' + j.name + ').' };
  return { icone: '⚠️', texto: 'respondeu, mas em formato inesperado.' };
}

function limparTextoXml_(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'")
    .replace(/\s+/g, ' ').trim();
}
