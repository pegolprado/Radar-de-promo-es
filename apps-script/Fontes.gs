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

/* =====================================================================================
 * Etapa 5.2 — COLETOR: GOOGLE NOTÍCIAS (fonte GNEWS)
 * Feed RSS público do Google Notícias (o mesmo aprovado no diagnóstico).
 * Para cada produto ATIVO, busca notícias recentes com o nome do produto e extrai do TÍTULO:
 *   preço ("R$ 2.299"), preço anterior ("de R$ X por R$ Y") e a loja citada.
 * O resultado é uma PISTA: o preço não é verificado na loja e não entra no histórico.
 * ===================================================================================== */

const GNEWS_MODELO_PADRAO = '"{produto}" (promoção OR oferta OR desconto) when:2d';
const GNEWS_IDADE_MAXIMA_HORAS = 48;

/** Apelidos usados para reconhecer a loja citada no texto. Chave = ID da aba LOJAS. */
const RADAR_APELIDOS_LOJAS = {
  amazon: ['amazon'],
  mercadolivre: ['mercado livre', 'mercadolivre', 'mercado libre'],
  magalu: ['magalu', 'magazine luiza'],
  shopee: ['shopee'],
  kabum: ['kabum'],
  casasbahia: ['casas bahia', 'casasbahia']
};

function coletar_GNEWS(fonte, ctx) {
  const modelo = fonte.parametro.indexOf('{produto}') !== -1 ? fonte.parametro : GNEWS_MODELO_PADRAO;
  const produtos = ctx.produtos.filter(function (p) { return p.ativo && p.obrigatorias.length; });
  const itens = [];
  let lidas = 0, semPreco = 0, antigas = 0;

  produtos.forEach(function (p, i) {
    if (i > 0) Utilities.sleep(400);
    const consulta = modelo.split('{produto}').join(p.nome.replace(/"/g, ''));
    const url = 'https://news.google.com/rss/search?q=' + encodeURIComponent(consulta) + '&hl=pt-BR&gl=BR&ceid=BR:pt-419';
    const xml = buscarUrl_(ctx, url, 'GNEWS');
    const entradas = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) || [];
    entradas.forEach(function (bloco) {
      lidas++;
      const campo = function (nome) {
        const m = new RegExp('<' + nome + '[^>]*>([\\s\\S]*?)</' + nome + '>', 'i').exec(bloco);
        return m ? limparTextoXml_(m[1]) : '';
      };
      let titulo = campo('title');
      const origem = campo('source');
      // O Google acrescenta " - Nome do site" no fim do título.
      if (origem && titulo.slice(-(origem.length + 3)) === ' - ' + origem) titulo = titulo.slice(0, -(origem.length + 3));
      const publicado = new Date(campo('pubDate'));
      if (!isNaN(publicado.getTime()) && ctx.agora - publicado > GNEWS_IDADE_MAXIMA_HORAS * 3600000) { antigas++; return; }

      const precos = extrairPrecos_(titulo);
      if (!precos) { semPreco++; return; }
      itens.push({
        titulo: titulo,
        preco: precos.preco,
        precoAnunciado: precos.anterior || '',
        loja: lojaNoTexto_(ctx, titulo) || '',
        link: campo('link'),
        publicadoEm: isNaN(publicado.getTime()) ? null : publicado,
        origemTexto: origem
      });
    });
  });

  log_(ctx, 'INFO', 'fonte:GNEWS', produtos.length + ' produto(s) pesquisado(s): ' + lidas + ' notícia(s), ' +
    itens.length + ' com preço no título, ' + semPreco + ' sem preço, ' + antigas + ' antiga(s).', '');
  return itens;
}

/**
 * Lê preços de um texto. "de R$ 3.499 por R$ 2.699" → {preco: 2699, anterior: 3499}.
 * Vários preços soltos → o menor (com "a partir de" é o mais comum em manchetes). Nenhum → null.
 */
function extrairPrecos_(texto) {
  const t = String(texto || '');
  const deP = /\bde\s+R\$\s*([\d.]+(?:,\d{1,2})?)\s+(?:por|para)\s+(?:apenas\s+|só\s+)?R\$\s*([\d.]+(?:,\d{1,2})?)/i.exec(t);
  if (deP) {
    const anterior = parseNumero_(deP[1]), preco = parseNumero_(deP[2]);
    if (preco > 0) return { preco: preco, anterior: anterior > preco ? anterior : null };
  }
  const todos = [];
  const re = /R\$\s*([\d.]+(?:,\d{1,2})?)/gi;
  let m;
  while ((m = re.exec(t)) !== null) { const n = parseNumero_(m[1]); if (n > 0) todos.push(n); }
  if (!todos.length) return null;
  return { preco: Math.min.apply(null, todos), anterior: null };
}

/** ID da loja citada no texto. Se citar mais de uma, não arrisca: devolve ''. */
function lojaNoTexto_(ctx, texto) {
  const t = normalizar_(texto);
  const achadas = Object.keys(ctx.lojas).filter(function (id) {
    const apelidos = (RADAR_APELIDOS_LOJAS[id] || []).concat([normalizar_(ctx.lojas[id].nome)]);
    return apelidos.some(function (a) { return a && contemTermo_(t, a); });
  });
  return achadas.length === 1 ? achadas[0] : '';
}

/**
 * Consulta uma URL respeitando o teto diário (LIMITE_URLFETCH_DIA). Lança erro se não for HTTP 200,
 * para a fonte ser marcada como FALHANDO (e pausada após falhas seguidas).
 */
function buscarUrl_(ctx, url, rotulo) {
  const props = PropertiesService.getScriptProperties();
  const chave = 'URLFETCH_' + Utilities.formatDate(new Date(), RADAR_FUSO, 'yyyyMMdd');
  const usadas = Number(props.getProperty(chave) || 0);
  if (usadas >= ctx.cfg.num('LIMITE_URLFETCH_DIA')) {
    throw new Error('Teto diário de consultas atingido (LIMITE_URLFETCH_DIA = ' + ctx.cfg.num('LIMITE_URLFETCH_DIA') + ').');
  }
  props.setProperty(chave, String(usadas + 1));
  const r = UrlFetchApp.fetch(url, { muteHttpExceptions: true, followRedirects: true });
  const codigo = r.getResponseCode();
  if (codigo !== 200) throw new Error((rotulo || 'consulta') + ': HTTP ' + codigo);
  return String(r.getContentText() || '');
}
