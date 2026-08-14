# Requirements Document

## Introduction

A tela "Criar Cenários" é a funcionalidade principal do Jira Tools que permite a criação em lote de subtarefas de cenários de teste no Jira. O usuário fornece credenciais, seleciona configurações da issue pai e cola cenários de teste em formato textual estruturado. O sistema parseia o texto, cria subtarefas no Jira com descrições formatadas em ADF (Atlassian Document Format) e aplica transições de status sequenciais nas issues criadas.

## Glossary

- **Sistema_Criacao**: Módulo responsável pela criação de cenários de teste como subtarefas no Jira
- **Parser_Cenarios**: Componente que interpreta o texto dos cenários e extrai dados estruturados (título, pré-condição, ação, resultado esperado)
- **Proxy_Jira**: Servidor backend Express que encaminha requisições para a API REST do Jira, evitando bloqueios de CORS
- **ADF_Builder**: Componente que converte dados estruturados dos cenários em formato Atlassian Document Format para a descrição das issues
- **Cenario**: Bloco de texto que representa um caso de teste, contendo título (CT-XX), pré-condição, ação e resultado esperado
- **Issue_Pai**: História ou tarefa no Jira que será a parent das subtarefas de cenários criadas
- **Transicao_Status**: Mudança de estado (workflow transition) aplicada sequencialmente às issues criadas no Jira

## Requirements

### Requirement 1: Autenticação e credenciais do usuário

**User Story:** Como um QA, eu quero informar minhas credenciais do Jira uma vez, para que todas as operações de criação utilizem minha autenticação.

#### Acceptance Criteria

1. THE Sistema_Criacao SHALL exibir campos de entrada para email e API token do Jira no topo da interface
2. WHEN o usuário preenche email e token, THE Proxy_Jira SHALL utilizar autenticação Basic Auth (base64 de email:token) em todas as requisições para a API do Jira
3. IF o email ou o token estiver vazio ao tentar criar cenários, THEN THE Sistema_Criacao SHALL exibir mensagem de erro no log indicando campos obrigatórios
4. THE Sistema_Criacao SHALL mascarar o campo de API token com tipo password para proteger a credencial visualmente

### Requirement 2: Configuração da issue pai e tipo de issue

**User Story:** Como um QA, eu quero configurar a issue pai e o tipo de issue, para que os cenários sejam criados como subtarefas vinculadas à história correta.

#### Acceptance Criteria

1. THE Sistema_Criacao SHALL exibir um campo de texto para informar a chave da Issue Pai (formato PROJETO-NUMERO, ex: COR-10179)
2. THE Sistema_Criacao SHALL exibir um campo de texto para o tipo de issue com valor padrão "Subtask de teste"
3. IF a chave da Issue Pai estiver vazia ao tentar criar cenários, THEN THE Sistema_Criacao SHALL exibir mensagem de erro "Preencha a Issue Pai" no log
4. WHEN o usuário informa a chave da Issue Pai, THE Sistema_Criacao SHALL extrair a chave do projeto a partir do prefixo antes do hífen (ex: "COR" de "COR-10179")

### Requirement 3: Seleção de transições de status

**User Story:** Como um QA, eu quero selecionar o status final desejado para os cenários, para que após a criação as issues já estejam no estado correto do workflow.

#### Acceptance Criteria

1. THE Sistema_Criacao SHALL exibir um campo de seleção (dropdown) com as opções de status final disponíveis
2. THE Sistema_Criacao SHALL oferecer a opção "Manter no status inicial" (sem transição) como primeira opção
3. THE Sistema_Criacao SHALL oferecer as opções "Em Construção" (ID 71), "Especificação Concluída" (IDs 71,81) e "Pronto para teste" (IDs 71,81,131)
4. THE Sistema_Criacao SHALL pré-selecionar a opção "Pronto para teste" como valor padrão
5. WHEN uma opção de status final com múltiplas transições é selecionada, THE Sistema_Criacao SHALL aplicar as transições em ordem sequencial (ex: 71 → 81 → 131)

### Requirement 4: Parsing de cenários em formato texto

**User Story:** Como um QA, eu quero colar cenários de teste em formato textual estruturado, para que o sistema extraia automaticamente título, pré-condição, ações e resultados esperados.

#### Acceptance Criteria

1. THE Sistema_Criacao SHALL exibir uma área de texto (textarea) para o usuário colar os cenários de teste
2. WHEN o texto contém blocos iniciados por "CT-XX:" (onde XX são dígitos), THE Parser_Cenarios SHALL identificar cada bloco como um cenário individual
3. WHEN um bloco de cenário é identificado, THE Parser_Cenarios SHALL extrair o título da primeira linha (incluindo o prefixo CT-XX)
4. WHEN um bloco contém a seção "Pré-condição:", THE Parser_Cenarios SHALL extrair todo o texto subsequente até a próxima seção como pré-condição
5. WHEN um bloco contém a seção "Ação:", THE Parser_Cenarios SHALL extrair cada linha subsequente até a próxima seção como um item de ação individual
6. WHEN um bloco contém a seção "Resultado Esperado:", THE Parser_Cenarios SHALL extrair cada linha subsequente até o próximo cenário como um item de resultado esperado individual
7. IF nenhum cenário válido for encontrado no texto, THEN THE Sistema_Criacao SHALL exibir mensagem de erro informando que nenhum cenário foi encontrado e orientar sobre o formato esperado
8. THE Parser_Cenarios SHALL reconhecer variações de acentuação nas seções (pré-condição, pre-condicao, pré-condição)

### Requirement 5: Construção da descrição em ADF

**User Story:** Como um QA, eu quero que os cenários criados tenham descrições formatadas com painéis visuais no Jira, para que a leitura seja clara e padronizada.

#### Acceptance Criteria

1. WHEN um cenário é processado, THE ADF_Builder SHALL gerar um documento ADF versão 1 com tipo "doc"
2. THE ADF_Builder SHALL formatar a pré-condição dentro de um painel do tipo "warning" com rótulo em negrito "Pré-condição:"
3. THE ADF_Builder SHALL formatar as ações dentro de um painel do tipo "note" com rótulo em negrito "Ação:" e cada ação como item de lista não-ordenada (bulletList)
4. THE ADF_Builder SHALL formatar os resultados esperados dentro de um painel do tipo "success" com rótulo em negrito "Resultado Esperado:" e cada resultado como item de lista não-ordenada (bulletList)

### Requirement 6: Criação de subtarefas no Jira

**User Story:** Como um QA, eu quero que o sistema crie automaticamente as subtarefas no Jira, para que eu não precise criar manualmente cada cenário de teste.

#### Acceptance Criteria

1. WHEN o botão "Criar Cenários" é clicado, THE Sistema_Criacao SHALL buscar o accountId do usuário autenticado via endpoint /rest/api/3/myself
2. IF a busca do accountId falhar, THEN THE Sistema_Criacao SHALL exibir mensagem de erro orientando verificar email e token
3. WHEN o accountId é obtido com sucesso, THE Sistema_Criacao SHALL criar cada cenário como uma issue via POST /rest/api/3/issue com os campos: project, parent, summary, issuetype, assignee, components e description
4. THE Sistema_Criacao SHALL atribuir o componente "QA" a cada subtarefa criada
5. THE Sistema_Criacao SHALL atribuir o usuário autenticado (accountId) como assignee de cada subtarefa
6. THE Sistema_Criacao SHALL aguardar 500ms entre cada criação de issue para evitar rate limiting da API do Jira
7. WHEN uma issue é criada com sucesso, THE Sistema_Criacao SHALL registrar no log a chave da issue criada (ex: "OK: COR-10240")
8. IF a criação de uma issue falhar, THEN THE Sistema_Criacao SHALL registrar no log o código de status HTTP e a resposta de erro da API

### Requirement 7: Aplicação de transições de status após criação

**User Story:** Como um QA, eu quero que as transições de status sejam aplicadas automaticamente após a criação, para que os cenários já fiquem no estado correto sem intervenção manual.

#### Acceptance Criteria

1. WHEN todas as issues são criadas e uma opção de status final foi selecionada (diferente de "Manter no status inicial"), THE Sistema_Criacao SHALL aplicar as transições sequencialmente em cada issue criada
2. WHEN uma transição é aplicada, THE Sistema_Criacao SHALL enviar POST para /rest/api/3/issue/{key}/transitions com o ID da transição
3. THE Sistema_Criacao SHALL aguardar 300ms entre cada aplicação de transição para evitar rate limiting
4. WHEN uma transição é aplicada com sucesso (status 204), THE Sistema_Criacao SHALL registrar "OK" no log
5. IF uma transição falhar, THEN THE Sistema_Criacao SHALL registrar o código de status e a resposta de erro no log
6. THE Sistema_Criacao SHALL aplicar todas as transições na ordem configurada para cada issue antes de prosseguir para a próxima transição

### Requirement 8: Feedback visual e log de execução

**User Story:** Como um QA, eu quero acompanhar o progresso da criação em tempo real, para que eu saiba quais cenários foram criados com sucesso e quais falharam.

#### Acceptance Criteria

1. THE Sistema_Criacao SHALL exibir um painel de log de execução com fundo escuro e fonte monoespaçada
2. WHEN o processo de criação inicia, THE Sistema_Criacao SHALL limpar o conteúdo anterior do log
3. THE Sistema_Criacao SHALL exibir no log o progresso com indicador numérico (ex: "[1/5] Criando: CT-01...")
4. WHILE o processo de criação está em execução, THE Sistema_Criacao SHALL desabilitar o botão "Criar Cenários" para evitar submissões duplicadas
5. WHEN o processo é concluído, THE Sistema_Criacao SHALL exibir mensagem "✅ Concluído!" no log e reabilitar o botão
6. THE Sistema_Criacao SHALL manter o scroll automático do log para a última mensagem adicionada

### Requirement 9: Proxy backend para API do Jira

**User Story:** Como um QA, eu quero que a ferramenta funcione diretamente no navegador, para que eu não precise de configurações especiais de CORS ou extensões.

#### Acceptance Criteria

1. THE Proxy_Jira SHALL aceitar requisições POST no endpoint /api/jira com os campos: email, token, domain, method, endpoint e body
2. IF os campos obrigatórios (email, token, domain, endpoint) estiverem ausentes, THEN THE Proxy_Jira SHALL retornar status 400 com mensagem de erro descritiva
3. WHEN uma requisição válida é recebida, THE Proxy_Jira SHALL encaminhar a requisição para a API do Jira no domínio "nimbi-portal.atlassian.net" usando HTTPS
4. THE Proxy_Jira SHALL retransmitir o código de status HTTP e o corpo da resposta da API do Jira para o cliente
5. IF ocorrer um erro de conexão com a API do Jira, THEN THE Proxy_Jira SHALL retornar status 500 com a mensagem de erro
6. THE Proxy_Jira SHALL aceitar payloads de até 5MB para suportar cenários com grande volume de texto
