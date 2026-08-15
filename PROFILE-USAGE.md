# 📋 Como Usar a Página de Perfil

## Acessar o Perfil

Depois de fazer login na ferramenta, você verá um botão **"⚙️ Perfil"** no canto superior direito da tela. Clique nele para abrir sua página de configurações pessoais.

---

## O que Você Pode Fazer

### 1️⃣ Ver Seus Dados Pessoais
- **Nome**: seu nome no sistema (definido no cadastro)
- **Email pessoal**: seu email de login (não é editável nesta tela)
- **Data de cadastro**: quando sua conta foi criada

### 2️⃣ Atualizar Credenciais do Jira

Na seção **"🔑 Credenciais do Jira"**, você pode:

**Email Jira:**
- Cole o email que você usa para acessar a API do Jira
- Geralmente é o mesmo que seu email pessoal, mas pode ser diferente
- Exemplos: `seu.nome@nimbi.com.br`, `qa.teste@empresa.com.br`

**Domínio Jira:**
- O endereço do seu servidor Jira
- Padrão: `nimbi-portal.atlassian.net`
- Se sua empresa usa outro domínio, atualize aqui

**Novo Token Jira:**
- 🚨 **Campo opcional**: deixe em branco se quer manter o token atual
- 📝 **Como usar**: 
  1. Se você perdeu ou quer trocar seu token por segurança, gere um novo em:
     👉 https://id.atlassian.com/manage-profile/security/api-tokens
  2. Cole o novo token aqui
  3. O token anterior será **automaticamente descartado** e substituído

### 3️⃣ Confirmar Alterações

Todas as alterações de credenciais Jira exigem que você confirme com sua **senha pessoal** por segurança.

**Passos:**
1. Preencha o(s) campo(s) que quer alterar
2. Cole sua senha pessoal no campo **"Senha Atual"**
3. Clique em **"✓ Salvar Alterações"**
4. Pronto! Os dados foram atualizados

---

## 🔐 Mudar Sua Senha Pessoal

Na mesma página de perfil, há um link **"Mudar Senha"** na seção **"🔐 Segurança"**.

Clique nele para abrir a página de mudança de senha, onde você pode:

1. **Senha Atual**: digite sua senha de login atual (para validação)
2. **Nova Senha**: crie uma senha forte
3. **Confirmar Nova Senha**: repita a nova senha
4. Clique em **"Mudar Senha"**

### Dicas de Senha Forte
✅ Use pelo menos 6 caracteres
✅ Misture letras maiúsculas, minúsculas, números e símbolos
✅ Evite senhas óbvias como datas de nascimento ou nomes

---

## 🔒 Segurança dos Seus Dados

- Sua **senha pessoal** é guardada com criptografia forte (hash bcryptjs)
- Seu **token do Jira** é criptografado no servidor (AES-256-GCM) e nunca é exposto no navegador
- Todas as alterações de credenciais exigem validação com sua senha

---

## ❓ Perguntas Frequentes

**P: Posso editar meu nome ou email pessoal aqui?**
R: Não nesta versão. Se precisar mudar seu nome ou email, avise o administrador.

**P: E se eu esquecer minha senha pessoal?**
R: Será necessário resetar sua conta. Entre em contato com o administrador.

**P: Se eu colocar um novo token, o antigo continua funcionando?**
R: Não. Quando você salva um novo token, o antigo é imediatamente **descartado** e não funciona mais. Isso aumenta a segurança da sua conta.

**P: Onde meu token do Jira fica armazenado?**
R: Fica armazenado no servidor, **criptografado e protegido**, e **nunca aparece no seu navegador** (nem em Inspecionar/DevTools).

**P: Posso restaurar um token antigo?**
R: Não. Uma vez substituído, ele é perdido. Se precisar de outro token, crie um novo em https://id.atlassian.com/manage-profile/security/api-tokens e adicione aqui.

---

## 🆘 Problemas?

Se algo não funcionar:
1. Verifique sua conexão com a internet
2. Confirme que a senha está correta
3. Se o token não funcionar, tente gerar um novo no Jira
4. Avise o administrador da ferramenta se o erro persistir

---

**Última atualização:** Agosto 2026
**Versão da ferramenta:** V2.0
