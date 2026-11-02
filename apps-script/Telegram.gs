/**
 * RADAR INTELIGENTE DE PROMOÇÕES — Telegram.gs
 * Envio de mensagens pela Telegram Bot API oficial (https://core.telegram.org/bots/api#sendmessage).
 *
 * O token e o chat ficam nas PROPRIEDADES DO SCRIPT (nunca no código nem na planilha):
 *   Configurações do projeto (⚙️) > Propriedades do script:
 *     TELEGRAM_TOKEN   = token do BotFather
 *     TELEGRAM_CHAT_ID = número do seu chat
 */

const TELEGRAM_LIMITE_TEXTO = 4000; // a API aceita até 4096 caracteres

function credenciaisTelegram_() {
  const p = PropertiesService.getScriptProperties();
  const token = String(p.getProperty('TELEGRAM_TOKEN') || '').trim();
  const chat = String(p.getProperty('TELEGRAM_CHAT_ID') || '').trim();
  if (!token || !chat) {
    throw new Error('Faltam as propriedades TELEGRAM_TOKEN e/ou TELEGRAM_CHAT_ID. ' +
      'Cadastre em: Apps Script > Configurações do projeto (⚙️) > Propriedades do script.');
  }
  if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(token)) {
    throw new Error('TELEGRAM_TOKEN com formato inválido (esperado algo como 123456789:ABC...). Confira se não sobrou espaço ou aspas.');
  }
  if (!/^-?\d+$/.test(chat)) {
    throw new Error('TELEGRAM_CHAT_ID deve conter apenas números (pode começar com -). ' + diagnosticarChatId_(chat, token));
  }
  return { token: token, chat: chat };
}

/** Explica o que há de errado no CHAT_ID sem mostrar o valor. */
function diagnosticarChatId_(chat, token) {
  if (/["'{}]/.test(chat)) return 'O valor tem aspas ou chaves. Copie só o número, sem "chat":{"id": e sem vírgula.';
  if (/^\d+:/.test(chat)) return 'O valor tem ":" — parece um TOKEN. Os valores de TELEGRAM_TOKEN e TELEGRAM_CHAT_ID podem estar trocados.';
  if (/^@|^[a-z_][a-z0-9_]*bot$/i.test(chat)) return 'O valor parece um nome de usuário (@...). Use o número do campo "chat":{"id": ...}.';
  if (/\s/.test(chat)) return 'O valor tem espaço ou quebra de linha no meio. Apague e digite só os números.';
  if (/[.,]/.test(chat)) return 'O valor tem ponto ou vírgula. Copie só os dígitos.';
  return 'O valor tem letras ou símbolos. Copie só os dígitos do campo "chat":{"id": ...}.';
}

/**
 * Envia uma mensagem HTML. Tenta até 3 vezes em erro temporário (rede, 429, 5xx).
 * @return {{ok:boolean, id:(number|undefined), tentativas:number, resposta:string}}
 *         O texto de erro nunca contém o token.
 */
function enviarTelegram_(html) {
  const c = credenciaisTelegram_();
  let texto = String(html);
  if (texto.length > TELEGRAM_LIMITE_TEXTO) texto = texto.slice(0, TELEGRAM_LIMITE_TEXTO - 20) + '\n…(cortado)';

  const url = 'https://api.telegram.org/bot' + c.token + '/sendMessage';
  const opcoes = {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ chat_id: c.chat, text: texto, parse_mode: 'HTML', disable_web_page_preview: false }),
    muteHttpExceptions: true
  };

  let tentativas = 0, erro = '';
  while (tentativas < 3) {
    tentativas++;
    try {
      const r = UrlFetchApp.fetch(url, opcoes);
      const codigo = r.getResponseCode();
      let json = {};
      try { json = JSON.parse(r.getContentText()); } catch (e) { /* resposta não-JSON */ }
      if (codigo === 200 && json.ok) {
        return { ok: true, id: json.result && json.result.message_id, tentativas: tentativas, resposta: 'ok' };
      }
      erro = 'HTTP ' + codigo + ': ' + (json.description || String(r.getContentText()).slice(0, 200));
      if (codigo === 429) {
        const espera = Math.min(((json.parameters && json.parameters.retry_after) || 2), 20);
        Utilities.sleep(espera * 1000);
        continue;
      }
      if (codigo >= 500) { Utilities.sleep(1000 * Math.pow(2, tentativas - 1)); continue; }
      break; // 400/401/403/404: erro de configuração, repetir não resolve
    } catch (e) {
      erro = String((e && e.message) || e);
      Utilities.sleep(1000 * Math.pow(2, tentativas - 1));
    }
  }
  return { ok: false, tentativas: tentativas, resposta: explicarErroTelegram_(ocultar_(erro, c.token)) };
}

function explicarErroTelegram_(erro) {
  if (/HTTP 401/.test(erro)) return erro + ' → token inválido ou revogado. Confira TELEGRAM_TOKEN.';
  if (/chat not found/i.test(erro)) return erro + ' → TELEGRAM_CHAT_ID errado ou você ainda não tocou em Iniciar no bot.';
  if (/bot was blocked/i.test(erro)) return erro + ' → você bloqueou o bot no Telegram. Desbloqueie e tente de novo.';
  if (/can't parse entities/i.test(erro)) return erro + ' → problema de formatação da mensagem (avise o desenvolvedor).';
  return erro;
}

function ocultar_(texto, segredo) {
  return segredo ? String(texto).split(segredo).join('***') : String(texto);
}

/**
 * TESTE: envia uma mensagem de verificação e registra na aba NOTIFICACOES.
 * Rode pelo editor (função testarTelegram) ou pelo menu 📡 Radar > Testar Telegram.
 */
function testarTelegram() {
  const agora = new Date();
  const html = '✅ <b>RADAR DE PROMOÇÕES — teste de conexão</b>\n\n' +
    'Se você recebeu esta mensagem, o Apps Script está falando com o seu bot.\n\n' +
    '⏰ ' + Utilities.formatDate(agora, RADAR_FUSO, 'dd/MM/yyyy HH:mm') + '\n' +
    '🔗 <a href="https://core.telegram.org/bots/api">Link de teste (deve ser clicável)</a>';
  const r = enviarTelegram_(html);
  const ctx = { logs: [] };
  try {
    const tab = lerTabela_('NOTIFICACOES');
    registrarNotificacao_({ tabNotificacoes: tab }, {
      tipo: 'TESTE', produto: 'Teste de conexão', ok: r.ok, tentativas: r.tentativas, resposta: r.resposta, idMensagem: r.id
    });
    log_(ctx, r.ok ? 'INFO' : 'ERRO', 'telegram', r.ok ? 'Teste de conexão enviado' : 'Teste de conexão falhou', r.resposta);
    gravarLogs_(ctx);
  } catch (e) { console.log('Não foi possível registrar na planilha: ' + e); }

  if (!r.ok) throw new Error('Telegram NÃO respondeu OK: ' + r.resposta);
  const msg = 'Telegram OK: mensagem enviada (id ' + r.id + ', ' + r.tentativas + ' tentativa(s)). Confira o seu Telegram.';
  console.log(msg);
  return msg;
}
