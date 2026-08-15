# 📘 Guia da Ferramenta de Automação de QA (Jira)

Este guia explica, de forma bem simples, como usar a ferramenta que ajuda a **criar, mover e alterar o status** de cenários de teste no Jira em lote — sem precisar fazer tudo manualmente, uma issue de cada vez.

Não precisa saber programar. É só seguir os passos. 🙂

---

## 🗂️ Índice

1. [O que é essa ferramenta](#1-o-que-é-essa-ferramenta)
2. [Passo 1 — Criar seu Token de API do Jira](#2-passo-1--criar-seu-token-de-api-do-jira)
3. [Passo 2 — Abrir a ferramenta](#3-passo-2--abrir-a-ferramenta)
4. [Passo 3 — Preencher email e token](#4-passo-3--preencher-email-e-token)
5. [Aba "Criar Cenários"](#5-aba-criar-cenários)
6. [Aba "Mover Cenários"](#6-aba-mover-cenários)
7. [Aba "Alterar Status"](#7-aba-alterar-status)
8. [Dúvidas comuns e erros](#8-dúvidas-comuns-e-erros)

---

## 1. O que é essa ferramenta

É uma telinha que roda no seu navegador e conversa com o Jira por você. Com ela você consegue:

- **Criar vários cenários de teste (subtarefas) de uma vez** dentro de uma história.
- **Mover cenários** de uma história para outra.
- **Alterar o status** de vários cenários de uma vez (ex: levar tudo para "Pronto para teste").

Tudo o que você faria clicando no Jira várias vezes, aqui você faz em poucos cliques.

---

## 2. Passo 1 — Criar seu Token de API do Jira

O "Token de API" é como uma **senha especial** que a ferramenta usa para acessar o Jira em seu nome. Você cria uma vez e guarda.

> ⚠️ **Importante:** o token é pessoal e secreto, como uma senha. Não compartilhe com ninguém.

### Como criar:

1. Acesse este link (faça login com sua conta Jira/Atlassian se pedir):
   👉 **https://id.atlassian.com/manage-profile/security/api-tokens**

2. Clique no botão **"Create API token"** (Criar token de API).

3. Dê um nome fácil de lembrar, por exemplo: `Ferramenta QA`.

4. Clique em **"Create"** (Criar).

5. Vai aparecer um código grande na tela. Clique em **"Copy"** (Copiar).

6. **Cole esse código em algum lugar seguro** (bloco de notas, gerenciador de senhas). Depois que você fechar a janela, **não dá mais para ver o token de novo** — só criar um novo.

Pronto! Esse código copiado é o seu **API Token**. 🎉

---

## 3. Passo 2 — Abrir a ferramenta

No seu navegador (Chrome, Edge, etc.), acesse:

👉 **http://localhost:3333**

> 💡 Se a página não abrir, avise a pessoa responsável por rodar a ferramenta — ela precisa estar "ligada" no computador/servidor.

Você verá uma tela com **três abas** no topo:

- ➕ **Criar Cenários**
- 📦 **Mover Cenários**
- 🔄 **Alterar Status**

E no canto superior direito tem um botão para trocar entre **tema claro e escuro** 🌙, escolha o que for melhor pros seus olhos.

### 🖥️ E se o endereço não abrir? Ligue o servidor você mesmo

Se `http://localhost:3333` não abrir, é porque a ferramenta não está "ligada". Você mesmo pode ligá-la no seu computador. É tranquilo, siga os passos:

**O que você precisa ter antes (uma vez só):**

1. **Node.js instalado.** Para conferir, abra o terminal e digite `node -v`. Se aparecer um número de versão (ex: `v18.17.1`), está instalado. Se der erro, baixe e instale em 👉 **https://nodejs.org** (versão "LTS").
2. **A pasta da aplicação baixada e atualizada** no seu computador (a pasta `jira-tool`, que contém o arquivo `server.js`). Peça ao time a versão mais recente, ou baixe do repositório.
3. **Uma IDE ou editor** para abrir a pasta (VS Code, Cursor, WebStorm, etc.) — opcional, mas ajuda.

#### 📥 Como instalar o Node.js (se ainda não tiver)

**Jeito 1 — Pelo site (mais simples para leigos):**
1. Acesse 👉 **https://nodejs.org**
2. Clique no botão da versão **"LTS"** (a recomendada/estável).
3. Abra o arquivo baixado e clique em **Next / Avançar** até o fim (pode deixar tudo no padrão).
4. Feche e abra o terminal de novo e confira com `node -v`.

**Jeito 2 — Pelo terminal (CMD/PowerShell) no Windows 10/11:**
1. Abra o **CMD** ou **PowerShell** (ou o terminal da sua IDE).
2. Rode o comando:
   ```
   winget install OpenJS.NodeJS.LTS
   ```
3. Se pedir para aceitar termos, digite `Y` e Enter.
4. Quando terminar, **feche e abra o terminal novamente** (importante para ele reconhecer o Node).
5. Confira com:
   ```
   node -v
   ```
   Se aparecer um número de versão, deu certo. ✅

> 💡 O `winget` já vem instalado no Windows 10/11. Se por acaso não funcionar, use o **Jeito 1** (site).

**Passo a passo para ligar:**

1. Abra a **pasta do projeto** na sua IDE (ex: no VS Code: *Arquivo → Abrir Pasta* e selecione a pasta `jira-tool`).
2. Abra o **terminal integrado** (no VS Code: menu *Terminal → Novo Terminal*). Ou use o terminal do Windows (CMD/PowerShell).
3. Garanta que o terminal está **dentro da pasta `jira-tool`**. Se não estiver, navegue até ela com o comando `cd` e o caminho, por exemplo:
   ```
   cd "C:\Users\seu.usuario\Downloads\jira-tool"
   ```
4. **Só na primeira vez** (para baixar as dependências), rode:
   ```
   npm install
   ```
   Aguarde terminar (pode levar um minutinho).
5. **Ligue o servidor** com:
   ```
   npm start
   ```
6. Deve aparecer a mensagem: `Jira Tool rodando em http://localhost:3333`. 🎉
7. Agora abra **http://localhost:3333** no navegador — a ferramenta estará no ar.

> 💡 **Deixe o terminal aberto** enquanto usa a ferramenta. Se você fechar o terminal (ou apertar `Ctrl + C` nele), o servidor desliga e a página para de funcionar. Para ligar de novo, é só repetir o `npm start`.

> 💡 Se aparecer um erro dizendo que a **porta 3333 já está em uso**, significa que o servidor já está ligado — é só abrir o endereço no navegador.

---

## 4. Passo 3 — Preencher email e token

No topo da tela existem dois campos que valem para **todas as abas**:

| Campo | O que colocar |
|-------|---------------|
| **Email Jira** | O e-mail que você usa para entrar no Jira (ex: `seu.nome@nimbi.com.br`) |
| **API Token** | O código que você copiou no Passo 1 |

Preencha uma vez e pode usar qualquer aba. ✅

> 💡 Esses dados ficam só no seu navegador durante o uso. Se fechar e abrir de novo, talvez precise preencher outra vez.

---

## 4.1 Configurar nomes das seções dos cenários

Em algumas equipes, os QAs usam nomes diferentes para as partes do cenário. Para facilitar esse uso, a ferramenta tem um bloco de configuração escondido por padrão.

### Como usar:
1. Vá até a parte superior da tela, logo abaixo dos campos de email e token.
2. Clique no botão **"Mostrar"**.
3. Você vai ver 3 campos:
   - **Pré-condição**
   - **Ação**
   - **Resultado Esperado**
4. Altere os nomes conforme a convenção da sua equipe.

### Exemplos:
- Pré-condição → `Contexto`
- Ação → `Passos`
- Resultado Esperado → `Resultado`

### O que isso muda:
- a **pré-visualização** vai mostrar os nomes configurados;
- a **descrição no Jira** vai usar esses mesmos nomes;
- o parser continua aceitando os nomes antigos e sinônimos (como `Dado`, `Quando`, `Então`, `Contexto`, `Passos`, `Esperado`), então a ferramenta continua sendo flexível.

> 💡 Se você não mexer nisso, os nomes padrão continuam sendo `Pré-condição`, `Ação` e `Resultado Esperado`.

---

## 5. Aba "Criar Cenários"

Serve para **criar vários cenários de teste (subtarefas)** dentro de uma história de uma vez só.

### Campos:

- **Issue Pai (História):** a chave da história onde os cenários vão ser criados. Ex: `COR-10179`.
- **Tipo de Issue:** normalmente já vem preenchido como `Subtask de teste`. Deixe assim, a menos que te orientem diferente.
- **Status Final:** o status em que os cenários devem ficar depois de criados (ex: `Pronto para teste`). A ferramenta cria e já move o status automaticamente pra você. Se quiser deixá-los como estão, escolha **"Manter no status inicial"**.

### Como escrever os cenários:

No campo grande de texto, cole seus cenários. O formato é bem flexível. Um exemplo:

```
CT-01: Filtro avançado exibido na tela
Pré-condição:
Usuário logado no sistema, tela de Minhas Conexões aberta.
Ação:
Abrir os filtros avançados
Verificar as opções do filtro
Resultado Esperado:
Filtro disponível entre os filtros avançados
Exibe 4 opções

CT-02: Filtrar por ALTO
Pré-condição:
Existem conexões com valores diferentes.
Ação:
Selecionar ALTO
Aplicar
Resultado Esperado:
Lista exibe somente Potencial ALTO
```

**Regras simples:**
- Cada cenário pode começar com um título (`CT-01:`, `Cenário:`, ou até só o texto).
- Se você esquecer o "CT", a ferramenta adiciona um número automaticamente (`CT-01`, `CT-02`...).
- Separe as seções com as palavras **Pré-condição:**, **Ação:** e **Resultado Esperado:** (também aceita variações como "Passos", "Dado", "Quando", "Então").
- Separe um cenário do outro com uma **linha em branco** ou uma linha com `---`.

### Antes de criar — Pré-visualizar 👀

- Clique em **"🔍 Pré-visualizar"** para ver como cada cenário ficou organizado, **antes** de mandar pro Jira.
- Se aparecer um aviso amarelo (ex: "sem Resultado Esperado"), é só um alerta de que faltou algo — você decide se corrige ou segue.
- O botão **"⛶ Expandir editor"** aumenta a área de texto se você tiver muitos cenários.

### Criar:

Quando estiver tudo certo, clique em **"Criar Cenários"**. Acompanhe o resultado no **Log de Execução** (a caixa escura embaixo), que mostra cada cenário criado com sua chave (ex: `COR-10250`).

---

## 6. Aba "Mover Cenários"

Serve para **mudar cenários de uma história para outra**.

### Como usar:

1. No campo **"Nova História Pai de Destino"**, coloque a chave da história para onde os cenários vão (ex: `COR-10200`).

2. Escolha como quer selecionar os cenários usando o **botãozinho de liga/desliga** ("Como deseja selecionar?"):
   - **Desligado (Listar cenários da História):** você informa a **história de origem** (onde os cenários estão hoje) e clica em **Buscar**. A ferramenta lista todos os cenários daquela história.
   - **Ligado (Digitar / Colar Lista de Chaves):** você cola as chaves dos cenários (ex: `COR-10236, COR-10237`) e clica em **Buscar**.

3. A lista de cenários aparece com caixinhas de seleção ✅. Marque os que você quer mover (ou desmarque os que não quer). Dá para filtrar por status também.

4. Clique em **"Mover Cenários Selecionados"**.

Acompanhe o resultado no Log de Execução.

---

## 7. Aba "Alterar Status"

Serve para **mudar o status de vários cenários de uma vez** — e o mais legal: a ferramenta é **inteligente**. Você escolhe o status final desejado, e ela leva cada cenário até lá automaticamente, passando pelos status intermediários necessários.

> **Exemplo:** você quer que tudo fique em "Pronto para teste". Se um cenário está em "Em Construção" e outro em "Especificação Concluída", a ferramenta sabe o caminho de cada um e faz as mudanças na ordem certa, sozinha.

### Como usar:

1. Escolha como quer selecionar as issues no **botão de liga/desliga**:
   - **Desligado (Buscar por História Pai):** informe a história e clique em **Buscar Issues**.
   - **Ligado (Digitar / Colar Lista de Chaves):** cole as chaves das issues e clique em **Buscar Issues**.

2. No campo **"Status desejado (final)"**, escolha para onde você quer levar os cenários (ex: `Pronto para teste`).

3. A lista de issues aparece com caixinhas ✅. Marque as que quer alterar. Dá para filtrar por status atual.

4. Clique em **"🔄 Alterar Status"**.

No Log de Execução você vê o caminho que cada cenário percorreu, por exemplo:
`✅ COR-123 → "Pronto para teste" (Em Construção → Especificação Concluída → Pronto para teste)`

> 💡 No modo de colar lista, a ferramenta mostra **apenas** issues do tipo "Subtask de teste" / "Subtarefa" — as demais são ignoradas automaticamente.

---

## 8. Dúvidas comuns e erros

**❓ Aparece erro de "usuário não identificado" ou erro 401/403.**
Provavelmente o **email** ou o **token** estão errados. Confira se copiou o token completo e se o email é o mesmo do Jira.

**❓ Diz que não encontrou nenhuma issue.**
- Verifique se a chave da história está correta (ex: `COR-10179`).
- No modo "colar lista", confira se as chaves estão certas e separadas por vírgula, espaço ou linha.

**❓ Deu erro de "transição indisponível" ao alterar status.**
Isso significa que o caminho de status daquele cenário no Jira é diferente do esperado. Anote o status que aparece no log e avise o responsável pela ferramenta para ajustar.

**❓ A página http://localhost:3333 não abre.**
A ferramenta precisa estar "rodando" em algum computador. Fale com a pessoa responsável por mantê-la ligada.

**❓ Criei o token mas perdi o código.**
Sem problema: é só criar um token novo no mesmo link e usar o novo. O antigo pode ser apagado.

---

### ✅ Resumindo o dia a dia

1. Preencha **email** e **token** (uma vez).
2. Escolha a aba conforme o que precisa (**Criar**, **Mover** ou **Alterar Status**).
3. Preencha os campos, **busque/pré-visualize**, revise a lista.
4. Clique no botão de ação e acompanhe o **Log de Execução**.

Qualquer dúvida, chame o time responsável pela ferramenta. Bom trabalho! 🚀
