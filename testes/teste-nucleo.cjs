// Teste do fluxo completo (Etapa 4) com planilha e Telegram simulados.
// Uso: node testes/teste-nucleo.cjs
const { criarPlanilhaFalsa, carregarProjeto, assert } = require('./simulador.cjs');

const ARQUIVOS = ['Setup.gs', 'Nucleo.gs', 'Telegram.gs', 'Menu.gs'];
const TOKEN = '123456789:AAHsegredoSegredoSegredoSegredo123';
const PROPS = { TELEGRAM_TOKEN: TOKEN, TELEGRAM_CHAT_ID: '987654321' };

let ok = 0;
function teste(nome, fn) { fn(); ok++; console.log('✔ ' + nome); }

function novoAmbiente(opcoes = {}) {
  const ss = criarPlanilhaFalsa(';');
  const P = carregarProjeto(ss, Object.assign({ arquivos: ARQUIVOS, props: PROPS }, opcoes));
  P.criarEstrutura();
  return { ss, P };
}
function inserir(P, aba, objetos) {
  const tab = P.lerTabela_(aba);
  const linhas = objetos.map(o => { const l = P.criarLinha_(new Array(tab.cab.length).fill(''), 0, tab.idx); Object.keys(o).forEach(k => l.set(k, o[k])); return l.valores; });
  P.acrescentarValores_(tab, linhas);
}
function ler(P, aba) {
  const tab = P.lerTabela_(aba);
  return tab.linhas.map(l => { const o = { _linha: l.numero }; tab.cab.forEach(c => { o[c] = l.get(c); }); return o; });
}
function config(P, chave, valor) {
  const tab = P.lerTabela_('CONFIGURACOES');
  const l = tab.linhas.find(x => x.get('Chave') === chave);
  l.set('Valor', valor); P.salvarLinha_(tab, l);
}
function diasAtras(n) { return new Date(Date.now() - n * 86400000); }
const mensagens = P => P.__chamadas.filter(c => c.url.includes('/sendMessage')).map(c => c.corpo.text);

/* ----------------------------------------------------------------------------------------- */

teste('testarTelegram: chama a API oficial com HTML e registra TESTE/ENVIADO', () => {
  const { P } = novoAmbiente();
  const r = P.testarTelegram();
  assert.ok(r.startsWith('Telegram OK'));
  const c = P.__chamadas[0];
  assert.strictEqual(c.url, 'https://api.telegram.org/bot' + TOKEN + '/sendMessage');
  assert.strictEqual(c.corpo.chat_id, '987654321');
  assert.strictEqual(c.corpo.parse_mode, 'HTML');
  const n = ler(P, 'NOTIFICACOES');
  assert.strictEqual(n.length, 1);
  assert.strictEqual(n[0].Tipo, 'TESTE'); assert.strictEqual(n[0].Status, 'ENVIADO');
});

teste('sem token: erro claro explicando onde cadastrar', () => {
  const ss = criarPlanilhaFalsa(';');
  const P = carregarProjeto(ss, { arquivos: ARQUIVOS, props: {} });
  P.criarEstrutura();
  assert.throws(() => P.testarTelegram(), /Propriedades do script/);
});

teste('o token NUNCA aparece em erro registrado (nem quando a rede falha)', () => {
  const { P } = novoAmbiente({ telegram: (url) => ({ excecao: 'Falha de DNS ao acessar ' + url }) });
  assert.throws(() => P.testarTelegram(), e => !e.message.includes(TOKEN) && e.message.includes('***'));
  const n = ler(P, 'NOTIFICACOES')[0];
  assert.strictEqual(n.Status, 'FALHOU'); assert.strictEqual(n.Tentativas, 3);
  assert.ok(!JSON.stringify(ler(P, 'NOTIFICACOES')).includes(TOKEN));
  assert.ok(!JSON.stringify(ler(P, 'LOGS')).includes(TOKEN));
});

teste('erro 401 do Telegram é explicado em português e não é repetido 3 vezes', () => {
  const { P } = novoAmbiente({ telegram: () => ({ codigo: 401, corpo: { ok: false, description: 'Unauthorized' } }) });
  assert.throws(() => P.testarTelegram(), /token inválido/);
  assert.strictEqual(P.__chamadas.length, 1);
});

teste('lançamento manual pelo TÍTULO: reconhece S10 FE+ (não S10 FE), EXCELENTE por atingir o alvo, envia ao Telegram', () => {
  const { P } = novoAmbiente();
  inserir(P, 'OFERTAS', [{ 'Título original': 'Tablet Samsung Galaxy Tab S10 FE+ 128GB Wi-Fi Cinza', 'Preço (R$)': 2699, 'Preço anunciado pela loja (R$)': 3499, 'Link': 'https://www.kabum.com.br/produto/123' }]);
  const resumo = P.executarRadar();
  const o = ler(P, 'OFERTAS')[0];
  assert.strictEqual(o._linha, 2, 'a oferta deve ficar na linha 2');
  assert.strictEqual(o['ID do produto'], 'P002');
  assert.strictEqual(o.Loja, 'kabum', 'loja deduzida pelo domínio do link');
  assert.strictEqual(o.Fonte, 'MANUAL');
  assert.strictEqual(o['Classificação'], 'EXCELENTE');
  assert.ok(/Atingiu seu preço-alvo \(R\$ 2\.800,00\)/.test(o.Motivo), o.Motivo);
  assert.ok(/histórico ainda insuficiente \(0 de 5/.test(o.Motivo), o.Motivo);
  assert.ok(o.Motivo.includes('desconto anunciado de 22,86% não verificável'), o.Motivo);
  assert.ok(String(o.Notificado).startsWith('SIM'));
  const m = mensagens(P)[0];
  ['[TESTE]', 'PROMOÇÃO EXCELENTE ENCONTRADA', 'Samsung Galaxy Tab S10 FE+', 'R$ 2.699,00', 'R$ 2.800,00 ✅ atingido',
    'histórico ainda insuficiente', '22,86%', 'KaBuM!', 'verificar no checkout', '<a href="https://www.kabum.com.br/produto/123">', 'Verificado em:']
    .forEach(t => assert.ok(m.includes(t), 'mensagem sem: ' + t + '\n' + m));
  assert.ok(resumo.includes('EXCELENTES: 1'), resumo);
  const h = ler(P, 'HISTORICO_PRECOS');
  assert.strictEqual(h.length, 1); assert.strictEqual(h[0]['Preço (R$)'], 2699);
  const prod = ler(P, 'PRODUTOS').find(p => p.ID === 'P002');
  assert.strictEqual(prod['Último preço (R$)'], 2699); assert.strictEqual(prod['Loja do último preço'], 'KaBuM!');
  const n = ler(P, 'NOTIFICACOES')[0];
  assert.strictEqual(n.Tipo, 'ALERTA'); assert.strictEqual(n.Status, 'ENVIADO'); assert.strictEqual(n['ID do produto'], 'P002');
});

teste('descartes com motivo: acessório, preço-isca, domínio falso, http, loja errada, sem preço', () => {
  const { P } = novoAmbiente();
  inserir(P, 'OFERTAS', [
    { 'Título original': 'Capa Case para Galaxy Tab S10 FE 10.9', 'Preço (R$)': 89, 'Link': 'https://www.amazon.com.br/dp/X' },
    { 'ID do produto': 'P001', 'Preço (R$)': 900, 'Link': 'https://www.amazon.com.br/dp/Y' },
    { 'ID do produto': 'P001', 'Preço (R$)': 2000, 'Link': 'https://kabum.com.br.promocao-falsa.com/tab' },
    { 'ID do produto': 'P001', 'Preço (R$)': 2000, 'Link': 'http://www.kabum.com.br/tab' },
    { 'ID do produto': 'P001', 'Loja': 'kabum', 'Preço (R$)': 2000, 'Link': 'https://www.amazon.com.br/dp/Z' },
    { 'ID do produto': 'P001', 'Link': 'https://www.amazon.com.br/dp/W' },
    { 'Título original': 'Fone Bluetooth JBL', 'Preço (R$)': 199, 'Link': 'https://www.amazon.com.br/dp/V' },
  ]);
  P.executarRadar();
  const o = ler(P, 'OFERTAS');
  assert.ok(o.every(x => x['Classificação'] === 'DESCARTADA'), JSON.stringify(o.map(x => x['Classificação'])));
  assert.ok(/palavra proibida: "capa"/.test(o[0].Motivo), o[0].Motivo);
  assert.ok(/preço mínimo plausível/.test(o[1].Motivo), o[1].Motivo);
  assert.ok(/não pertence a nenhuma loja/.test(o[2].Motivo), o[2].Motivo);
  assert.ok(/https:\/\//.test(o[3].Motivo), o[3].Motivo);
  assert.ok(/não pertence aos domínios oficiais de KaBuM!/.test(o[4].Motivo), o[4].Motivo);
  assert.ok(/Preço ausente/.test(o[5].Motivo), o[5].Motivo);
  assert.ok(/Não corresponde a nenhum produto ativo/.test(o[6].Motivo), o[6].Motivo);
  assert.strictEqual(mensagens(P).length, 0, 'nada deve ir ao Telegram');
  assert.strictEqual(ler(P, 'HISTORICO_PRECOS').length, 0, 'ofertas inválidas não entram no histórico');
});

teste('antiduplicidade: mesmo produto/loja não repete alerta; nova queda de 3%+ gera novo alerta', () => {
  const { P } = novoAmbiente();
  inserir(P, 'OFERTAS', [{ 'ID do produto': 'P002', 'Preço (R$)': 2699, 'Link': 'https://www.kabum.com.br/a' }]);
  P.executarRadar();
  inserir(P, 'OFERTAS', [{ 'ID do produto': 'P002', 'Preço (R$)': 2690, 'Link': 'https://www.kabum.com.br/a' }]);
  P.executarRadar();
  inserir(P, 'OFERTAS', [{ 'ID do produto': 'P002', 'Preço (R$)': 2600, 'Link': 'https://www.kabum.com.br/a' }]);
  P.executarRadar();
  const o = ler(P, 'OFERTAS');
  assert.ok(String(o[0].Notificado).startsWith('SIM'));
  assert.ok(/^NÃO — já avisado em .* por R\$ 2\.699,00$/.test(o[1].Notificado), o[1].Notificado);
  assert.ok(String(o[2].Notificado).startsWith('SIM'), o[2].Notificado);
  assert.strictEqual(mensagens(P).length, 2);
});

teste('histórico próprio: EXCELENTE por desconto real, BOA, preço normal e desconto falso', () => {
  const { P } = novoAmbiente();
  // 6 preços reais do P001 na Amazon nos últimos dias (mediana R$ 2.500)
  inserir(P, 'HISTORICO_PRECOS', [2450, 2480, 2500, 2500, 2520, 2550].map((p, i) => ({ 'Data/hora': diasAtras(i + 1), 'ID do produto': 'P001', 'Produto': 'Samsung Galaxy Tab S10 FE', 'Loja': 'amazon', 'Preço (R$)': p, 'Fonte': 'MANUAL' })));
  // P001 alvo = 2300; desligo o alvo para testar o critério de histórico puro
  const tab = P.lerTabela_('PRODUTOS'); const l = tab.linhas.find(x => x.get('ID') === 'P001'); l.set('Preço-alvo (R$)', ''); P.salvarLinha_(tab, l);
  inserir(P, 'OFERTAS', [
    { 'ID do produto': 'P001', 'Preço (R$)': 2100, 'Link': 'https://www.amazon.com.br/dp/1' },                                       // -16% → EXCELENTE
    { 'ID do produto': 'P001', 'Preço (R$)': 2350, 'Link': 'https://www.magazineluiza.com.br/p/2' },                                  // -6%  → BOA
    { 'ID do produto': 'P001', 'Preço (R$)': 2480, 'Link': 'https://www.casasbahia.com.br/p/3' },                                     // -0,8% → DESCARTADA
    { 'ID do produto': 'P001', 'Preço (R$)': 2499, 'Preço anunciado pela loja (R$)': 4000, 'Link': 'https://shopee.com.br/p/4' },    // "37% off" falso
  ]);
  P.executarRadar();
  const o = ler(P, 'OFERTAS');
  assert.strictEqual(o[0]['Classificação'], 'EXCELENTE', o[0].Motivo);
  assert.strictEqual(o[0]['Mediana de referência (R$)'], 2500);
  assert.strictEqual(o[0]['Diferença vs. mediana (%)'], -16);
  assert.ok(/16,00% abaixo da mediana de 6 preços/.test(o[0].Motivo), o[0].Motivo);
  assert.strictEqual(o[1]['Classificação'], 'BOA', o[1].Motivo);
  assert.strictEqual(o[1].Notificado, 'NÃO — vai para o resumo diário');
  assert.ok(/há preço menor em Amazon Brasil \(R\$ 2\.100,00\)/.test(o[1].Motivo), 'comparação entre lojas: ' + o[1].Motivo);
  assert.strictEqual(o[2]['Classificação'], 'DESCARTADA'); assert.ok(/^Preço normal/.test(o[2].Motivo), o[2].Motivo);
  assert.strictEqual(o[3]['Classificação'], 'DESCARTADA'); assert.ok(/desconto anunciado de 37,52% NÃO confirmado pelo histórico/.test(o[3].Motivo), o[3].Motivo);
  const m = mensagens(P);
  assert.strictEqual(m.length, 1);
  assert.ok(m[0].includes('mediana de 6 preços registrados pelo radar') && m[0].includes('16,00% abaixo'), m[0]);
  const prod = ler(P, 'PRODUTOS').find(p => p.ID === 'P001');
  assert.strictEqual(prod['Menor preço visto (R$)'], 2100);
  assert.ok(prod['Mediana do histórico (R$)'] > 0);
});

teste('histórico não infla: mesmo produto/loja/preço em menos de 12 h entra só uma vez', () => {
  const { P } = novoAmbiente();
  inserir(P, 'OFERTAS', [{ 'ID do produto': 'P003', 'Preço (R$)': 3500, 'Link': 'https://www.kabum.com.br/n' }]);
  P.executarRadar();
  inserir(P, 'OFERTAS', [{ 'ID do produto': 'P003', 'Preço (R$)': 3500, 'Link': 'https://www.kabum.com.br/n' }]);
  P.executarRadar();
  assert.strictEqual(ler(P, 'HISTORICO_PRECOS').length, 1);
});

teste('falha no Telegram: registra FALHOU e reenvia na execução seguinte', () => {
  let fora = true;
  const { P } = novoAmbiente({ telegram: () => fora ? { codigo: 502, corpo: { ok: false, description: 'Bad Gateway' } } : { codigo: 200, corpo: { ok: true, result: { message_id: 77 } } } });
  inserir(P, 'OFERTAS', [{ 'ID do produto': 'P002', 'Preço (R$)': 2500, 'Link': 'https://www.kabum.com.br/a' }]);
  P.executarRadar();
  assert.strictEqual(ler(P, 'OFERTAS')[0].Notificado, 'FALHOU');
  assert.strictEqual(P.__chamadas.length, 3, '3 tentativas para erro 5xx');
  fora = false;
  P.executarRadar();
  assert.ok(String(ler(P, 'OFERTAS')[0].Notificado).startsWith('SIM'));
  const n = ler(P, 'NOTIFICACOES').map(x => x.Status);
  assert.deepStrictEqual(Array.from(n), ['FALHOU', 'ENVIADO']);
});

teste('limite diário de alertas (MAX_ALERTAS_DIA)', () => {
  const { P } = novoAmbiente();
  config(P, 'MAX_ALERTAS_DIA', 1);
  inserir(P, 'OFERTAS', [
    { 'ID do produto': 'P002', 'Preço (R$)': 2500, 'Link': 'https://www.kabum.com.br/a' },
    { 'ID do produto': 'P003', 'Preço (R$)': 2900, 'Link': 'https://www.kabum.com.br/b' },
  ]);
  P.executarRadar();
  const o = ler(P, 'OFERTAS');
  assert.ok(String(o[0].Notificado).startsWith('SIM'));
  assert.strictEqual(o[1].Notificado, 'NÃO — limite diário de alertas atingido');
});

teste('fonte automática: sucesso marca OK, duplicada é ignorada, loja vira MONITORADA', () => {
  const { P } = novoAmbiente();
  P.coletar_GMAIL = () => [
    { titulo: 'Notebook Lenovo IdeaPad Slim 3 Ryzen 7 16GB 512GB', preco: 2899, link: 'https://www.magazineluiza.com.br/notebook/p/1' },
    { titulo: 'Mochila para Notebook Lenovo', preco: 150, link: 'https://www.magazineluiza.com.br/mochila/p/2' },
  ];
  const tab = P.lerTabela_('FONTES'); const l = tab.linhas.find(x => x.get('ID') === 'GMAIL'); l.set('Ativa', true); P.salvarLinha_(tab, l);
  P.executarRadar();
  const r2 = P.executarRadar(); // as mesmas ofertas de novo
  assert.ok(r2.includes('Duplicadas ignoradas: 2'), r2);
  const o = ler(P, 'OFERTAS');
  assert.strictEqual(o.length, 2, 'duplicadas não são gravadas de novo');
  assert.strictEqual(o[0]['Classificação'], 'EXCELENTE'); assert.strictEqual(o[0].Fonte, 'GMAIL');
  assert.strictEqual(o[1]['Classificação'], 'DESCARTADA');
  const f = ler(P, 'FONTES').find(x => x.ID === 'GMAIL');
  assert.strictEqual(f.Status, 'OK'); assert.strictEqual(f['Itens na última coleta'], 2);
  const lojas = ler(P, 'LOJAS');
  assert.strictEqual(lojas.find(x => x.ID === 'magalu').Status, 'MONITORADA (GMAIL)');
  assert.strictEqual(lojas.find(x => x.ID === 'amazon').Status, 'MONITORADA (GMAIL)');
  assert.strictEqual(ler(P, 'FONTES').find(x => x.ID === 'MANUAL').Status, 'OK');
});

teste('fonte com erro não derruba as outras; 3 falhas seguidas → INDISPONÍVEL, desativada e aviso no Telegram', () => {
  const { P } = novoAmbiente();
  P.coletar_GMAIL = () => { throw new Error('Serviço do Gmail indisponível'); };
  const tab = P.lerTabela_('FONTES'); const l = tab.linhas.find(x => x.get('ID') === 'GMAIL'); l.set('Ativa', true); P.salvarLinha_(tab, l);
  inserir(P, 'OFERTAS', [{ 'ID do produto': 'P002', 'Preço (R$)': 2500, 'Link': 'https://www.kabum.com.br/a' }]);
  P.executarRadar();
  assert.ok(String(ler(P, 'OFERTAS')[0].Notificado).startsWith('SIM'), 'o manual seguiu funcionando');
  assert.strictEqual(ler(P, 'FONTES').find(x => x.ID === 'GMAIL').Status, 'FALHANDO');
  P.executarRadar(); P.executarRadar();
  const f = ler(P, 'FONTES').find(x => x.ID === 'GMAIL');
  assert.strictEqual(f.Status, 'INDISPONÍVEL'); assert.strictEqual(f.Ativa, false); assert.strictEqual(f['Falhas seguidas'], 3);
  assert.ok(mensagens(P).some(m => m.includes('fonte pausada') && m.includes('GMAIL')));
  assert.ok(ler(P, 'LOGS').some(x => x['Nível'] === 'ERRO' && x['Módulo'] === 'fonte:GMAIL'));
});

teste('fonte ativa sem coletor instalado aparece como NÃO IMPLEMENTADA (nunca como OK)', () => {
  const { P } = novoAmbiente();
  const tab = P.lerTabela_('FONTES'); const l = tab.linhas.find(x => x.get('ID') === 'SHOPEE_API'); l.set('Ativa', true); P.salvarLinha_(tab, l);
  P.executarRadar();
  assert.strictEqual(ler(P, 'FONTES').find(x => x.ID === 'SHOPEE_API').Status, 'NÃO IMPLEMENTADA');
  assert.strictEqual(ler(P, 'LOJAS').find(x => x.ID === 'shopee').Status, 'SÓ MANUAL');
});

teste('demonstração: envia ao Telegram marcada como fictícia, sem tocar no histórico nem bloquear alertas reais', () => {
  const { P } = novoAmbiente();
  P.menuOfertaDemonstracao();
  P.executarRadar();
  const m = mensagens(P)[0];
  assert.ok(m.includes('DEMONSTRAÇÃO') && m.includes('R$ 2.699,00') && m.includes('Amazon Brasil') && m.includes('22,86%'), m);
  assert.strictEqual(ler(P, 'HISTORICO_PRECOS').length, 0);
  assert.strictEqual(ler(P, 'NOTIFICACOES')[0].Tipo, 'TESTE');
  inserir(P, 'OFERTAS', [{ 'ID do produto': 'P002', 'Preço (R$)': 2699, 'Link': 'https://www.amazon.com.br/dp/real' }]);
  P.executarRadar();
  assert.ok(String(ler(P, 'OFERTAS')[1].Notificado).startsWith('SIM'), 'alerta real não pode ser bloqueado pela demonstração');
});

teste('gatilho fora do horário não consulta nada', () => {
  const { P } = novoAmbiente();
  const h = (new Date(Date.now() - 3 * 3600000)).getUTCHours();
  config(P, 'HORA_INICIO', (h + 2) % 24); config(P, 'HORA_FIM', (h + 3) % 24);
  inserir(P, 'OFERTAS', [{ 'ID do produto': 'P002', 'Preço (R$)': 2500, 'Link': 'https://www.kabum.com.br/a' }]);
  const r = P.executarRadar('gatilho');
  assert.ok(r.startsWith('Fora do horário'), r);
  assert.strictEqual(ler(P, 'OFERTAS')[0]['Classificação'], '');
});

teste('reconhecimento de palavras: "tv" não casa "tvbox"; acentos e maiúsculas ignorados', () => {
  const { P } = novoAmbiente();
  assert.strictEqual(P.contemTermo_(P.normalizar_('Receptor TVBox 4K'), 'tv'), false);
  assert.strictEqual(P.contemTermo_(P.normalizar_('Smart TV 55" 4K'), 'tv'), true);
  assert.strictEqual(P.contemTermo_(P.normalizar_('MEMÓRIA DDR5 16GB'), 'memoria'), true);
  assert.strictEqual(P.parseNumero_('R$ 2.299,90'), 2299.9);
  assert.strictEqual(P.parseNumero_('2.299'), 2299);
  assert.strictEqual(P.reais_(1234567.5), 'R$ 1.234.567,50');
});

console.log(`\n${ok} testes passaram.`);
