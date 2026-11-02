// Teste do diagnóstico de fontes (Etapa 5.1) com respostas simuladas.
// Uso: node testes/teste-fontes.cjs
const { criarPlanilhaFalsa, carregarProjeto, assert } = require('./simulador.cjs');

const respostas = (url) => {
  if (url.includes('news.google.com')) return { codigo: 200, corpo: null, texto: '<rss><channel><item><title><![CDATA[Notebook em promoção por R$ 2.999]]></title></item><item><title>Outra</title></item></channel></rss>' };
  if (url.includes('promobit')) return { codigo: 200, texto: '<!doctype html><html><body>site</body></html>' };
  if (url.includes('pelando')) return { codigo: 404, texto: 'not found' };
  if (url.includes('gatry')) return { excecao: 'DNS error' };
  if (url.includes('hardmob')) return { codigo: 200, texto: '<?xml version="1.0"?><feed><entry><title>[KaBuM] SSD 1TB R$ 399</title></entry></feed>' };
  if (url.endsWith('/sites/MLB')) return { codigo: 200, texto: JSON.stringify({ id: 'MLB', name: 'Brasil' }) };
  if (url.includes('/search')) return { codigo: 403, texto: JSON.stringify({ message: 'forbidden' }) };
  return { codigo: 500, texto: '' };
};

const ss = criarPlanilhaFalsa(';');
const P = carregarProjeto(ss, {
  arquivos: ['Setup.gs', 'Nucleo.gs', 'Telegram.gs', 'Menu.gs', 'Fontes.gs'],
  telegram: (url) => { const r = respostas(url); return r.excecao ? r : { codigo: r.codigo, corpoTexto: r.texto }; }
});
P.criarEstrutura();
const t = P.diagnosticarFontes();
console.log(t);
assert.ok(/✅ Google Notícias.*feed OK, 2 itens, 1 com preço/.test(t));
assert.ok(/⚠️ Promobit.*não é um feed.*HTML/.test(t));
assert.ok(/❌ Pelando.*HTTP 404/.test(t));
assert.ok(/❌ Gatry.*sem resposta/.test(t));
assert.ok(/✅ Hardmob.*1 itens, 1 com preço.*\[KaBuM\] SSD/.test(t));
assert.ok(/✅ Mercado Livre – API \(site MLB\): respondeu \(site MLB – Brasil\)/.test(t));
assert.ok(/❌ Mercado Livre – busca pública: HTTP 403 \(forbidden\)/.test(t));
assert.ok(/➖ Mercado Livre – anúncio por ID: não testado/.test(t));
const logs = P.lerTabela_('LOGS').linhas.length;
assert.strictEqual(logs, 7);
console.log('\n✔ diagnóstico de fontes: 8 verificações');
