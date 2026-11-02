/**
 * RADAR INTELIGENTE DE PROMOÇÕES — Menu.gs
 * Cria o menu "📡 Radar" na planilha e as ações de teste.
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('📡 Radar')
    .addItem('🔎 Verificar ofertas agora', 'menuVerificarAgora')
    .addItem('📨 Testar Telegram', 'menuTestarTelegram')
    .addSeparator()
    .addItem('🧪 Inserir oferta de demonstração', 'menuOfertaDemonstracao')
    .addItem('🩺 Diagnosticar fontes', 'diagnosticarFontes')
    .addItem('🧱 Criar/verificar estrutura', 'criarEstrutura')
    .addToUi();
}

function menuVerificarAgora() {
  avisar_(executarRadar('manual'));
}

function menuTestarTelegram() {
  try { avisar_(testarTelegram()); } catch (e) { avisar_('❌ ' + mensagemErro_(e)); }
}

/**
 * Insere na aba OFERTAS uma oferta FICTÍCIA (Fonte = DEMO): Galaxy Tab S10 FE+ por R$ 2.699, abaixo do alvo.
 * Serve para ver o fluxo completo (classificação → Telegram → registros).
 * Ofertas DEMO não entram no histórico de preços e não bloqueiam alertas reais (antiduplicidade).
 */
function menuOfertaDemonstracao() {
  const tab = lerTabela_('OFERTAS');
  const l = criarLinha_(new Array(tab.cab.length).fill(''), 0, tab.idx);
  l.set('Fonte', 'DEMO');
  l.set('ID do produto', 'P002');
  l.set('Título original', 'DEMONSTRAÇÃO — Samsung Galaxy Tab S10 FE+ 128GB (oferta fictícia)');
  l.set('Preço (R$)', 2699);
  l.set('Preço anunciado pela loja (R$)', 3499);
  l.set('Link', 'https://www.amazon.com.br/s?k=galaxy+tab+s10+fe%2B');
  acrescentarValores_(tab, [l.valores]);
  avisar_('Oferta de demonstração inserida na aba OFERTAS. Agora use 📡 Radar > Verificar ofertas agora.');
}

function avisar_(texto) {
  console.log(texto);
  try { SpreadsheetApp.getUi().alert(texto); } catch (e) { /* executado pelo editor */ }
}
