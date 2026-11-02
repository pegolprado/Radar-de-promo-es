# RADAR INTELIGENTE DE PROMOÇÕES — Etapa 5: Fontes de ofertas

## 5.1 Diagnóstico (feito em 02/11/2026, a partir dos servidores do Google)

| Fonte | Resultado | Conclusão |
|---|---|---|
| Google Notícias (RSS) | ✅ 100 itens, 11 com preço | **Usável** |
| Promobit | ❌ HTTP 404 | Sem feed público nesse endereço |
| Pelando | ❌ HTTP 403 | Bloqueia servidores do Google — não contornamos |
| Gatry | ❌ sem resposta | Indisponível |
| Hardmob | ❌ HTTP 403 | Bloqueia servidores do Google — não contornamos |
| Mercado Livre API (sem login) | ❌ HTTP 403 UNAUTHORIZED | Exige conta de desenvolvedor (5.3) |

Ordem aprovada: **5.2 Google Notícias → 5.3 Mercado Livre (conta de desenvolvedor) → 5.4 Gmail (alertas de comparadores)**.

## 5.2 Google Notícias — pistas por produto

- Para cada produto **ativo**, pesquisa: `"<nome do produto>" (promoção OR oferta OR desconto) when:2d`
  (modelo editável na coluna "Endereço ou parâmetro" da fonte GNEWS; use `{produto}` onde entra o nome).
- Do **título** da notícia extrai: preço (`R$ 2.599`), preço anterior (`de R$ 3.499 por R$ 2.599`) e a loja citada.
- Ignora notícias com mais de 48 h, sem preço no título ou que citam mais de uma loja.
- O resultado é uma **PISTA**:
  - passa pelos mesmos filtros (palavras obrigatórias/proibidas, mínimo plausível, preço-alvo, histórico);
  - a mensagem chega como **📰 PISTA DE PROMOÇÃO**, com "preço citado em notícia, não verificado na loja";
  - o link leva à notícia;
  - **nunca entra no histórico de preços** (só preço visto na loja conta);
  - não impede um alerta real da loja para o mesmo produto.
- Custo: 1 consulta por produto ativo a cada execução, respeitando `LIMITE_URLFETCH_DIA`.
- Limitação honesta: notícias com preço no título não saem todo dia para cada produto. Em dias sem notícia, nenhuma pista chega.

Testes: `node testes/teste-gnews.cjs` (8).

## 5.3 Mercado Livre — API oficial com conta de desenvolvedor

### Parte 1: criar a aplicação, conectar e diagnosticar (nada é coletado ainda)

O que o radar vai usar (só leitura): `GET /users/me`, `GET /items/{id}` (anúncio), `GET /products/{id}` (produto de catálogo)
e o login OAuth oficial (`auth.mercadolivre.com.br/authorization` → `api.mercadolibre.com/oauth/token`).
A busca por palavra (`/sites/MLB/search`) também é testada, mas a expectativa é continuar bloqueada.

**A. Criar a aplicação (no computador)**
1. Entre em https://developers.mercadolivre.com.br com a sua conta do Mercado Livre e abra a área de aplicações (DevCenter) → **Criar aplicação**.
2. Preencha nome (ex.: `Radar de Promocoes`), nome curto e descrição (ex.: `Uso pessoal: acompanhar preços de produtos`).
3. **URI de redirect**: `https://www.google.com/` (exatamente assim, com a barra no fim).
4. Permissões/escopos: marque **leitura** e **offline_access** (permite renovar o acesso sozinho). Não marque escrita.
5. Notificações/tópicos: deixe em branco.
6. Salve. Anote o **App ID** (Client ID) e a **Secret Key**. A Secret Key é senha: não compartilhe.
> As telas do DevCenter mudam com frequência; se algum campo estiver diferente, me diga o que aparece.

**B. Guardar no Apps Script** (⚙️ Configurações do projeto → Propriedades do script)
- `ML_APP_ID` = App ID (só números)
- `ML_CLIENT_SECRET` = Secret Key
- `ML_REDIRECT_URI` = `https://www.google.com/`

**C. Instalar o código**: criar o arquivo `MercadoLivre` com `apps-script/MercadoLivre.gs` e atualizar `Menu`.

**D. Conectar**: planilha → F5 → **📡 Radar → 🔗 Conectar Mercado Livre** → clique no link → entre e **Permitir** →
o navegador vai para o Google com `?code=...` no endereço → copie o endereço inteiro → cole na janela → **Conectar**.

**E. Diagnosticar**: cole o link de um anúncio do Mercado Livre na coluna **Links ou IDs monitorados** de um produto
(ex.: P002) → **📡 Radar → 🩺 Diagnosticar Mercado Livre**.

A parte 2 (coleta automática dos anúncios cadastrados) só será escrita conforme o que o diagnóstico mostrar.
Testes: `node testes/teste-ml.cjs` (8).
