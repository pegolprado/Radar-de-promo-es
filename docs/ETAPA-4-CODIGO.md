# RADAR INTELIGENTE DE PROMOÇÕES — Etapa 4: Código do Apps Script

> Status: **aguardando você instalar e testar**.
> Testado aqui com planilha e Telegram simulados: `node testes/teste-nucleo.cjs` (17 testes) e
> `node testes/teste-setup.cjs` (12 testes). O teste que vale é o seu, com o Telegram de verdade.

## O que esta etapa entrega

| Arquivo | Função |
|---|---|
| `Setup.gs` (atualizado) | Estrutura da planilha + 3 configurações novas |
| `Nucleo.gs` (novo) | Reconhecimento do produto, validação, classificação, antiduplicidade, histórico, painel de status |
| `Telegram.gs` (novo) | Envio pela API oficial, 3 tentativas em falha temporária, erro explicado em português, token nunca exposto |
| `Menu.gs` (novo) | Menu **📡 Radar** na planilha |

Fluxo de cada execução:
```
fontes ativas (Etapa 5) + linhas que você lançou na aba OFERTAS
 → reconhece o produto (palavras obrigatórias/proibidas) → valida (preço, link https, domínio oficial, mínimo plausível)
 → compara com o NOSSO histórico (mediana) e com o seu preço-alvo → EXCELENTE / BOA / DESCARTADA + motivo
 → antiduplicidade → Telegram → grava NOTIFICACOES, HISTORICO_PRECOS, PRODUTOS, FONTES, LOJAS e LOGS
```

## Passo a passo

### 1. Guardar o token e o chat com segurança
1. No Apps Script, clique na engrenagem ⚙️ **Configurações do projeto**.
2. Role até **Propriedades do script** → **Adicionar propriedade do script**.
3. Propriedade `TELEGRAM_TOKEN` → Valor: o token do BotFather (sem espaços, sem aspas).
4. **Adicionar propriedade do script** de novo: `TELEGRAM_CHAT_ID` → Valor: o número do seu chat.
5. **Salvar propriedades do script**.

### 2. Atualizar e criar os arquivos
Para cada arquivo: abra o link → ícone de **copiar** → cole no Apps Script → **Ctrl+S**.

| No Apps Script | Ação | Copiar de |
|---|---|---|
| `Setup.gs` | substituir todo o conteúdo | `apps-script/Setup.gs` |
| `Nucleo.gs` | **criar**: botão **+** ao lado de "Arquivos" → **Script** → nome `Nucleo` | `apps-script/Nucleo.gs` |
| `Telegram.gs` | criar (mesmo jeito), nome `Telegram` | `apps-script/Telegram.gs` |
| `Menu.gs` | criar, nome `Menu` | `apps-script/Menu.gs` |

Ao final, a lista de arquivos deve ter: `appsscript.json`, `Setup.gs`, `Nucleo.gs`, `Telegram.gs`, `Menu.gs`.

### 3. Teste 1 — Telegram
1. Na lista de funções, escolha **`testarTelegram`** → **Executar**.
2. O Google pede autorização nova (agora o script acessa a internet para falar com o Telegram):
   **Revisar permissões → sua conta → Avançado → Acessar Radar de Promoções → Permitir**.
3. Esperado: no registro, `Telegram OK: mensagem enviada...`; no Telegram, "✅ RADAR DE PROMOÇÕES — teste de conexão".

### 4. Teste 2 — Fluxo completo com oferta de demonstração
1. Volte à planilha e **recarregue a página (F5)**. Aparece o menu **📡 Radar** ao lado de "Ajuda".
2. **📡 Radar → 🧪 Inserir oferta de demonstração**. (Na primeira vez pode pedir autorização de novo.)
3. **📡 Radar → 🔎 Verificar ofertas agora**.
4. Esperado:
   - Janela: `Radar concluído: ... EXCELENTES: 1 ... Telegram: 1 enviada(s).`
   - Telegram: "🧪 [DEMONSTRAÇÃO — oferta fictícia, não compre] 🚨 PROMOÇÃO EXCELENTE ENCONTRADA!" com
     Galaxy Tab S10 FE+, R$ 2.699,00, alvo R$ 2.800,00 ✅, desconto anunciado 22,86% "não verificado" e link clicável.
   - Aba OFERTAS: a linha classificada como EXCELENTE, com o motivo e "SIM — data".
   - Aba NOTIFICACOES: uma linha TESTE/ENVIADO. Aba FONTES: "Lançamento manual" com Status **OK**.

A demonstração **não** entra no histórico de preços nem bloqueia alertas reais.

## Como lançar uma oferta real à mão (já funciona hoje)
Viu um preço bom no site? Na aba **OFERTAS**, na primeira linha vazia, preencha só:
- **Título original** (copie o nome do anúncio) **ou** **ID do produto** (ex.: P002)
- **Preço (R$)**
- **Link** (precisa ser `https://` e do site oficial da loja)
Depois: **📡 Radar → Verificar ofertas agora**. A loja é reconhecida pelo link.
Todo preço válido entra no histórico: é assim que o radar aprende o preço "normal" de cada produto.

## Regras de classificação (todas ajustáveis em CONFIGURACOES)
- **EXCELENTE**: preço ≤ seu **preço-alvo**, ou ≥ 15% abaixo da **mediana do histórico** (com pelo menos 5 registros).
- **BOA**: 5% a 15% abaixo da mediana, ou (sem histórico) até 5% acima do alvo → vai para o resumo diário.
- **DESCARTADA**: sem preço, link inválido/fora do domínio oficial, palavra proibida, abaixo do mínimo plausível,
  loja/produto desativados, indisponível, preço normal. Sempre com o **motivo**.
- O preço "de" riscado **nunca** vira referência. Se o histórico não confirma o desconto, o motivo diz isso.
- Se houver preço menor em outra loja nos últimos 7 dias (dado real do histórico), o motivo avisa.
- Mesmo produto + loja não é avisado de novo por 48 h, a não ser que caia mais 3%. Máximo de 10 alertas/dia.
- `MODO_TESTE = SIM` coloca "[TESTE]" nas mensagens. Troque para `NAO` quando estiver satisfeito.

## O que ainda NÃO acontece sozinho
- Buscar ofertas nas lojas automaticamente → **Etapa 5** (Gmail primeiro, depois Mercado Livre/Shopee).
- Rodar em horário agendado → **Etapa 8**.
