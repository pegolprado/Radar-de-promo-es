// Teste da conexão e do diagnóstico do Mercado Livre (Etapa 5.3, parte 1) com API simulada.
// Uso: node testes/teste-ml.cjs
const { criarPlanilhaFalsa, carregarProjeto, assert } = require('./simulador.cjs');

const ARQUIVOS = ['Setup.gs', 'Nucleo.gs', 'Telegram.gs', 'Menu.gs', 'Fontes.gs', 'MercadoLivre.gs'];
const SECRET = 'segredoDoAppMLxyz';
const BASE = { ML_APP_ID: '1234567890123456', ML_CLIENT_SECRET: SECRET, ML_REDIRECT_URI: 'https://www.google.com/' };

function ambiente(props, api) {
  const ss = criarPlanilhaFalsa(';');
  const P = carregarProjeto(ss, { arquivos: ARQUIVOS, props, telegram: api });
  P.criarEstrutura();
  return P;
}
const tokenOk = (n) => ({ codigo: 200, corpo: { access_token: 'APP_USR-acesso-' + n, refresh_token: 'TG-refresh-' + n, expires_in: 21600, user_id: 555 } });

let ok = 0;
function teste(nome, fn) { fn(); ok++; console.log('✔ ' + nome); }

teste('extrai IDs de links do Mercado Livre', () => {
  const P = ambiente(BASE);
  const r = JSON.parse(JSON.stringify(P.idsMercadoLivre_(
    'https://www.mercadolivre.com.br/samsung-galaxy-tab-s10-fe/p/MLB41234567?pdp_filters=x, ' +
    'https://produto.mercadolivre.com.br/MLB-4012345678-tablet-samsung-_JM, MLB5555555555, https://www.kabum.com.br/produto/1')));
  assert.deepStrictEqual(r, [
    { tipo: 'produto', id: 'MLB41234567' }, { tipo: 'item', id: 'MLB4012345678' }, { tipo: 'item', id: 'MLB5555555555' }]);
});

teste('sem credenciais: erro claro dizendo quais propriedades faltam', () => {
  const P = ambiente({});
  assert.throws(() => P.linkAutorizacaoML_(), /ML_APP_ID, ML_CLIENT_SECRET, ML_REDIRECT_URI/);
});

teste('link de autorização usa o domínio oficial e o redirect cadastrado', () => {
  const P = ambiente(BASE);
  assert.strictEqual(P.linkAutorizacaoML_(),
    'https://auth.mercadolivre.com.br/authorization?response_type=code&client_id=1234567890123456&redirect_uri=https%3A%2F%2Fwww.google.com%2F');
});

teste('troca do código: aceita o endereço inteiro colado, guarda os tokens e não os devolve', () => {
  const P = ambiente(BASE, (url, op) => url.endsWith('/oauth/token') ? tokenOk(1) : { codigo: 404, corpo: {} });
  const msg = P.trocarCodigoML('https://www.google.com/?code=TG-abc123-555&state=');
  assert.ok(msg.includes('Conectado (usuário 555)'), msg);
  assert.ok(!msg.includes('APP_USR'));
  const chamada = P.__chamadas[0];
  assert.strictEqual(chamada.opcoes.payload.grant_type, 'authorization_code');
  assert.strictEqual(chamada.opcoes.payload.code, 'TG-abc123-555');
  assert.strictEqual(chamada.opcoes.payload.redirect_uri, 'https://www.google.com/');
  assert.strictEqual(P.__props.ML_ACCESS_TOKEN, 'APP_USR-acesso-1');
  assert.strictEqual(P.__props.ML_REFRESH_TOKEN, 'TG-refresh-1');
});

teste('código recusado: mensagem explica e não expõe o secret', () => {
  const P = ambiente(BASE, () => ({ codigo: 400, corpo: { error: 'invalid_grant', message: 'Error validating grant ' + SECRET } }));
  assert.throws(() => P.trocarCodigoML('TG-velho'), e => /HTTP 400/.test(e.message) && /gere outro/.test(e.message) && !e.message.includes(SECRET));
});

teste('token vencido é renovado sozinho e o novo refresh token é guardado', () => {
  const props = Object.assign({}, BASE, { ML_ACCESS_TOKEN: 'velho', ML_REFRESH_TOKEN: 'TG-refresh-0', ML_TOKEN_EXPIRA: String(Date.now() - 1000) });
  const P = ambiente(props, (url) => url.endsWith('/oauth/token') ? tokenOk(2) : { codigo: 200, corpo: { id: 555, nickname: 'EU' } });
  const r = P.apiML_('/users/me');
  assert.strictEqual(r.codigo, 200);
  const renovar = P.__chamadas[0];
  assert.strictEqual(renovar.opcoes.payload.grant_type, 'refresh_token');
  assert.strictEqual(renovar.opcoes.payload.refresh_token, 'TG-refresh-0');
  assert.strictEqual(P.__chamadas[1].opcoes.headers.Authorization, 'Bearer APP_USR-acesso-2');
  assert.strictEqual(P.__props.ML_REFRESH_TOKEN, 'TG-refresh-2');
});

teste('diagnóstico: mostra o que funciona e o que é bloqueado, usando os links da aba PRODUTOS', () => {
  const props = Object.assign({}, BASE, { ML_ACCESS_TOKEN: 'APP_USR-ok', ML_REFRESH_TOKEN: 'TG-r', ML_TOKEN_EXPIRA: String(Date.now() + 3600000) });
  const P = ambiente(props, (url) => {
    if (url.includes('/users/me')) return { codigo: 200, corpo: { id: 555, nickname: 'MARCOS' } };
    if (url.includes('/sites/MLB/search')) return { codigo: 403, corpo: { message: 'forbidden' } };
    if (url.includes('/items/MLB4012345678')) return { codigo: 200, corpo: { id: 'MLB4012345678', title: 'Tablet Samsung Galaxy Tab S10 FE+', price: 2799, status: 'active' } };
    if (url.includes('/products/MLB41234567')) return { codigo: 200, corpo: { id: 'MLB41234567', name: 'Samsung Galaxy Tab S10 FE', buy_box_winner: { price: 2349.9 } } };
    return { codigo: 404, corpo: { message: 'not_found' } };
  });
  const tab = P.lerTabela_('PRODUTOS');
  const l = tab.linhas.find(x => x.get('ID') === 'P002');
  l.set('Links ou IDs monitorados', 'https://produto.mercadolivre.com.br/MLB-4012345678-tablet, https://www.mercadolivre.com.br/x/p/MLB41234567');
  P.salvarLinha_(tab, l);
  const t = P.diagnosticarMercadoLivre();
  assert.ok(/✅ Acesso \(users\/me\): HTTP 200 — conta MARCOS/.test(t), t);
  assert.ok(/❌ Busca por palavra \(com acesso\): HTTP 403/.test(t), t);
  assert.ok(/✅ Anúncio MLB4012345678: HTTP 200 — "Tablet Samsung Galaxy Tab S10 FE\+" R\$ 2\.799,00, status active/.test(t), t);
  assert.ok(/✅ Produto de catálogo MLB41234567: HTTP 200 — "Samsung Galaxy Tab S10 FE", melhor oferta R\$ 2\.349,90/.test(t), t);
  assert.ok(!t.includes('APP_USR'));
  console.log('\n' + t + '\n');
});

teste('diagnóstico sem conexão: explica como conectar', () => {
  const P = ambiente(BASE);
  const t = P.diagnosticarMercadoLivre();
  assert.ok(/❌ Acesso: Mercado Livre não conectado/.test(t), t);
});

console.log(`${ok} testes passaram.`);
