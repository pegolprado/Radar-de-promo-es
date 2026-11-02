// Teste da fonte Google Notícias (Etapa 5.2) com feed simulado.
// Uso: node testes/teste-gnews.cjs
const { criarPlanilhaFalsa, carregarProjeto, assert } = require('./simulador.cjs');

const ARQUIVOS = ['Setup.gs', 'Nucleo.gs', 'Telegram.gs', 'Menu.gs', 'Fontes.gs'];
const PROPS = { TELEGRAM_TOKEN: '123456789:AAHsegredoSegredoSegredoSegredo123', TELEGRAM_CHAT_ID: '987654321' };
const horasAtras = h => new Date(Date.now() - h * 3600000).toUTCString();

function item(titulo, origem, horas, n) {
  return `<item><title>${titulo} - ${origem}</title><link>https://news.google.com/rss/articles/ABC${n}?oc=5</link>` +
    `<pubDate>${horasAtras(horas)}</pubDate><source url="https://x.com">${origem}</source></item>`;
}
const FEEDS = {
  'Samsung Galaxy Tab S10 FE+': [
    item('Galaxy Tab S10 FE+ cai de R$ 3.499 por R$ 2.599 na Amazon', 'Olhar Digital', 3, 1),          // pista EXCELENTE (alvo 2800)
    item('Galaxy Tab S10 FE+ está mais barato na Amazon e no Mercado Livre por R$ 2.650', 'Tecmundo', 5, 2), // 2 lojas → descarta
    item('Review: Galaxy Tab S10 FE+ vale a pena?', 'Canaltech', 2, 3),                               // sem preço → ignorada
    item('Galaxy Tab S10 FE+ por R$ 2.100 na KaBuM', 'Site X', 72, 4),                                // antiga → ignorada
  ],
  'Samsung Galaxy Tab S10 FE': [
    item('Capa para Galaxy Tab S10 FE sai por R$ 49 na Shopee', 'Promo Blog', 1, 5),                   // acessório → descarta
  ],
  'Notebook Lenovo': [],
};

function novoAmbiente(extra = {}) {
  let falhar = false;
  const ss = criarPlanilhaFalsa(';');
  const P = carregarProjeto(ss, {
    arquivos: ARQUIVOS, props: PROPS,
    telegram: (url, op) => {
      if (url.includes('api.telegram.org')) return { codigo: 200, corpo: { ok: true, result: { message_id: 1 } } };
      if (url.includes('news.google.com')) {
        if (falhar) return { codigo: 503, corpoTexto: 'indisponível' };
        const q = decodeURIComponent(url.split('q=')[1].split('&')[0]);
        const nome = (q.match(/"([^"]+)"/) || [])[1];
        return { codigo: 200, corpoTexto: '<rss><channel>' + (FEEDS[nome] || []).join('') + '</channel></rss>' };
      }
      return { codigo: 404, corpoTexto: '' };
    }
  });
  P.criarEstrutura();
  P.__falhar = v => { falhar = v; };
  return P;
}
const ler = (P, aba) => { const t = P.lerTabela_(aba); return t.linhas.map(l => { const o = {}; t.cab.forEach(c => { o[c] = l.get(c); }); return o; }); };
const mensagens = P => P.__chamadas.filter(c => c.url.includes('api.telegram.org')).map(c => c.corpo.text);

let ok = 0;
function teste(nome, fn) { fn(); ok++; console.log('✔ ' + nome); }

teste('extrair preços de manchetes', () => {
  const P = novoAmbiente();
  const e = t => JSON.parse(JSON.stringify(P.extrairPrecos_(t)));
  assert.deepStrictEqual(e('cai de R$ 3.499 por R$ 2.599'), { preco: 2599, anterior: 3499 });
  assert.deepStrictEqual(e('a partir de R$ 2.299,90 na Amazon'), { preco: 2299.9, anterior: null });
  assert.deepStrictEqual(e('entre R$ 2.500 e R$ 2.300'), { preco: 2300, anterior: null });
  assert.strictEqual(P.extrairPrecos_('sem preço nenhum'), null);
});

teste('GNEWS já existe na aba FONTES e vem ativa', () => {
  const P = novoAmbiente();
  const g = ler(P, 'FONTES').find(f => f.ID === 'GNEWS');
  assert.ok(g && g.Ativa === true && g.Status === 'NÃO TESTADA');
});

teste('planilha antiga (sem GNEWS) recebe a fonte nova sem mexer nas outras', () => {
  const P = novoAmbiente();
  const tab = P.lerTabela_('FONTES');
  const g = tab.linhas.find(l => l.get('ID') === 'GNEWS');
  g.valores.fill(''); P.salvarLinha_(tab, g);                      // simula planilha criada antes da Etapa 5
  const m = tab.linhas.find(l => l.get('ID') === 'MANUAL'); m.set('Última mensagem', 'minha nota'); P.salvarLinha_(tab, m);
  const rel = P.criarEstrutura();
  assert.ok(rel.includes('FONTES: já estava correta (nada alterado) + nova(s): GNEWS'), rel);
  assert.ok(ler(P, 'FONTES').some(f => f.ID === 'GNEWS'));
  assert.strictEqual(ler(P, 'FONTES').find(f => f.ID === 'MANUAL')['Última mensagem'], 'minha nota');
  assert.ok(!P.criarEstrutura().includes('nova(s)'), 'não duplica');
});

teste('coleta: pista EXCELENTE com aviso de não verificado; descartes corretos; nada entra no histórico', () => {
  const P = novoAmbiente();
  const r = P.executarRadar();
  const of = ler(P, 'OFERTAS');
  assert.strictEqual(of.length, 3, JSON.stringify(of.map(o => o['Título original'])));
  const boa = of.find(o => o['Título original'].includes('R$ 2.599'));
  assert.strictEqual(boa['Classificação'], 'EXCELENTE');
  assert.strictEqual(boa.Fonte, 'GNEWS'); assert.strictEqual(boa.Loja, 'amazon'); assert.strictEqual(boa['ID do produto'], 'P002');
  assert.strictEqual(boa['Preço (R$)'], 2599); assert.strictEqual(boa['Preço anunciado pela loja (R$)'], 3499);
  assert.ok(/^Pista: preço citado em notícia \(Olhar Digital\), não verificado na loja/.test(boa.Motivo), boa.Motivo);
  assert.ok(String(boa.Notificado).startsWith('SIM'));
  const duas = of.find(o => o['Título original'].includes('Mercado Livre'));
  assert.strictEqual(duas['Classificação'], 'DESCARTADA'); assert.ok(/não cita uma loja cadastrada/.test(duas.Motivo), duas.Motivo);
  const capa = of.find(o => o['Título original'].includes('Capa'));
  assert.strictEqual(capa['Classificação'], 'DESCARTADA');
  assert.strictEqual(ler(P, 'HISTORICO_PRECOS').length, 0, 'pista nunca vira histórico');
  const m = mensagens(P);
  assert.strictEqual(m.length, 1);
  ['📰 <b>PISTA DE PROMOÇÃO (EXCELENTE)</b>', 'não verificado na loja. Confira antes de comprar', 'Preço citado:</b> R$ 2.599,00',
    'Manchete:', 'LER A NOTÍCIA', 'Publicada em:', 'Amazon Brasil', 'https://news.google.com/rss/articles/ABC1?oc=5']
    .forEach(t => assert.ok(m[0].includes(t), 'sem: ' + t + '\n' + m[0]));
  const n = ler(P, 'NOTIFICACOES').find(x => x.Status === 'ENVIADO');
  assert.strictEqual(n.Tipo, 'PISTA');
  const f = ler(P, 'FONTES').find(x => x.ID === 'GNEWS');
  assert.strictEqual(f.Status, 'OK'); assert.strictEqual(f['Itens na última coleta'], 3);
  assert.ok(ler(P, 'LOGS').some(l => /3 produto\(s\) pesquisado\(s\): 5 notícia\(s\), 3 com preço no título, 1 sem preço, 1 antiga/.test(l.Mensagem)));
  assert.strictEqual(ler(P, 'LOJAS').find(l => l.ID === 'amazon').Status, 'SÓ PISTAS (GNEWS) + MANUAL');
  assert.ok(r.includes('3 oferta(s) coletada(s)'), r);
});

teste('segunda execução: as mesmas notícias são ignoradas (nada repetido no Telegram nem na planilha)', () => {
  const P = novoAmbiente();
  P.executarRadar();
  const r2 = P.executarRadar();
  assert.ok(r2.includes('Duplicadas ignoradas: 3'), r2);
  assert.strictEqual(ler(P, 'OFERTAS').length, 3);
  assert.strictEqual(mensagens(P).length, 1);
});

teste('pista não bloqueia alerta real da loja (mesmo produto e loja, mesmo preço)', () => {
  const P = novoAmbiente();
  P.executarRadar();
  const tab = P.lerTabela_('OFERTAS');
  const l = P.criarLinha_(new Array(tab.cab.length).fill(''), 0, tab.idx);
  l.set('ID do produto', 'P002'); l.set('Preço (R$)', 2599); l.set('Link', 'https://www.amazon.com.br/dp/REAL');
  P.acrescentarValores_(tab, [l.valores]);
  P.executarRadar();
  const real = ler(P, 'OFERTAS').find(o => o.Link.includes('/dp/REAL'));
  assert.ok(String(real.Notificado).startsWith('SIM'), real.Notificado);
  assert.ok(mensagens(P)[1].includes('PROMOÇÃO EXCELENTE ENCONTRADA'));
  assert.strictEqual(ler(P, 'HISTORICO_PRECOS').length, 1, 'só o preço visto na loja entra no histórico');
});

teste('Google Notícias fora do ar: fonte FALHANDO, resto do radar continua', () => {
  const P = novoAmbiente();
  P.__falhar(true);
  const tab = P.lerTabela_('OFERTAS');
  const l = P.criarLinha_(new Array(tab.cab.length).fill(''), 0, tab.idx);
  l.set('ID do produto', 'P002'); l.set('Preço (R$)', 2500); l.set('Link', 'https://www.kabum.com.br/x');
  P.acrescentarValores_(tab, [l.valores]);
  P.executarRadar();
  assert.strictEqual(ler(P, 'FONTES').find(x => x.ID === 'GNEWS').Status, 'FALHANDO');
  assert.ok(String(ler(P, 'OFERTAS')[0].Notificado).startsWith('SIM'));
});

teste('teto diário de consultas (LIMITE_URLFETCH_DIA) é respeitado', () => {
  const P = novoAmbiente();
  const tab = P.lerTabela_('CONFIGURACOES');
  const l = tab.linhas.find(x => x.get('Chave') === 'LIMITE_URLFETCH_DIA'); l.set('Valor', 2); P.salvarLinha_(tab, l);
  P.executarRadar();
  const consultas = P.__chamadas.filter(c => c.url.includes('news.google.com')).length;
  assert.strictEqual(consultas, 2);
  assert.ok(/Teto diário/.test(ler(P, 'FONTES').find(x => x.ID === 'GNEWS')['Última mensagem']));
});

console.log(`\n${ok} testes passaram.`);
