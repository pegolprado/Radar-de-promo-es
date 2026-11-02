/**
 * RADAR INTELIGENTE DE PROMOÇÕES — Nucleo.gs
 * Etapa 4: o "cérebro" do radar.
 *
 *   coleta (fontes) → reconhecimento do produto → validação → classificação
 *   → antiduplicidade → Telegram → histórico → atualização da planilha
 *
 * Função principal: executarRadar(). Pelo menu da planilha: 📡 Radar > Verificar ofertas agora.
 * Depende de Setup.gs (esquema e configurações padrão) e Telegram.gs (envio).
 */

const RADAR_VERSAO_NUCLEO = '2';

/**
 * Fontes de PISTAS: o preço vem de um texto de terceiros (ex.: notícia), não da loja.
 * Pistas podem gerar alerta, mas NUNCA entram no histórico de preços e a mensagem avisa que não foram verificadas.
 * O link aponta para o domínio da própria fonte (aceito só para ela); a loja é identificada pelo texto.
 */
const RADAR_FONTES_PISTA = {
  GNEWS: { dominios: ['news.google.com'], rotulo: 'notícia' }
};

function ehPista_(fonteId) { return Object.prototype.hasOwnProperty.call(RADAR_FONTES_PISTA, String(fonteId || '')); }

/* =============================== EXECUÇÃO PRINCIPAL =============================== */

/**
 * Roda um ciclo completo do radar.
 * @param {string} origem 'manual' (menu/editor) ou 'gatilho' (agendamento automático).
 * @return {string} resumo do que aconteceu.
 */
function executarRadar(origem) {
  origem = origem === 'gatilho' ? 'gatilho' : 'manual';
  const trava = LockService.getScriptLock();
  if (!trava.tryLock(20000)) {
    console.log('Outra execução do radar ainda está em andamento. Esta foi ignorada.');
    return 'Outra execução ainda está em andamento. Tente de novo em alguns minutos.';
  }
  const ctx = { origem: origem, agora: new Date(), logs: [], seq: 0 };
  try {
    completarConfiguracoes_(planilha_()); // acrescenta chaves novas sem mexer nas suas
    ctx.cfg = lerConfig_();

    if (origem === 'gatilho' && !dentroDoHorario_(ctx)) {
      return 'Fora do horário de funcionamento (' + ctx.cfg.num('HORA_INICIO') + 'h–' + ctx.cfg.num('HORA_FIM') + 'h).';
    }

    carregarContexto_(ctx);
    const resumo = { coletadas: 0, manuais: 0, excelentes: 0, boas: 0, descartadas: 0, duplicadas: 0, enviadas: 0, falhasEnvio: 0 };

    // 1) Fontes automáticas (Etapa 5 adiciona os coletores).
    const novas = coletarDasFontes_(ctx);
    resumo.coletadas = novas.length;

    // 2) Ofertas lançadas à mão na aba OFERTAS (linhas sem classificação).
    const manuais = processarLancamentosManuais_(ctx, resumo);
    resumo.manuais = manuais;

    // 3) Ofertas novas das fontes automáticas.
    processarOfertasNovas_(ctx, novas, resumo);

    // 4) Reenvio de notificações que falharam nas últimas 24 h.
    reenviarFalhas_(ctx, resumo);

    // 5) Planilha: histórico, produtos, lojas e fontes.
    gravarHistorico_(ctx);
    atualizarProdutos_(ctx);
    atualizarStatusFonte_(ctx, 'MANUAL', true, manuais + ' lançamento(s) manual(is) processado(s).', manuais);
    atualizarStatusLojas_(ctx);

    const texto = 'Radar concluído: ' + resumo.coletadas + ' oferta(s) coletada(s), ' + resumo.manuais + ' manual(is). ' +
      'EXCELENTES: ' + resumo.excelentes + ' · BOAS: ' + resumo.boas + ' · DESCARTADAS: ' + resumo.descartadas +
      ' · Duplicadas ignoradas: ' + resumo.duplicadas + ' · Telegram: ' + resumo.enviadas + ' enviada(s)' +
      (resumo.falhasEnvio ? ', ' + resumo.falhasEnvio + ' falha(s)' : '') + '.';
    log_(ctx, 'INFO', 'radar', texto, 'origem=' + origem);
    return texto;
  } catch (e) {
    const msg = mensagemErro_(e);
    log_(ctx, 'ERRO', 'radar', 'Falha geral na execução', msg);
    alertarFalhaGeral_(ctx, msg);
    throw e;
  } finally {
    try { gravarLogs_(ctx); } catch (e2) { console.log('Não foi possível gravar LOGS: ' + e2); }
    trava.releaseLock();
  }
}

/* =============================== CONTEXTO =============================== */

function carregarContexto_(ctx) {
  ctx.tabProdutos = lerTabela_('PRODUTOS');
  ctx.tabLojas = lerTabela_('LOJAS');
  ctx.tabFontes = lerTabela_('FONTES');
  ctx.tabOfertas = lerTabela_('OFERTAS');
  ctx.tabNotificacoes = lerTabela_('NOTIFICACOES');

  ctx.produtos = ctx.tabProdutos.linhas
    .filter(function (l) { return String(l.get('ID')).trim() !== ''; })
    .map(function (l) {
      return {
        linha: l,
        id: String(l.get('ID')).trim(),
        ativo: verdadeiro_(l.get('Ativo')),
        nome: String(l.get('Produto')).trim(),
        categoria: String(l.get('Categoria')).trim(),
        obrigatorias: termos_(l.get('Palavras obrigatórias')),
        proibidas: termos_(l.get('Palavras proibidas')),
        alvo: parseNumero_(l.get('Preço-alvo (R$)')),
        minimo: parseNumero_(l.get('Preço mínimo plausível (R$)')),
        lojasPermitidas: listaIds_(l.get('Lojas permitidas'))
      };
    });

  ctx.lojas = {};
  ctx.tabLojas.linhas.forEach(function (l) {
    const id = String(l.get('ID')).trim().toLowerCase();
    if (!id) return;
    ctx.lojas[id] = {
      linha: l, id: id, ativa: verdadeiro_(l.get('Ativa')), nome: String(l.get('Loja')).trim() || id,
      dominios: String(l.get('Domínios')).split(',').map(function (d) { return d.trim().toLowerCase().replace(/^www\./, ''); }).filter(String)
    };
  });

  // Histórico de preços em memória: produtoId -> [{data, preco, loja}]
  ctx.historico = {};
  ctx.historicoNovo = [];
  const tabHist = lerTabela_('HISTORICO_PRECOS');
  tabHist.linhas.forEach(function (l) {
    const pid = String(l.get('ID do produto')).trim();
    const preco = parseNumero_(l.get('Preço (R$)'));
    const data = comoData_(l.get('Data/hora'));
    if (!pid || !(preco > 0) || !data) return;
    (ctx.historico[pid] = ctx.historico[pid] || []).push({ data: data, preco: preco, loja: String(l.get('Loja')).trim().toLowerCase() });
  });

  // Alertas já enviados (para antiduplicidade e limite diário)
  ctx.alertasEnviados = ctx.tabNotificacoes.linhas
    .filter(function (l) { return (l.get('Tipo') === 'ALERTA' || l.get('Tipo') === 'PISTA') && l.get('Status') === 'ENVIADO'; })
    .map(function (l) {
      return {
        pista: l.get('Tipo') === 'PISTA',
        data: comoData_(l.get('Data/hora')), produtoId: String(l.get('ID do produto')).trim(),
        loja: String(l.get('Loja')).trim().toLowerCase(), preco: parseNumero_(l.get('Preço (R$)'))
      };
    })
    .filter(function (a) { return a.data; });

  // Chaves de ofertas recentes (para não gravar a mesma oferta a cada execução)
  const limite = ctx.agora.getTime() - ctx.cfg.num('JANELA_DUPLICIDADE_HORAS') * 3600 * 1000;
  ctx.chavesRecentes = {};
  ctx.tabOfertas.linhas.forEach(function (l) {
    const d = comoData_(l.get('Data/hora'));
    const k = String(l.get('Chave de duplicidade'));
    if (k && d && d.getTime() >= limite) ctx.chavesRecentes[k] = true;
  });
  ctx.produtosTocados = {};
  ctx.processadasAgora = {};
}

/* =============================== FONTES =============================== */

/**
 * Para cada fonte ativa (exceto MANUAL), chama a função coletar_<ID>(fonte, ctx) se ela existir.
 * Uma fonte com erro NÃO interrompe as outras.
 */
function coletarDasFontes_(ctx) {
  const todas = [];
  ctx.tabFontes.linhas.forEach(function (l) {
    const id = String(l.get('ID')).trim();
    if (!id || id === 'MANUAL' || !verdadeiro_(l.get('Ativa'))) return;

    const intervaloMin = parseNumero_(l.get('Intervalo mínimo (min)')) || 0;
    const ultimo = comoData_(l.get('Último sucesso'));
    if (ctx.origem === 'gatilho' && ultimo && (ctx.agora - ultimo) < intervaloMin * 60000) return;

    const coletor = globalThis['coletar_' + id];
    if (typeof coletor !== 'function') {
      atualizarStatusFonte_(ctx, id, null, 'Fonte ativa, mas o coletor ainda não foi instalado (Etapa 5).', 0, 'NÃO IMPLEMENTADA');
      return;
    }
    try {
      const fonte = { id: id, lojas: listaIds_(l.get('Lojas')), parametro: String(l.get('Endereço ou parâmetro')).trim(), linha: l };
      const itens = coletor(fonte, ctx) || [];
      itens.forEach(function (it) { it.fonte = it.fonte || id; });
      todas.push.apply(todas, itens);
      atualizarStatusFonte_(ctx, id, true, 'Coleta concluída: ' + itens.length + ' item(ns).', itens.length);
    } catch (e) {
      atualizarStatusFonte_(ctx, id, false, mensagemErro_(e), 0);
    }
  });
  return todas;
}

/**
 * Atualiza a linha da fonte na aba FONTES.
 * ok: true = sucesso, false = falha, null = só mensagem/status informado.
 */
function atualizarStatusFonte_(ctx, id, ok, mensagem, itens, statusForcado) {
  const l = ctx.tabFontes.linhas.filter(function (x) { return String(x.get('ID')).trim() === id; })[0];
  if (!l) return;
  if (ok === true) {
    l.set('Status', 'OK');
    l.set('Último sucesso', ctx.agora);
    l.set('Falhas seguidas', 0);
    l.set('Itens na última coleta', itens || 0);
  } else if (ok === false) {
    const falhas = (parseNumero_(l.get('Falhas seguidas')) || 0) + 1;
    const limite = ctx.cfg.num('ALERTA_FALHA_APOS');
    l.set('Falhas seguidas', falhas);
    l.set('Última falha', ctx.agora);
    l.set('Status', 'FALHANDO');
    log_(ctx, 'ERRO', 'fonte:' + id, 'Falha na coleta (' + falhas + 'ª seguida)', mensagem);
    if (falhas >= limite) {
      l.set('Status', 'INDISPONÍVEL');
      l.set('Ativa', false);
      mensagem = 'Pausada após ' + falhas + ' falhas seguidas. Último erro: ' + mensagem;
      notificarSistema_(ctx, '⚠️ <b>RADAR — fonte pausada</b>\n\nA fonte <b>' + escaparHtml_(id) + '</b> falhou ' + falhas +
        ' vezes seguidas e foi desativada.\n\nÚltimo erro: ' + escaparHtml_(String(mensagem).slice(0, 300)) +
        '\n\nPara reativar: aba FONTES, marque "Ativa".');
    }
  }
  if (statusForcado) l.set('Status', statusForcado);
  l.set('Última mensagem', String(mensagem || '').slice(0, 500));
  salvarLinha_(ctx.tabFontes, l);
}

function atualizarStatusLojas_(ctx) {
  Object.keys(ctx.lojas).forEach(function (id) {
    const loja = ctx.lojas[id];
    const fontesAtivas = ctx.tabFontes.linhas.filter(function (l) {
      const fid = String(l.get('ID')).trim();
      if (!fid || fid === 'MANUAL' || !verdadeiro_(l.get('Ativa')) || l.get('Status') !== 'OK') return false;
      const lojas = listaIds_(l.get('Lojas'));
      return lojas.length === 0 || lojas.indexOf('todas') !== -1 || lojas.indexOf(id) !== -1;
    }).map(function (l) { return String(l.get('ID')).trim(); });
    const cobrindo = fontesAtivas.filter(function (f) { return !ehPista_(f); });
    const pistas = fontesAtivas.filter(ehPista_);
    let status;
    if (!loja.ativa) status = 'DESATIVADA';
    else if (cobrindo.length) status = 'MONITORADA (' + cobrindo.join(', ') + ')' + (pistas.length ? ' + PISTAS (' + pistas.join(', ') + ')' : '');
    else if (pistas.length) status = 'SÓ PISTAS (' + pistas.join(', ') + ') + MANUAL';
    else status = 'SÓ MANUAL';
    if (loja.linha.get('Status') !== status) {
      loja.linha.set('Status', status);
      salvarLinha_(ctx.tabLojas, loja.linha);
    }
  });
}

/* =============================== PROCESSAMENTO =============================== */

/** Linhas da aba OFERTAS preenchidas por você (sem Classificação) são processadas e atualizadas no lugar. */
function processarLancamentosManuais_(ctx, resumo) {
  let n = 0;
  ctx.tabOfertas.linhas.forEach(function (l) {
    if (String(l.get('Classificação')).trim() !== '') return;
    const temAlgo = ['Preço (R$)', 'Link', 'Título original', 'ID do produto'].some(function (c) { return String(l.get(c)).trim() !== ''; });
    if (!temAlgo) return;
    n++;
    const oferta = {
      id: String(l.get('ID')).trim() || novoIdOferta_(ctx),
      data: comoData_(l.get('Data/hora')) || ctx.agora,
      fonte: String(l.get('Fonte')).trim() || 'MANUAL',
      loja: String(l.get('Loja')).trim().toLowerCase(),
      produtoId: String(l.get('ID do produto')).trim(),
      titulo: String(l.get('Título original')).trim(),
      preco: parseNumero_(l.get('Preço (R$)')),
      precoAnunciado: parseNumero_(l.get('Preço anunciado pela loja (R$)')),
      frete: String(l.get('Frete')).trim(),
      cupom: String(l.get('Cupom')).trim(),
      vendedor: String(l.get('Vendedor')).trim(),
      disponivel: l.get('Disponível'),
      link: String(l.get('Link')).trim()
    };
    ctx.processadasAgora[oferta.id] = true;
    const res = classificarOferta_(ctx, oferta, { ignorarDuplicidadeDeChave: true });
    contar_(resumo, res);
    preencherLinhaOferta_(l, oferta, res);
    l.set('Notificado', notificarSeNecessario_(ctx, oferta, res, resumo));
    salvarLinha_(ctx.tabOfertas, l);
  });
  return n;
}

/** Ofertas vindas das fontes automáticas: duplicadas recentes são ignoradas; as demais vão para OFERTAS. */
function processarOfertasNovas_(ctx, novas, resumo) {
  const linhas = [];
  novas.forEach(function (bruta) {
    const oferta = {
      id: novoIdOferta_(ctx), data: ctx.agora, fonte: bruta.fonte,
      loja: String(bruta.loja || '').trim().toLowerCase(), produtoId: String(bruta.produtoId || '').trim(),
      titulo: String(bruta.titulo || '').trim(), preco: parseNumero_(bruta.preco),
      precoAnunciado: parseNumero_(bruta.precoAnunciado), frete: String(bruta.frete || '').trim(),
      cupom: String(bruta.cupom || '').trim(), vendedor: String(bruta.vendedor || '').trim(),
      disponivel: bruta.disponivel, link: String(bruta.link || '').trim(),
      publicadoEm: comoData_(bruta.publicadoEm), origemTexto: String(bruta.origemTexto || '').trim()
    };
    const res = classificarOferta_(ctx, oferta, {});
    // Também vale para descartadas (ex.: anúncio que não é de nenhum produto): não regrava a cada execução.
    if (res.duplicada || ctx.chavesRecentes[res.chave]) { resumo.duplicadas++; return; }
    ctx.chavesRecentes[res.chave] = true;
    contar_(resumo, res);
    const l = criarLinha_(new Array(ctx.tabOfertas.cab.length).fill(''), 0, ctx.tabOfertas.idx);
    preencherLinhaOferta_(l, oferta, res);
    l.set('Notificado', notificarSeNecessario_(ctx, oferta, res, resumo));
    linhas.push(l.valores);
  });
  if (linhas.length) acrescentarValores_(ctx.tabOfertas, linhas);
}

function contar_(resumo, res) {
  if (res.classe === 'EXCELENTE') resumo.excelentes++;
  else if (res.classe === 'BOA') resumo.boas++;
  else resumo.descartadas++;
}

function preencherLinhaOferta_(l, oferta, res) {
  l.set('ID', oferta.id);
  l.set('Data/hora', oferta.data);
  l.set('Fonte', oferta.fonte);
  l.set('Loja', res.loja ? res.loja.id : oferta.loja);
  l.set('ID do produto', res.produto ? res.produto.id : oferta.produtoId);
  l.set('Produto', res.produto ? res.produto.nome : '');
  l.set('Título original', oferta.titulo);
  l.set('Preço (R$)', oferta.preco > 0 ? oferta.preco : (l.get('Preço (R$)') || ''));
  l.set('Preço anunciado pela loja (R$)', oferta.precoAnunciado > 0 ? oferta.precoAnunciado : '');
  l.set('Frete', oferta.frete);
  l.set('Cupom', oferta.cupom);
  l.set('Vendedor', oferta.vendedor);
  l.set('Disponível', oferta.disponivel === undefined || oferta.disponivel === null ? '' : oferta.disponivel);
  l.set('Link', oferta.link);
  l.set('Mediana de referência (R$)', res.mediana || '');
  l.set('Observações no histórico', res.nObs);
  l.set('Diferença vs. mediana (%)', res.difPct === null ? '' : arred_(res.difPct, 2));
  l.set('Classificação', res.classe);
  l.set('Motivo', res.motivo);
  l.set('Chave de duplicidade', res.chave);
}

/* =============================== CLASSIFICAÇÃO =============================== */

/**
 * Valida e classifica uma oferta. NUNCA usa o preço "de" (riscado) como histórico.
 * @return {{classe, motivo, produto, loja, mediana, nObs, difPct, chave, valida, duplicada}}
 */
function classificarOferta_(ctx, of, opcoes) {
  const cfg = ctx.cfg;
  const res = { classe: 'DESCARTADA', motivo: '', produto: null, loja: null, mediana: null, nObs: 0, difPct: null, chave: '', valida: false, duplicada: false };
  const descartar = function (motivo) { res.motivo = motivo; res.chave = res.chave || chaveOferta_(res, of); return res; };

  // Preço
  if (!(of.preco > 0)) return descartar('Preço ausente ou inválido.');

  // Link e loja
  if (!of.link) return descartar('Sem link da oferta.');
  const host = hostDe_(of.link);
  if (!host) return descartar('Link inválido: precisa começar com https:// e ter um domínio.');
  const lojaDoLink = lojaPorHost_(ctx, host);
  const pista = ehPista_(of.fonte) ? RADAR_FONTES_PISTA[of.fonte] : null;
  if (pista && pista.dominios.some(function (d) { return host === d || host.slice(-(d.length + 1)) === '.' + d; })) {
    res.loja = ctx.lojas[of.loja] || null;
    if (!res.loja) return descartar('A ' + pista.rotulo + ' não cita uma loja cadastrada (Amazon, Mercado Livre, Magalu, Shopee, KaBuM!, Casas Bahia).');
  } else if (of.loja) {
    res.loja = ctx.lojas[of.loja] || null;
    if (!res.loja) return descartar('Loja "' + of.loja + '" não existe na aba LOJAS.');
    if (!lojaDoLink || lojaDoLink.id !== res.loja.id) return descartar('O link (' + host + ') não pertence aos domínios oficiais de ' + res.loja.nome + '.');
  } else {
    res.loja = lojaDoLink;
    if (!res.loja) return descartar('Domínio ' + host + ' não pertence a nenhuma loja cadastrada (aba LOJAS).');
  }
  if (!res.loja.ativa) return descartar('Loja ' + res.loja.nome + ' está desativada.');

  // Produto
  if (of.produtoId) {
    res.produto = ctx.produtos.filter(function (p) { return p.id.toLowerCase() === of.produtoId.toLowerCase(); })[0] || null;
    if (!res.produto) return descartar('ID de produto "' + of.produtoId + '" não existe na aba PRODUTOS.');
    if (!res.produto.ativo) return descartar('Produto ' + res.produto.nome + ' está desativado.');
  } else {
    if (!of.titulo) return descartar('Sem título e sem ID do produto: impossível reconhecer o produto.');
    res.produto = reconhecerProduto_(ctx, of.titulo);
    if (!res.produto) {
      const bloqueio = motivoBloqueio_(ctx, of.titulo);
      return descartar(bloqueio || 'Não corresponde a nenhum produto ativo (palavras obrigatórias).');
    }
  }
  const p = res.produto;
  res.chave = chaveOferta_(res, of);

  // Duplicidade (mesmo produto + loja + preço dentro da janela)
  if (!opcoes.ignorarDuplicidadeDeChave && ctx.chavesRecentes[res.chave]) { res.duplicada = true; return descartar('Oferta duplicada.'); }

  // Filtros de configuração
  const categorias = listaIds_(cfg.texto('CATEGORIAS_MONITORADAS'));
  if (categorias.length && categorias.indexOf('todas') === -1 && categorias.indexOf(normalizar_(p.categoria)) === -1) {
    return descartar('Categoria "' + p.categoria + '" não está em CATEGORIAS_MONITORADAS.');
  }
  if (p.lojasPermitidas.length && p.lojasPermitidas.indexOf('todas') === -1 && p.lojasPermitidas.indexOf(res.loja.id) === -1) {
    return descartar('Loja ' + res.loja.nome + ' não está nas lojas permitidas deste produto.');
  }
  if (of.preco < cfg.num('PRECO_MINIMO_GLOBAL')) return descartar('Abaixo do PRECO_MINIMO_GLOBAL (' + reais_(cfg.num('PRECO_MINIMO_GLOBAL')) + ').');
  if (of.preco > cfg.num('PRECO_MAXIMO_GLOBAL')) return descartar('Acima do PRECO_MAXIMO_GLOBAL (' + reais_(cfg.num('PRECO_MAXIMO_GLOBAL')) + ').');
  if (p.minimo > 0 && of.preco < p.minimo) {
    return descartar('Abaixo do preço mínimo plausível (' + reais_(p.minimo) + '): provável acessório, anúncio-isca ou golpe.');
  }
  if (indisponivel_(of.disponivel)) return descartar('Produto indisponível.');

  // A partir daqui a oferta é válida e entra no histórico.
  res.valida = true;

  // Histórico próprio (sem o preço desta oferta)
  const janelaMs = cfg.num('JANELA_HISTORICO_DIAS') * 86400000;
  const obs = (ctx.historico[p.id] || []).filter(function (h) { return ctx.agora - h.data <= janelaMs; });
  res.nObs = obs.length;
  const minObs = cfg.num('MIN_OBSERVACOES_HISTORICO');
  if (obs.length >= minObs) {
    res.mediana = arred_(mediana_(obs.map(function (h) { return h.preco; })), 2);
    res.difPct = (of.preco - res.mediana) / res.mediana * 100;
  }

  const notas = [];
  const atingiuAlvo = p.alvo > 0 && of.preco <= p.alvo;
  const pctExc = cfg.num('DESCONTO_MIN_EXCELENTE_PCT');
  const pctBoa = cfg.num('DESCONTO_MIN_BOA_PCT');
  const historicoTexto = res.mediana
    ? pct_(-res.difPct) + (res.difPct <= 0 ? ' abaixo' : ' acima') + ' da mediana de ' + obs.length + ' preços (' + reais_(res.mediana) + ')'
    : 'histórico ainda insuficiente (' + obs.length + ' de ' + minObs + ' registros)';
  let porDesconto = false;

  if (atingiuAlvo) {
    res.classe = 'EXCELENTE';
    notas.push('Atingiu seu preço-alvo (' + reais_(p.alvo) + ')');
    notas.push(historicoTexto);
  } else if (res.mediana && res.difPct <= -pctExc) {
    res.classe = 'EXCELENTE'; porDesconto = true;
    notas.push(historicoTexto);
  } else if (res.mediana && res.difPct <= -pctBoa) {
    res.classe = 'BOA';
    notas.push(historicoTexto);
  } else if (!res.mediana && p.alvo > 0 && of.preco <= p.alvo * (1 + cfg.num('PROXIMO_ALVO_PCT') / 100)) {
    res.classe = 'BOA';
    notas.push('Perto do seu preço-alvo: ' + pct_((of.preco / p.alvo - 1) * 100) + ' acima de ' + reais_(p.alvo));
    notas.push(historicoTexto);
  } else {
    res.classe = 'DESCARTADA';
    notas.push(res.mediana ? 'Preço normal: ' + historicoTexto : 'Acima do preço-alvo' + (p.alvo > 0 ? ' (' + reais_(p.alvo) + ')' : ' (sem alvo definido)') + ' e ' + historicoTexto);
  }

  // Desconto anunciado pela loja: só informativo
  if (of.precoAnunciado > of.preco) {
    const anunciado = (of.precoAnunciado - of.preco) / of.precoAnunciado * 100;
    if (!res.mediana) notas.push('desconto anunciado de ' + pct_(anunciado) + ' não verificável (sem histórico)');
    else if (res.difPct > -pctBoa) notas.push('desconto anunciado de ' + pct_(anunciado) + ' NÃO confirmado pelo histórico');
  }

  // Comparação com outras lojas (somente com dados reais do nosso histórico)
  const janelaComp = cfg.num('DIAS_COMPARACAO_LOJAS') * 86400000;
  const outras = (ctx.historico[p.id] || []).filter(function (h) { return h.loja !== res.loja.id && ctx.agora - h.data <= janelaComp; });
  if (outras.length) {
    const menor = outras.reduce(function (a, b) { return b.preco < a.preco ? b : a; });
    if (menor.preco < of.preco * 0.98) {
      notas.push('há preço menor em ' + nomeLoja_(ctx, menor.loja) + ' (' + reais_(menor.preco) + ') nos últimos ' + cfg.num('DIAS_COMPARACAO_LOJAS') + ' dias');
      if (res.classe === 'EXCELENTE' && porDesconto) res.classe = 'BOA';
    } else {
      notas.push('menor preço entre ' + (contarLojas_(outras) + 1) + ' lojas nos últimos ' + cfg.num('DIAS_COMPARACAO_LOJAS') + ' dias');
    }
  }

  if (ehPista_(of.fonte)) {
    notas.unshift('Pista: preço citado em ' + RADAR_FONTES_PISTA[of.fonte].rotulo + (of.origemTexto ? ' (' + of.origemTexto + ')' : '') + ', não verificado na loja');
  }
  res.motivo = notas.join('; ') + '.';
  res.motivo = res.motivo.charAt(0).toUpperCase() + res.motivo.slice(1);
  ctx.produtosTocados[p.id] = true;
  registrarNoHistorico_(ctx, of, res);
  return res;
}

function chaveOferta_(res, of) {
  const prod = res.produto ? res.produto.id : 'SEMPRODUTO:' + normalizar_(of.titulo).slice(0, 40);
  const loja = res.loja ? res.loja.id : (of.loja || hostDe_(of.link) || '?');
  return prod + '|' + loja + '|' + (of.preco > 0 ? Math.round(of.preco) : '?');
}

/** Produto ativo cujas palavras obrigatórias aparecem no título e nenhuma proibida aparece. Escolhe o mais específico. */
function reconhecerProduto_(ctx, titulo) {
  const t = normalizar_(titulo);
  let melhor = null, melhorPontos = -1;
  ctx.produtos.forEach(function (p) {
    if (!p.ativo || p.obrigatorias.length === 0) return;
    let pontos = 0;
    const casou = p.obrigatorias.every(function (grupo) {
      const achado = grupo.filter(function (termo) { return contemTermo_(t, termo); })[0];
      if (achado) pontos += achado.length;
      return !!achado;
    });
    if (!casou || termoProibido_(t, p.proibidas)) return;
    if (pontos > melhorPontos) { melhor = p; melhorPontos = pontos; }
  });
  return melhor;
}

/** Explica por que um título que casaria com um produto foi bloqueado por palavra proibida. */
function motivoBloqueio_(ctx, titulo) {
  const t = normalizar_(titulo);
  for (let i = 0; i < ctx.produtos.length; i++) {
    const p = ctx.produtos[i];
    if (!p.ativo || !p.obrigatorias.length) continue;
    const casou = p.obrigatorias.every(function (g) { return g.some(function (termo) { return contemTermo_(t, termo); }); });
    const proib = casou && termoProibido_(t, p.proibidas);
    if (proib) return 'Parecia "' + p.nome + '", mas contém palavra proibida: "' + proib + '".';
  }
  return '';
}

function termoProibido_(textoNormalizado, grupos) {
  for (let i = 0; i < grupos.length; i++) {
    for (let j = 0; j < grupos[i].length; j++) {
      if (contemTermo_(textoNormalizado, grupos[i][j])) return grupos[i][j];
    }
  }
  return '';
}

/* =============================== NOTIFICAÇÃO =============================== */

/** Decide se envia ao Telegram (antiduplicidade + limite diário) e devolve o texto para a coluna "Notificado". */
function notificarSeNecessario_(ctx, of, res, resumo) {
  const cfg = ctx.cfg;
  const quer = res.classe === 'EXCELENTE' || (res.classe === 'BOA' && cfg.sim('ENVIAR_BOAS_IMEDIATO'));
  if (!quer) return res.classe === 'BOA' ? 'NÃO — vai para o resumo diário' : 'NÃO';

  const janela = cfg.num('JANELA_DUPLICIDADE_HORAS') * 3600000;
  const queda = cfg.num('QUEDA_EXTRA_REALERTA_PCT');
  const anterior = ctx.alertasEnviados
    .filter(function (a) {
      // Um alerta verificado (loja) não é bloqueado por uma pista (notícia) anterior.
      if (a.pista && !ehPista_(of.fonte)) return false;
      return a.produtoId === res.produto.id && a.loja === res.loja.id && ctx.agora - a.data <= janela;
    })
    .sort(function (a, b) { return b.data - a.data; })[0];
  if (anterior && of.fonte !== 'DEMO' && !(of.preco <= anterior.preco * (1 - queda / 100))) {
    return 'NÃO — já avisado em ' + dataHora_(anterior.data) + ' por ' + reais_(anterior.preco);
  }

  const inicioDia = new Date(Utilities.formatDate(ctx.agora, RADAR_FUSO, "yyyy-MM-dd'T'00:00:00XXX"));
  const hoje = ctx.alertasEnviados.filter(function (a) { return a.data >= inicioDia; }).length;
  if (hoje >= cfg.num('MAX_ALERTAS_DIA')) {
    log_(ctx, 'AVISO', 'telegram', 'Limite diário de alertas atingido (MAX_ALERTAS_DIA)', res.produto.nome);
    return 'NÃO — limite diário de alertas atingido';
  }
  return enviarAlertaOferta_(ctx, of, res, resumo);
}

function enviarAlertaOferta_(ctx, of, res, resumo) {
  const texto = montarMensagemOferta_(ctx, of, res);
  let r;
  try { r = enviarTelegram_(texto); } catch (e) { r = { ok: false, tentativas: 0, resposta: mensagemErro_(e) }; }
  const demo = of.fonte === 'DEMO';
  registrarNotificacao_(ctx, {
    tipo: demo ? 'TESTE' : (ehPista_(of.fonte) ? 'PISTA' : 'ALERTA'), produtoId: res.produto.id, produto: res.produto.nome, loja: res.loja.id, preco: of.preco,
    classe: res.classe, chave: res.chave, ok: r.ok, tentativas: r.tentativas, resposta: r.resposta, idMensagem: r.id
  });
  if (r.ok) {
    resumo.enviadas++;
    if (!demo) ctx.alertasEnviados.push({ pista: ehPista_(of.fonte), data: ctx.agora, produtoId: res.produto.id, loja: res.loja.id, preco: of.preco });
    return 'SIM — ' + dataHora_(ctx.agora);
  }
  resumo.falhasEnvio++;
  log_(ctx, 'ERRO', 'telegram', 'Falha ao enviar alerta', r.resposta);
  return 'FALHOU';
}

/** Ofertas EXCELENTES com "FALHOU" nas últimas 24 h ganham nova tentativa. */
function reenviarFalhas_(ctx, resumo) {
  ctx.tabOfertas.linhas.forEach(function (l) {
    if (l.get('Notificado') !== 'FALHOU' || ctx.processadasAgora[String(l.get('ID')).trim()]) return;
    const d = comoData_(l.get('Data/hora'));
    if (!d || ctx.agora - d > 86400000) return;
    const produto = ctx.produtos.filter(function (p) { return p.id === String(l.get('ID do produto')).trim(); })[0];
    const loja = ctx.lojas[String(l.get('Loja')).trim().toLowerCase()];
    if (!produto || !loja) return;
    const of = {
      preco: parseNumero_(l.get('Preço (R$)')), precoAnunciado: parseNumero_(l.get('Preço anunciado pela loja (R$)')),
      frete: String(l.get('Frete')), cupom: String(l.get('Cupom')), link: String(l.get('Link')),
      fonte: String(l.get('Fonte')), data: d
    };
    const res = {
      classe: l.get('Classificação'), motivo: l.get('Motivo'), produto: produto, loja: loja,
      mediana: parseNumero_(l.get('Mediana de referência (R$)')) || null, nObs: parseNumero_(l.get('Observações no histórico')) || 0,
      difPct: l.get('Diferença vs. mediana (%)') === '' ? null : parseNumero_(l.get('Diferença vs. mediana (%)')),
      chave: l.get('Chave de duplicidade')
    };
    l.set('Notificado', enviarAlertaOferta_(ctx, of, res, resumo));
    salvarLinha_(ctx.tabOfertas, l);
  });
}

function montarMensagemOferta_(ctx, of, res) {
  const p = res.produto;
  const linhas = [];
  if (of.fonte === 'DEMO') linhas.push('🧪 <i>[DEMONSTRAÇÃO — oferta fictícia, não compre]</i>');
  else if (ctx.cfg.sim('MODO_TESTE')) linhas.push('🧪 <i>[TESTE]</i>');
  const pista = ehPista_(of.fonte) ? RADAR_FONTES_PISTA[of.fonte] : null;
  if (pista) {
    linhas.push('📰 <b>PISTA DE PROMOÇÃO (' + res.classe + ')</b>');
    linhas.push('⚠️ <i>Preço citado em ' + pista.rotulo + (of.origemTexto ? ' (' + escaparHtml_(of.origemTexto) + ')' : '') +
      ', não verificado na loja. Confira antes de comprar.</i>');
  } else {
    linhas.push(res.classe === 'EXCELENTE' ? '🚨 <b>PROMOÇÃO EXCELENTE ENCONTRADA!</b>' : '👍 <b>PROMOÇÃO BOA ENCONTRADA</b>');
  }
  linhas.push('');
  linhas.push('📦 <b>Produto:</b> ' + escaparHtml_(p.nome));
  if (of.titulo && normalizar_(of.titulo) !== normalizar_(p.nome)) linhas.push('📝 <b>' + (pista ? 'Manchete' : 'Anúncio') + ':</b> ' + escaparHtml_(of.titulo.slice(0, 160)));
  linhas.push('💰 <b>' + (pista ? 'Preço citado' : 'Preço atual') + ':</b> ' + reais_(of.preco));
  if (p.alvo > 0) linhas.push('🎯 <b>Seu preço-alvo:</b> ' + reais_(p.alvo) + (of.preco <= p.alvo ? ' ✅ atingido' : ''));
  if (res.mediana) {
    linhas.push('📉 <b>Preço de referência:</b> ' + reais_(res.mediana) + ' <i>(mediana de ' + res.nObs + ' preços registrados pelo radar)</i>');
    linhas.push('🔥 <b>Diferença real:</b> ' + pct_(-res.difPct) + (res.difPct <= 0 ? ' abaixo' : ' acima') + ' da referência');
  } else {
    linhas.push('📉 <b>Preço de referência:</b> <i>histórico ainda insuficiente — preço competitivo, sem confirmação de menor preço</i>');
  }
  if (of.precoAnunciado > of.preco) {
    linhas.push('🏷️ <b>Desconto anunciado pela loja:</b> ' + pct_((of.precoAnunciado - of.preco) / of.precoAnunciado * 100) +
      ' (de ' + reais_(of.precoAnunciado) + ') <i>— informado pela loja, não verificado</i>');
  }
  linhas.push('🏬 <b>Loja:</b> ' + escaparHtml_(res.loja.nome));
  linhas.push('🚚 <b>Frete:</b> ' + (of.frete ? escaparHtml_(of.frete) : 'verificar no checkout'));
  if (of.cupom) linhas.push('🎟️ <b>Cupom:</b> ' + escaparHtml_(of.cupom));
  linhas.push('⭐ <b>Classificação:</b> ' + res.classe);
  linhas.push('🧠 <b>Por quê:</b> ' + escaparHtml_(res.motivo));
  linhas.push('');
  linhas.push('🔗 <a href="' + escaparHtml_(of.link) + '"><b>' + (pista ? 'LER A ' + pista.rotulo.toUpperCase() : 'LINK PARA COMPRA') + '</b></a>');
  if (of.publicadoEm) linhas.push('🗞️ <b>Publicada em:</b> ' + dataHora_(of.publicadoEm));
  linhas.push('⏰ <b>Verificado em:</b> ' + dataHora_(of.data || ctx.agora));
  linhas.push('📥 <b>Fonte:</b> ' + escaparHtml_(of.fonte || ''));
  return linhas.join('\n');
}

/** Mensagens do próprio sistema (falhas). Nunca derruba a execução. */
function notificarSistema_(ctx, html) {
  try {
    const r = enviarTelegram_(html);
    registrarNotificacao_(ctx, { tipo: 'FALHA', produto: '', loja: '', preco: '', classe: '', chave: '', ok: r.ok, tentativas: r.tentativas, resposta: r.resposta, idMensagem: r.id });
  } catch (e) {
    log_(ctx, 'ERRO', 'telegram', 'Não foi possível enviar aviso de sistema', mensagemErro_(e));
  }
}

/** Aviso de falha geral, no máximo 1 a cada 6 horas. */
function alertarFalhaGeral_(ctx, msg) {
  try {
    const props = PropertiesService.getScriptProperties();
    const ultimo = Number(props.getProperty('ULTIMO_ALERTA_FALHA_GERAL') || 0);
    if (Date.now() - ultimo < 6 * 3600000) return;
    props.setProperty('ULTIMO_ALERTA_FALHA_GERAL', String(Date.now()));
    enviarTelegram_('🛑 <b>RADAR — falha na execução</b>\n\n' + escaparHtml_(String(msg).slice(0, 500)) + '\n\nVeja a aba LOGS da planilha.');
  } catch (e) { console.log('Aviso de falha não enviado: ' + e); }
}

function registrarNotificacao_(ctx, n) {
  const l = criarLinha_(new Array(ctx.tabNotificacoes.cab.length).fill(''), 0, ctx.tabNotificacoes.idx);
  l.set('Data/hora', new Date());
  l.set('Tipo', n.tipo);
  l.set('ID do produto', n.produtoId || '');
  l.set('Produto', n.produto || '');
  l.set('Loja', n.loja || '');
  l.set('Preço (R$)', n.preco || '');
  l.set('Classificação', n.classe || '');
  l.set('Chave de duplicidade', n.chave || '');
  l.set('Status', n.ok ? 'ENVIADO' : 'FALHOU');
  l.set('Tentativas', n.tentativas || 0);
  l.set('Resposta / erro', String(n.resposta || '').slice(0, 500));
  l.set('ID da mensagem', n.idMensagem || '');
  acrescentarValores_(ctx.tabNotificacoes, [l.valores]);
}

/* =============================== HISTÓRICO E PRODUTOS =============================== */

function registrarNoHistorico_(ctx, of, res) {
  // Demonstração e pistas (preço de terceiros) nunca viram histórico: só preço visto na loja conta.
  if (!res.valida || of.fonte === 'DEMO' || ehPista_(of.fonte)) return;
  const pid = res.produto.id, loja = res.loja.id;
  const intervalo = ctx.cfg.num('HORAS_ENTRE_REGISTROS_HISTORICO') * 3600000;
  const lista = ctx.historico[pid] = ctx.historico[pid] || [];
  const repetido = lista.some(function (h) {
    return h.loja === loja && Math.abs(h.preco - of.preco) <= of.preco * 0.005 && Math.abs(ctx.agora - h.data) < intervalo;
  });
  if (repetido) return;
  const reg = { data: of.data || ctx.agora, preco: of.preco, loja: loja };
  lista.push(reg);
  ctx.historicoNovo.push([reg.data, pid, res.produto.nome, loja, of.preco, of.fonte || '', of.link, of.id || '']);
}

function gravarHistorico_(ctx) {
  if (!ctx.historicoNovo.length) return;
  const tab = lerTabela_('HISTORICO_PRECOS');
  const linhas = ctx.historicoNovo.map(function (v) {
    const l = criarLinha_(new Array(tab.cab.length).fill(''), 0, tab.idx);
    ['Data/hora', 'ID do produto', 'Produto', 'Loja', 'Preço (R$)', 'Fonte', 'Link', 'ID da oferta'].forEach(function (c, i) { l.set(c, v[i]); });
    return l.valores;
  });
  acrescentarValores_(tab, linhas);
}

/** Atualiza as colunas cinza da aba PRODUTOS (último preço, menor preço, mediana). */
function atualizarProdutos_(ctx) {
  const minObs = ctx.cfg.num('MIN_OBSERVACOES_HISTORICO');
  const janelaMs = ctx.cfg.num('JANELA_HISTORICO_DIAS') * 86400000;
  ctx.produtos.forEach(function (p) {
    if (!ctx.produtosTocados[p.id]) return;
    const hist = (ctx.historico[p.id] || []).slice().sort(function (a, b) { return a.data - b.data; });
    if (!hist.length) return;
    const ultimo = hist[hist.length - 1];
    const menor = hist.reduce(function (a, b) { return b.preco < a.preco ? b : a; });
    const recentes = hist.filter(function (h) { return ctx.agora - h.data <= janelaMs; });
    p.linha.set('Último preço (R$)', ultimo.preco);
    p.linha.set('Loja do último preço', nomeLoja_(ctx, ultimo.loja));
    p.linha.set('Data do último preço', ultimo.data);
    p.linha.set('Menor preço visto (R$)', menor.preco);
    p.linha.set('Mediana do histórico (R$)', recentes.length >= minObs ? arred_(mediana_(recentes.map(function (h) { return h.preco; })), 2) : '');
    salvarLinha_(ctx.tabProdutos, p.linha);
  });
}

/* =============================== CONFIGURAÇÃO =============================== */

function lerConfig_() {
  const padrao = {};
  RADAR_CONFIG_PADRAO.forEach(function (l) { padrao[l[0]] = l[1]; });
  const mapa = Object.assign({}, padrao);
  lerTabela_('CONFIGURACOES').linhas.forEach(function (l) {
    const k = String(l.get('Chave')).trim();
    const v = l.get('Valor');
    if (k && v !== '' && v !== null) mapa[k] = v;
  });
  return {
    texto: function (k) { return String(mapa[k] === undefined ? '' : mapa[k]).trim(); },
    num: function (k) {
      const n = parseNumero_(mapa[k]);
      return isNaN(n) ? parseNumero_(padrao[k]) : n;
    },
    sim: function (k) { return /^(sim|s|true|verdadeiro|1)$/i.test(String(mapa[k]).trim()); }
  };
}

function dentroDoHorario_(ctx) {
  const h = Number(Utilities.formatDate(ctx.agora, RADAR_FUSO, 'H'));
  const ini = ctx.cfg.num('HORA_INICIO'), fim = ctx.cfg.num('HORA_FIM');
  return ini <= fim ? (h >= ini && h <= fim) : (h >= ini || h <= fim);
}

/* =============================== PLANILHA (LEITURA/ESCRITA) =============================== */

function planilha_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('Este script precisa estar ligado à planilha (Extensões > Apps Script).');
  return ss;
}

/**
 * Lê uma aba inteira. Cada linha vira um objeto com get(coluna) e set(coluna, valor).
 * Usa ultimaLinhaReal_ (e não getLastRow) porque caixas de seleção contam como conteúdo.
 */
function lerTabela_(nomeAba) {
  const aba = planilha_().getSheetByName(nomeAba);
  if (!aba) throw new Error('Aba ' + nomeAba + ' não encontrada. Rode criarEstrutura (menu 📡 Radar).');
  const ultimaCol = Math.max(aba.getLastColumn(), 1);
  const cab = aba.getRange(1, 1, 1, ultimaCol).getValues()[0].map(function (v) { return String(v).trim(); });
  const idx = {};
  cab.forEach(function (n, i) { if (n && !(n in idx)) idx[n] = i; });
  const ultima = ultimaLinhaReal_(aba, ultimaCol);
  const valores = ultima >= 2 ? aba.getRange(2, 1, ultima - 1, ultimaCol).getValues() : [];
  return {
    nome: nomeAba, aba: aba, cab: cab, idx: idx, ultimaCol: ultimaCol, ultima: ultima,
    linhas: valores.map(function (v, i) { return criarLinha_(v, i + 2, idx); })
  };
}

function criarLinha_(valores, numero, idx) {
  return {
    numero: numero, valores: valores,
    get: function (n) { return (n in idx) ? valores[idx[n]] : ''; },
    set: function (n, v) { if (n in idx) valores[idx[n]] = v; }
  };
}

/** Última linha com algum conteúdo real (vazio e caixa desmarcada não contam). */
function ultimaLinhaReal_(aba, ultimaCol) {
  const total = aba.getLastRow();
  if (total < 2) return total;
  const valores = aba.getRange(1, 1, total, ultimaCol || aba.getLastColumn()).getValues();
  for (let i = valores.length - 1; i >= 0; i--) {
    if (valores[i].some(function (v) { return v !== '' && v !== false && v !== null; })) return i + 1;
  }
  return 0;
}

function salvarLinha_(tab, linha) {
  if (!linha.numero) return;
  tab.aba.getRange(linha.numero, 1, 1, tab.ultimaCol).setValues([linha.valores.slice(0, tab.ultimaCol)]);
}

function acrescentarValores_(tab, linhas) {
  if (!linhas.length) return;
  const inicio = Math.max(ultimaLinhaReal_(tab.aba, tab.ultimaCol), 1) + 1;
  const fim = inicio + linhas.length - 1;
  if (fim > tab.aba.getMaxRows()) tab.aba.insertRowsAfter(tab.aba.getMaxRows(), fim - tab.aba.getMaxRows() + 50);
  tab.aba.getRange(inicio, 1, linhas.length, tab.ultimaCol).setValues(linhas.map(function (v) { return v.slice(0, tab.ultimaCol); }));
}

/* =============================== LOGS =============================== */

function log_(ctx, nivel, modulo, mensagem, detalhes) {
  console.log('[' + nivel + '] ' + modulo + ': ' + mensagem + (detalhes ? ' | ' + detalhes : ''));
  ctx.logs.push([new Date(), nivel, modulo, String(mensagem).slice(0, 500), String(detalhes || '').slice(0, 1000)]);
}

function gravarLogs_(ctx) {
  if (!ctx.logs.length) return;
  acrescentarValores_(lerTabela_('LOGS'), ctx.logs);
  ctx.logs = [];
}

/* =============================== UTILITÁRIOS =============================== */

function normalizar_(s) {
  return String(s === null || s === undefined ? '' : s).toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/\s+/g, ' ').trim();
}

/** "a, b|c" -> [["a"], ["b","c"]] (vírgula = E, barra = OU) */
function termos_(texto) {
  return String(texto || '').split(',')
    .map(function (g) { return g.split('|').map(normalizar_).filter(String); })
    .filter(function (g) { return g.length; });
}

/** Procura o termo como "palavra": não casa "tv" dentro de "tvbox", mas casa "s10 fe" em "s10 fe+". */
function contemTermo_(texto, termo) {
  if (!termo) return false;
  const alfa = /[a-z0-9]/;
  let pos = texto.indexOf(termo);
  while (pos !== -1) {
    const antes = pos === 0 ? ' ' : texto.charAt(pos - 1);
    const fim = pos + termo.length;
    const depois = fim >= texto.length ? ' ' : texto.charAt(fim);
    const okAntes = !alfa.test(termo.charAt(0)) || !alfa.test(antes);
    const okDepois = !alfa.test(termo.charAt(termo.length - 1)) || !alfa.test(depois);
    if (okAntes && okDepois) return true;
    pos = texto.indexOf(termo, pos + 1);
  }
  return false;
}

function listaIds_(texto) {
  return String(texto || '').split(',').map(function (s) { return normalizar_(s); }).filter(String);
}

function verdadeiro_(v) {
  return v === true || /^(true|verdadeiro|sim|x|1)$/i.test(String(v).trim());
}

function indisponivel_(v) {
  if (v === false) return true;
  return /^(nao|não|false|falso|indisponivel|esgotado|sem estoque)$/.test(normalizar_(v));
}

/** Aceita número ou texto como "R$ 2.299,90", "2299.90", "2.299". */
function parseNumero_(v) {
  if (typeof v === 'number') return v;
  if (v === null || v === undefined) return NaN;
  let s = String(v).replace(/R\$|\s/gi, '').trim();
  if (!s) return NaN;
  if (s.indexOf(',') !== -1) s = s.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
  const n = Number(s);
  return isNaN(n) ? NaN : n;
}

function comoData_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'object' && v && typeof v.getTime === 'function' && !isNaN(v.getTime())) return v;
  return null;
}

function mediana_(nums) {
  const a = nums.slice().sort(function (x, y) { return x - y; });
  const m = Math.floor(a.length / 2);
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

function arred_(n, casas) { const f = Math.pow(10, casas); return Math.round(n * f) / f; }

function reais_(n) {
  const neg = n < 0;
  const partes = Math.abs(n).toFixed(2).split('.');
  partes[0] = partes[0].replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (neg ? '-' : '') + 'R$ ' + partes[0] + ',' + partes[1];
}

function pct_(n) { return Math.abs(n).toFixed(2).replace('.', ',') + '%'; }

function dataHora_(d) { return Utilities.formatDate(d, RADAR_FUSO, 'dd/MM/yyyy HH:mm'); }

function escaparHtml_(s) {
  return String(s === null || s === undefined ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Domínio de um link https. Recusa http, usuário@host e endereços sem ponto. */
function hostDe_(url) {
  const m = /^https:\/\/([^\/?#@\s:]+)(:\d+)?([\/?#]|$)/i.exec(String(url || '').trim());
  if (!m || m[1].indexOf('.') === -1) return '';
  return m[1].toLowerCase().replace(/^www\./, '');
}

function lojaPorHost_(ctx, host) {
  const ids = Object.keys(ctx.lojas);
  for (let i = 0; i < ids.length; i++) {
    const loja = ctx.lojas[ids[i]];
    if (loja.dominios.some(function (d) { return host === d || host.slice(-(d.length + 1)) === '.' + d; })) return loja;
  }
  return null;
}

function nomeLoja_(ctx, id) { return ctx.lojas[id] ? ctx.lojas[id].nome : id; }

function contarLojas_(lista) {
  const s = {}; lista.forEach(function (h) { s[h.loja] = true; }); return Object.keys(s).length;
}

function novoIdOferta_(ctx) {
  ctx.seq++;
  return 'OF' + Utilities.formatDate(ctx.agora, RADAR_FUSO, 'yyyyMMddHHmmss') + '-' + ctx.seq;
}

function mensagemErro_(e) {
  return String((e && (e.message || e)) || 'erro desconhecido');
}
