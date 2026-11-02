# 📡 Radar Inteligente de Promoções

Monitora ofertas de produtos escolhidos por você em lojas brasileiras e avisa pelo **Telegram**.
Roda de graça com **Google Sheets + Google Apps Script + Telegram Bot API**.

> O projeto está sendo construído em etapas. Cada etapa só é dada como concluída depois de testada.

## Andamento

| Etapa | Assunto | Situação |
|---|---|---|
| 1 | [Arquitetura e fontes de dados](docs/ETAPA-1-ARQUITETURA.md) | ✅ Aprovada |
| 2 | [Bot do Telegram](docs/ETAPA-2-TELEGRAM-BOT.md) | ✅ Teste de envio OK |
| 3 | [Planilha (Google Sheets)](docs/ETAPA-3-PLANILHA.md) | ✅ Validada |
| 4 | [Código do Apps Script](docs/ETAPA-4-CODIGO.md) | ⏳ Em andamento |
| 5 | Fontes de ofertas | — |
| 6 | Filtros inteligentes | — |
| 7 | Integração com Telegram | — |
| 8 | Automação (gatilhos) | — |
| 9 | Testes gerais | — |
| 10 | Implantação e manutenção | — |

## Arquivos para colar no Google Apps Script

Abra a planilha → **Extensões → Apps Script** e crie um arquivo para cada item abaixo, com o mesmo nome:

| Arquivo no Apps Script | Copiar daqui |
|---|---|
| `appsscript.json` (manifesto) | [apps-script/appsscript.json](apps-script/appsscript.json) |
| `Setup.gs` | [apps-script/Setup.gs](apps-script/Setup.gs) |
| `Nucleo.gs` | [apps-script/Nucleo.gs](apps-script/Nucleo.gs) |
| `Telegram.gs` | [apps-script/Telegram.gs](apps-script/Telegram.gs) |
| `Menu.gs` | [apps-script/Menu.gs](apps-script/Menu.gs) |

**Como copiar um arquivo do GitHub:** clique no link → no canto superior direito do código, clique no
ícone de **copiar** (dois quadradinhos, "Copy raw file") → no Apps Script, apague o conteúdo do arquivo e
cole com **Ctrl+V** → salve com **Ctrl+S**.

## Segurança

- O token do bot **nunca** fica no código nem na planilha: vai nas **Propriedades do Script**.
- Não cole seu token em issues, commits ou mensagens.

## Testes locais (opcional, para desenvolvedores)

```bash
node testes/teste-setup.cjs    # estrutura da planilha
node testes/teste-nucleo.cjs   # fluxo completo: classificação, antiduplicidade, Telegram, falhas
```
Simulam a planilha e o Telegram (não substituem o teste real no Google).
