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
