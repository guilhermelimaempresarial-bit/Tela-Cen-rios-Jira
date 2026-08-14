# Prompt / Guia de QA — Nimbi

> Documento reutilizável com convenções de **criação de cenários de teste**, **automação em Playwright** e **contexto da Nimbi**.
> Use como prompt de sistema para uma IA assistente, como onboarding de QA, ou como steering file.
>
> **Legenda:** trechos marcados com `[PREENCHER]` são conhecimento interno que precisa ser confirmado/completado por você — não foram assumidos para evitar informação incorreta.

---

## 1. Contexto da empresa (Nimbi)

- **Domínio Jira:** `nimbi-portal.atlassian.net`
- **Padrão de e-mail:** `nome.sobrenome@nimbi.com.br`
- **Autenticação nas APIs:** e-mail + API Token (Basic Auth, header `Authorization: Basic base64(email:token)`).
- **Produtos/áreas observados no projeto:**
  - **Certifica+** — módulo com tela de **"Minhas Conexões"** e filtros avançados (ex.: filtro por **Potencial ALTO**).
  - `[PREENCHER: demais produtos/módulos, ex.: marketplace, portal de compras, etc.]`
- **Projeto Jira exemplo:** `COR` (chaves no formato `COR-10179`).
- `[PREENCHER: outros projetos/board keys usados pela equipe]`
- `[PREENCHER: descrição do negócio da Nimbi — o que a empresa faz, principais clientes, domínio (procurement/e-commerce B2B?)]`
- `[PREENCHER: ambientes — URLs de dev / homologação / produção]`

---

## 2. Convenções de cenários de teste

### 2.1 Identificação
- Todo cenário tem um **título com prefixo `CT-XX`** (Caso de Teste), numeração sequencial com 2 dígitos: `CT-01`, `CT-02`...
- Se o título vier sem `CT`, o prefixo deve ser **adicionado automaticamente** (`Filtro exibido` → `CT-01: Filtro exibido`).
- Título já iniciado com `CT` (`CT-01`, `CT01`, `CT 01`, `CT:`) é preservado como está.

### 2.2 Estrutura (3 seções obrigatórias)
Cada cenário tem exatamente três blocos:

```
CT-01: <título curto e objetivo>
Pré-condição:
<contexto necessário antes de executar o teste>
Ação:
<passo 1>
<passo 2>
Resultado Esperado:
<resultado 1>
<resultado 2>
```

- **Pré-condição** — estado/contexto inicial (texto corrido).
- **Ação** — passos executados (lista, um por linha).
- **Resultado Esperado** — o que deve acontecer (lista, um por linha).

### 2.3 Formatos de entrada aceitos (parser tolerante)
A ferramenta interpreta variações, então o cenário pode ser escrito de forma "livre":
- **Sinônimos de seção:**
  - Pré-condição → `Pré-condição`, `Pré-requisito`, `Contexto`, `Setup`, `Dado`/`Given`
  - Ação → `Ação`, `Passos`, `Procedimento`, `Steps`, `Quando`/`When`
  - Resultado → `Resultado Esperado`, `Esperado`, `Critério de aceite`, `Então`/`Then`
- **Gherkin** (`Dado / Quando / Então`, com `E`/`And` herdando a seção anterior).
- **Título opcional:** aceita `CT-01:`, `Cenário:`, `1.` ou nada (gera `CT-XX` automático).
- **Separadores de cenário:** linha em branco, `---`, ou um novo título.
- **JSON direto:** um array de objetos `{ summary, precondition, action[], expected[] }`.

### 2.4 Boas práticas de escrita
- Título objetivo, focado em **um comportamento** por cenário.
- Pré-condição sem ambiguidade (usuário, tela, dados existentes).
- Ações no imperativo e atômicas ("Abrir filtros", "Selecionar ALTO", "Aplicar").
- Resultados verificáveis e específicos ("Lista exibe somente Potencial ALTO").
- Evitar juntar validações não relacionadas no mesmo CT.

---

## 3. Fluxo no Jira (ferramenta interna)

Ferramenta web (`jira-tool`) com proxy Node/Express (evita CORS) e front estático. Três funções:

### 3.1 Criar cenários
- Cria **subtarefas** vinculadas a uma **História pai** (`parentKey`, ex.: `COR-10179`).
- Campos aplicados na criação:
  - `project.key` = prefixo da chave pai (ex.: `COR`)
  - `parent.key` = história pai
  - `issuetype.name` = **`Subtask de teste`**
  - `assignee.accountId` = usuário autenticado (obtido via `/rest/api/3/myself`)
  - `components` = **`QA`**
  - `description` = **ADF** (Atlassian Document Format) com 3 painéis
- **Ordem de criação preservada** (criação sequencial).

### 3.2 Descrição em ADF (estrutura dos painéis)
| Seção | `panelType` | Layout |
|-------|-------------|--------|
| Pré-condição | `warning` | rótulo em negrito + texto na linha de baixo |
| Ação | `note` | rótulo + `bulletList` |
| Resultado Esperado | `success` | rótulo + `bulletList` |

### 3.3 Transições de status (IDs)
Aplicadas em sequência após a criação:

| ID | Status |
|----|--------|
| `71` | Em Construção |
| `81` | Especificação Concluída |
| `131` | Pronto para teste |

- "Status Final = Pronto para teste" aplica a sequência `71 → 81 → 131`.
- Transições rodam **em paralelo entre issues** (limite ~5), mas **em ordem dentro de cada issue**.
- `[PREENCHER: IDs de transição de outros workflows/projetos além do COR]`

### 3.4 Endpoints Jira usados
- `GET  /rest/api/3/myself` — obter `accountId`.
- `POST /rest/api/3/issue` — criar subtarefa.
- `POST /rest/api/3/issue/{key}/transitions` — mover status.
- `PUT  /rest/api/3/issue/{key}` (campo `parent`) — mover cenário para outra história.
- `GET  /rest/api/3/issue/{key}?fields=subtasks,summary,status` — listar/inspecionar.
- `GET  /rest/api/3/issue/{key}/transitions` — transições disponíveis.

### 3.5 Cuidados operacionais
- Sem pausas artificiais, um volume grande pode gerar **HTTP 429 (rate limit)** — nesse caso, reduzir concorrência ou reintroduzir pequeno delay.
- Nunca commitar e-mail/API Token; tratar como segredo.

---

## 4. Automação de testes com Playwright

> Guia de boas práticas recomendado (a equipe ainda deve validar/ajustar ao stack real).
> `[PREENCHER: se já existe um repo de automação, apontar caminho e padrões vigentes]`

### 4.1 Setup base
```bash
npm init playwright@latest
# escolher TypeScript, pasta tests/, GitHub Actions opcional
```

Estrutura sugerida:
```
tests/
  e2e/
    certifica-mais/
      minhas-conexoes.spec.ts
  fixtures/
  pages/            # Page Object Model
playwright.config.ts
```

### 4.2 Princípios
- **Page Object Model (POM):** encapsular seletores e ações por tela.
- **Seletores resilientes:** preferir `getByRole`, `getByLabel`, `getByTestId` a XPath/CSS frágil.
- **Isolamento:** cada teste cria/reseta seu próprio estado; evitar dependência de ordem.
- **Espera automática:** usar as asserções web-first do Playwright (`expect(locator).toBeVisible()`), evitar `waitForTimeout`.
- **Dados/segredos:** ambientes e credenciais via variáveis de ambiente (`.env`, secrets do CI), nunca hardcoded.

### 4.3 Mapeando um CT para um teste Playwright
Cenário:
```
CT-02: Filtrar por ALTO
Pré-condição: Existem conexões com diferentes valores de potencial.
Ação: Selecionar ALTO; Aplicar.
Resultado Esperado: Lista exibe somente Potencial ALTO.
```

Teste correspondente:
```typescript
import { test, expect } from '@playwright/test';
import { MinhasConexoesPage } from '../pages/MinhasConexoesPage';

test.describe('Certifica+ · Minhas Conexões · Filtros', () => {
  test('CT-02: filtrar por Potencial ALTO exibe somente conexões ALTO', async ({ page }) => {
    const conexoes = new MinhasConexoesPage(page);

    // Pré-condição
    await conexoes.irParaMinhasConexoes();
    await expect(conexoes.listaConexoes).toBeVisible();

    // Ação
    await conexoes.abrirFiltrosAvancados();
    await conexoes.selecionarPotencial('ALTO');
    await conexoes.aplicarFiltros();

    // Resultado Esperado
    const potenciais = await conexoes.potenciaisVisiveis();
    expect(potenciais.every(p => p === 'ALTO')).toBeTruthy();
  });
});
```

### 4.4 Convenções de nomenclatura
- Nome do teste começa com o **código do CT** para rastreabilidade: `test('CT-02: ...')`.
- Um arquivo `.spec.ts` por tela/funcionalidade.
- `[PREENCHER: convenção de tags/anotações se usarem — @smoke, @regression, etc.]`

---

## 5. Prompt reutilizável (cole em uma IA assistente)

```
Você é um assistente de QA da Nimbi. Siga estas convenções:

CENÁRIOS DE TESTE
- Todo caso de teste tem título "CT-XX: <título>" (numeração sequencial de 2 dígitos).
- Se o título não tiver "CT", adicione o prefixo automaticamente.
- Estrutura obrigatória: Pré-condição (contexto), Ação (passos, um por linha),
  Resultado Esperado (resultados verificáveis, um por linha).
- Aceite variações: sinônimos de seção e formato Gherkin (Dado/Quando/Então).
- Um comportamento por cenário; resultados específicos e verificáveis.

JIRA
- Cenários viram subtarefas ("Subtask de teste"), componente "QA", vinculadas a uma
  História pai (ex.: COR-10179), assignee = usuário autenticado.
- Descrição em ADF com 3 painéis: warning (Pré-condição), note (Ação), success (Resultado).
- Transições: 71=Em Construção, 81=Especificação Concluída, 131=Pronto para teste.
- Preserve a ordem de criação; cuidado com rate limit (429).

PLAYWRIGHT
- Use TypeScript + Page Object Model, seletores por role/label/testid, asserções web-first.
- Nomeie testes começando pelo código do CT para rastreabilidade.
- Segredos e ambientes via variáveis de ambiente.

CONTEXTO
- Jira: nimbi-portal.atlassian.net · e-mail @nimbi.com.br · produto Certifica+
  (tela "Minhas Conexões", filtros por potencial ALTO).
- [Complete com detalhes internos da Nimbi conforme necessário.]
```

---

## 6. Itens a completar (checklist)
- [ ] Descrição do negócio e produtos da Nimbi.
- [ ] URLs de ambientes (dev/homolog/prod).
- [ ] IDs de transição de outros projetos/workflows.
- [ ] Repositório e padrões de automação Playwright existentes.
- [ ] Convenção de tags de teste (smoke/regression/etc.).
- [ ] Políticas de dados de teste e credenciais no CI.
