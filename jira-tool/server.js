
global.WebSocket = require('ws')
require('dotenv').config();

global.crypto = require('crypto');

const express = require('express');
const session = require('express-session');
const https = require('https');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const path = require('path');

// 💡 ARQUITETURA SÊNIOR: Sai Mongoose, Entra Supabase SDK
const { createClient } = require('@supabase/supabase-js');

const app = express();
const PORT = process.env.PORT || 3333;
const SESSION_SECRET = process.env.SESSION_SECRET || 'jira-tool-dev-secret-change-me';
const TOKEN_KEY = process.env.TOKEN_ENCRYPTION_KEY || 'jira-tool-token-key-32bytes-long';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'guilherme.lima@nimbi.com.br').trim().toLowerCase();

// ==============================================================
// ☁️ CONEXÃO COM O SUPABASE (POSTGRESQL)
// ==============================================================
if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
  console.error('❌ ERRO CRÍTICO: Variáveis do Supabase (URL ou ROLE KEY) não encontradas no .env');
  process.exit(1);
}

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
console.log('✅ Conectado com sucesso ao Supabase/PostgreSQL!');

// 🛠️ ADAPTERS: Funções auxiliares para imitar o comportamento do Mongoose e não quebrar as rotas
async function findUser(field, value) {
  const { data, error } = await supabase.from('users').select('*').eq(field, value).single();
  if (error && error.code !== 'PGRST116') console.error(`Erro ao buscar usuário por ${field}:`, error.message);
  return data; // Retorna null se não achar (PGRST116 = zero rows)
}

async function updateUser(id, updates) {
  // O campo updatedAt é atualizado automaticamente pelo Trigger no banco
  const { error } = await supabase.from('users').update(updates).eq('id', id);
  if (error) throw error;
}

// ==============================================================
// 🔒 LOCK DE LOGIN E CRIPTOGRAFIA
// ==============================================================
const userLoginLocks = new Map();

async function withUserLoginLock(email, callback) {
  const key = String(email || '').trim().toLowerCase();
  const previous = userLoginLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => { release = resolve; });
  userLoginLocks.set(key, current);

  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (userLoginLocks.get(key) === current) userLoginLocks.delete(key);
  }
}

function getEncryptionKey() {
  return crypto.createHash('sha256').update(String(TOKEN_KEY)).digest();
}

function encryptToken(value) {
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', getEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value || ''), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, encrypted]).toString('base64');
}

function decryptToken(value) {
  if (!value) return '';
  try {
    const raw = Buffer.from(String(value), 'base64');
    const iv = raw.subarray(0, 16);
    const tag = raw.subarray(16, 32);
    const encrypted = raw.subarray(32);
    const decipher = crypto.createDecipheriv('aes-256-gcm', getEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch (error) { return ''; }
}

// ==============================================================
// ⚙️ CONFIGURAÇÕES DO EXPRESS E MIDDLEWARES
// ==============================================================
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'lax', secure: false, maxAge: 1000 * 60 * 60 * 8 },
}));
app.use(express.static(path.join(__dirname, 'public')));

async function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado. Faça login na aplicação.' });
  }

  const user = await findUser('id', req.session.userId);
  const timeSessao = req.session.loginTime || 0;
  const timeUpdate = user?.updatedAt ? new Date(user.updatedAt).getTime() : 0;

  if (!user || user.loginBlocked || timeUpdate > timeSessao) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Sessão invalidada por motivos de segurança. Faça login novamente.' });
  }

  if (user.requirePasswordChange && !req.path.includes('/change-password')) {
    return res.status(403).json({ error: 'Ação bloqueada. Você precisa alterar sua senha obrigatória.' });
  }

  next();
}

async function requireAdmin(req, res, next) {
  const user = await findUser('id', req.session.userId);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }
  next();
}

async function requireAuthPage(req, res, next) {
  if (!req.session || !req.session.userId) return res.redirect('/login.html');
  
  const user = await findUser('id', req.session.userId);
  const timeSessao = req.session.loginTime || 0;
  const timeUpdate = user?.updatedAt ? new Date(user.updatedAt).getTime() : 0;

  if (!user || user.loginBlocked || timeUpdate > timeSessao) {
    req.session.destroy(() => {});
    return res.redirect('/login.html');
  }
  
  if (user.requirePasswordChange && req.path !== '/change-password.html') {
    return res.redirect('/change-password.html?forced=1');
  }
  
  next();
}

async function requireAdminPage(req, res, next) {
  const user = await findUser('id', req.session.userId);
  if (!user || user.role !== 'admin') return res.redirect('/');
  next();
}

// ==============================================================
// 🌐 ROTAS DE PÁGINAS (HTML)
// ==============================================================
app.get('/login.html', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/profile.html', requireAuthPage, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'profile.html')));
app.get('/change-password.html', requireAuthPage, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'change-password.html')));
app.get('/admin', requireAuthPage, requireAdminPage, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/admin.html', requireAuthPage, requireAdminPage, (_req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/', requireAuthPage, (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ==============================================================
// 🔑 ROTAS DE AUTENTICAÇÃO E SESSÃO
// ==============================================================
app.get('/api/auth/session', async (req, res) => {
  if (!req.session || !req.session.userId) return res.json({ authenticated: false });
  const user = await findUser('id', req.session.userId);
  
  const timeSessao = req.session.loginTime || 0;
  const timeUpdate = user?.updatedAt ? new Date(user.updatedAt).getTime() : 0;

  if (!user || user.loginBlocked || timeUpdate > timeSessao) {
    req.session.destroy(() => {});
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    user: {
      id: user.id, name: user.name, username: user.username, jiraEmail: user.jiraEmail,
      requirePasswordChange: Boolean(user.requirePasswordChange),
      role: user.role, createdAt: user.createdAt, mfaEnabled: Boolean(user.mfaEnabled),
    },
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { username, password, mfaCode } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username e senha são obrigatórios.' });
  const normalizedUsername = String(username).trim().toLowerCase();

  await withUserLoginLock(normalizedUsername, async () => {
    const user = await findUser('username', normalizedUsername);
    if (!user || Boolean(user.loginBlocked)) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const newAttempts = Number(user.loginAttempts || 0) + 1;
      const updates = { loginAttempts: newAttempts };
      if (newAttempts >= 5) {
        updates.loginBlocked = true;
        updates.lockedAt = new Date().toISOString();
      }
      await updateUser(user.id, updates);
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    // Reseta tentativas falhas
    await updateUser(user.id, { loginAttempts: 0, loginBlocked: false, lockedAt: null });

    if (!user.mfaEnabled) {
      if (!mfaCode) {
        const secret = speakeasy.generateSecret({ length: 20, name: 'Jira Tool - Nimbi' });
        const qrCode = await QRCode.toDataURL(secret.otpauth_url);
        req.session.pendingMfaLogin = { userId: user.id, mfaSecret: secret.base32 };
        return res.status(200).json({ success: false, requiresMfaSetup: true, qrCode, message: 'Configure o MFA para continuar.' });
      }
      const pending = req.session.pendingMfaLogin;
      if (!pending || pending.userId !== user.id) return res.status(401).json({ error: 'Sessão expirada.', requiresMfaSetup: true });
      
      const valid = speakeasy.totp.verify({ secret: pending.mfaSecret, encoding: 'base32', token: String(mfaCode).trim(), window: 1 });
      if (!valid) return res.status(401).json({ error: 'Código MFA inválido.', requiresMfaSetup: true });

      await updateUser(user.id, { 
        mfaEnabled: true, 
        mfaSecretEncrypted: encryptToken(pending.mfaSecret)
      });
      req.session.pendingMfaLogin = null;
    } else if (!mfaCode) {
      return res.status(401).json({ error: 'Código MFA obrigatório.', requiresMfa: true });
    } else {
      const secret = decryptToken(user.mfaSecretEncrypted);
      const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: String(mfaCode).trim(), window: 1 });
      if (!valid) return res.status(401).json({ error: 'Código MFA inválido.', requiresMfa: true });
    }

    req.session.userId = user.id;
    req.session.loginTime = Date.now();
    
    return res.json({
      success: true, requirePasswordChange: Boolean(user.requirePasswordChange),
      user: { id: user.id, name: user.name, username: user.username, role: user.role, mfaEnabled: true }
    });
  });
});

app.post('/api/auth/validate-password', async (req, res) => {
  const { username, password } = req.body || {};
  if (!username || !password) return res.status(400).json({ error: 'Username e senha são obrigatórios.' });
  const user = await findUser('username', String(username).trim().toLowerCase());
  if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) return res.status(401).json({ error: 'Senha incorreta.' });
  return res.json({ success: true, message: 'Senha validada.' });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => { res.json({ success: true }); });
});
// ==============================================================
// 🤖 ROTA DA INTELIGÊNCIA ARTIFICIAL (GEMINI)
// ==============================================================
const { GoogleGenerativeAI } = require('@google/generative-ai');
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

app.post('/api/ai/generate', requireAuth, async (req, res) => {
  // 1. Extrai o texto e a imagem (se houver) do body
  const { promptUser, image } = req.body; 
  if (!promptUser && !image) return res.status(400).json({ error: 'Prompt e imagem vazios' });

  try {
    const model = genAI.getGenerativeModel({ model: "gemini-3.6-flash" });
    const systemPrompt = `Você é um Analista de QA Sênior. 
    O usuário pedirá para você criar cenários de teste baseados em uma funcionalidade, imagem ou documento.
    Você DEVE retornar a resposta EXCLUSIVAMENTE em formato JSON, sendo um Array de objetos.
    Não use formatação Markdown como \`\`\`json. Apenas o texto do array.
    Estrutura obrigatória de cada objeto:
    [
      {
        "summary": "CT-01: Título do Cenário",
        "precondition": "Texto da pré-condição",
        "action": ["Passo 1", "Passo 2"],
        "expected": ["Resultado 1", "Resultado 2"]
      }
    ]`;

    // 💡 ARQUITETURA MULTIMODAL: Monta as peças do quebra-cabeça
    const contentParts = [
      systemPrompt,
      `Pedido do usuário: ${promptUser || 'Analise o arquivo anexado e gere cenários.'}`
    ];

    if (image && image.data && image.mimeType) {
      contentParts.push({
        inlineData: {
          data: image.data,
          mimeType: image.mimeType
        }
      });
    }

    // Passa o array de partes em vez de apenas texto
    const result = await model.generateContent(contentParts);
    const textoResposta = result.response.text();
    
    // Higieniza o retorno teimoso do Gemini
    const cleanText = textoResposta.replace(/```json/gi, '').replace(/```/g, '').trim();
    const cenariosJson = JSON.parse(cleanText);
    
    res.json({ success: true, cenarios: cenariosJson });
 } catch (error) {
    console.error('Erro na IA:', error);
    
    // 💡 LÓGICA SÊNIOR DE UX: Intercepta o 429 (Limite de Cota)
    if (error.status === 429 || error.message.includes('429')) {
      return res.status(429).json({ 
        error: 'Você atingiu o limite de uso gratuito da IA (muitas requisições seguidas). Aguarde um minuto e tente novamente! ⏳' 
      });
    }

    // Intercepta o 503 (Servidor Lotado)
    if (error.status === 503 || error.message.includes('503')) {
      return res.status(503).json({ 
        error: 'A Inteligência Artificial do Google está com muita demanda agora. Aguarde uns 10 segundos e clique em Gerar novamente! ⏳' 
      });
    }

    res.status(500).json({ error: `Falha na IA: ${error.message}` });
  }
});

// ==============================================================
// 🛡️ ROTAS DE PERFIL E MFA
// ==============================================================
app.post('/api/auth/setup-mfa', requireAuth, async (req, res) => {
  const user = await findUser('id', req.session.userId);
  const { password, confirmChange } = req.body || {};
  if (!password || !(await bcrypt.compare(String(password), user.passwordHash))) return res.status(401).json({ error: 'Senha incorreta.' });
  if (user.mfaEnabled && String(confirmChange) !== 'true') return res.status(400).json({ error: 'Confirme que deseja trocar.' });

  const secret = speakeasy.generateSecret({ length: 20, name: 'Jira Tool - Nimbi' });
  req.session.pendingMfaChange = { userId: user.id, mfaSecret: secret.base32 };
  const qrCode = await QRCode.toDataURL(secret.otpauth_url);
  res.json({ success: true, qrCode, isChangingMfa: Boolean(user.mfaEnabled) });
});

app.post('/api/auth/enable-mfa', requireAuth, async (req, res) => {
  const { code, password } = req.body || {};
  const user = await findUser('id', req.session.userId);
  const pending = req.session.pendingMfaChange;
  
  if (pending && pending.userId === user.id) {
    if (password && !(await bcrypt.compare(String(password), user.passwordHash))) return res.status(401).json({ error: 'Senha incorreta.' });
    if (!speakeasy.totp.verify({ secret: pending.mfaSecret, encoding: 'base32', token: String(code).trim(), window: 1 })) return res.status(401).json({ error: 'Código inválido.' });
    
    await updateUser(user.id, {
      mfaEnabled: true,
      mfaSecretEncrypted: encryptToken(pending.mfaSecret)
    });
    
    req.session.loginTime = Date.now();
    req.session.pendingMfaChange = null;
    return res.json({ success: true, message: 'MFA ativado/trocado.' });
  }
  
  if (!user.mfaSecretEncrypted || !speakeasy.totp.verify({ secret: decryptToken(user.mfaSecretEncrypted), encoding: 'base32', token: String(code).trim(), window: 1 })) return res.status(401).json({ error: 'Código inválido.' });
  
  await updateUser(user.id, { mfaEnabled: true });
  req.session.loginTime = Date.now();
  res.json({ success: true });
});

app.post('/api/auth/update-profile', requireAuth, async (req, res) => {
  const { jiraToken, currentPassword } = req.body || {};
  const user = await findUser('id', req.session.userId);
  if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(401).json({ error: 'Senha incorreta.' });

  const updates = {};
  if (jiraToken) updates.jiraTokenEncrypted = encryptToken(jiraToken);
  await updateUser(user.id, updates);
  
  req.session.loginTime = Date.now();
  res.json({ success: true, message: 'Perfil atualizado.' });
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  
  // Validações
  if (!newPassword || newPassword.length < 8) return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
  if (!/[A-Z]/.test(newPassword)) return res.status(400).json({ error: 'A nova senha deve conter pelo menos 1 letra MAIÚSCULA.' });
  if (!/[a-z]/.test(newPassword)) return res.status(400).json({ error: 'A nova senha deve conter pelo menos 1 letra minúscula.' });
  if (!/[0-9]/.test(newPassword)) return res.status(400).json({ error: 'A nova senha deve conter pelo menos 1 número.' });
  if (!/[^A-Za-z0-9]/.test(newPassword)) return res.status(400).json({ error: 'A nova senha deve conter pelo menos 1 caractere especial (ex: @, #, !, $).' });

  const hasSequentialNumbers = (str) => {
    for (let i = 0; i < str.length - 2; i++) {
      const c1 = str.charCodeAt(i), c2 = str.charCodeAt(i + 1), c3 = str.charCodeAt(i + 2);
      if (c1 >= 48 && c1 <= 57 && c2 >= 48 && c2 <= 57 && c3 >= 48 && c3 <= 57) {
         if (c2 === c1 + 1 && c3 === c2 + 1) return true;
         if (c2 === c1 - 1 && c3 === c2 - 1) return true;
      }
    }
    return false;
  };
  if (hasSequentialNumbers(newPassword)) return res.status(400).json({ error: 'A senha não pode conter 3 números sequenciais (ex: 123, 789, 321).' });

  const user = await findUser('id', req.session.userId);
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'A senha atual está incorreta.' });
  }

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await updateUser(user.id, { passwordHash, requirePasswordChange: false });
  
  req.session.loginTime = Date.now();
  res.json({ success: true, message: 'Senha alterada com sucesso.' });
});

// ==============================================================
// 🛠️ ROTAS DE ADMINISTRAÇÃO
// ==============================================================
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { data: users, error } = await supabase
    .from('users')
    .select('id, name, username, requirePasswordChange, jiraEmail, jiraDomain, mfaEnabled, role, loginAttempts, loginBlocked, lockedAt, createdAt, updatedAt')
    // 1º: Ordena pelo Cargo (Admin sempre no topo, QA embaixo)
    .order('role', { ascending: true }) 
    // 2º: Ordena pela Data (Mais antigos em cima, mais novos vão pro final)
    .order('createdAt', { ascending: true });

  if (error) return res.status(500).json({ error: 'Erro ao buscar usuários no DB.' });
  res.json({ success: true, users });
});

app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const user = await findUser('id', req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const generatedPassword = crypto.randomBytes(4).toString('hex');
  const passwordHash = await bcrypt.hash(generatedPassword, 10);
  await updateUser(user.id, { passwordHash, requirePasswordChange: true });

  res.json({ success: true, tempPassword: generatedPassword, userName: user.name });
});

app.post('/api/admin/users/create', requireAuth, requireAdmin, async (req, res) => {
  const { name, username, jiraEmail, jiraToken, jiraDomain } = req.body || {};
  if (!name || !username || !jiraEmail) return res.status(400).json({ error: 'Campos obrigatórios faltando.' });
  
  const normalizedUsername = String(username).trim().toLowerCase();
  const existingUser = await findUser('username', normalizedUsername);
  if (existingUser) return res.status(409).json({ error: 'Username já existe.' });

  const generatedPassword = crypto.randomBytes(4).toString('hex');
  const passwordHash = await bcrypt.hash(generatedPassword, 10);
  
  const newUser = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    username: normalizedUsername,
    passwordHash,
    requirePasswordChange: true,
    jiraEmail: String(jiraEmail).trim(),
    jiraDomain: jiraDomain || process.env.JIRA_DOMAIN || 'nimbi-portal.atlassian.net',
    jiraTokenEncrypted: jiraToken ? encryptToken(String(jiraToken).trim()) : '',
    mfaEnabled: false,
    role: normalizedUsername === ADMIN_EMAIL ? 'admin' : 'qa',
    loginBlocked: true,
    lockedAt: new Date().toISOString()
  };

  const { error } = await supabase.from('users').insert([newUser]);
  if (error) return res.status(500).json({ error: 'Falha ao criar usuário no banco.' });

  res.status(201).json({ success: true, tempPassword: generatedPassword, userName: newUser.name });
});

app.patch('/api/admin/users/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const user = await findUser('id', req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const loginBlocked = Boolean(req.body.loginBlocked);
  await updateUser(user.id, {
    loginBlocked,
    loginAttempts: loginBlocked ? 5 : 0,
    lockedAt: loginBlocked ? new Date().toISOString() : null
  });

  res.json({ success: true });
});

app.patch('/api/admin/users/:id/mfa', requireAuth, requireAdmin, async (req, res) => {
  const user = await findUser('id', req.params.id);
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  if (req.body.mfaEnabled === false) {
    await updateUser(user.id, { mfaEnabled: false, mfaSecretEncrypted: '' });
  } else {
    await updateUser(user.id, { mfaEnabled: true });
  }
  
  res.json({ success: true });
});

// ==============================================================
// 🔗 ROTAS DE PROXY PARA O JIRA
// ==============================================================
app.get('/api/jira/config', requireAuth, async (req, res) => {
  const user = await findUser('id', req.session.userId);
  res.json({
    authenticated: true,
    hasCredentials: Boolean(user && user.jiraEmail && user.jiraTokenEncrypted),
    domain: user ? user.jiraDomain : '',
  });
});

app.post('/api/jira', requireAuth, async (req, res) => {
  const user = await findUser('id', req.session.userId);
  const payload = req.body || {};
  const email = user ? user.jiraEmail : '';
  const token = user ? decryptToken(user.jiraTokenEncrypted) : '';
  const domain = user ? user.jiraDomain : 'nimbi-portal.atlassian.net';
  const { method, endpoint, body } = payload;

  if (!email || !token || !endpoint) return res.status(400).json({ error: 'Credenciais ou endpoint ausentes.' });

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const postData = body ? JSON.stringify(body) : '';
  const options = {
    hostname: domain, path: endpoint, method: method || 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(postData) },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', (chunk) => { data += chunk; });
    proxyRes.on('end', () => res.status(proxyRes.statusCode).send(data));
  });

  proxyReq.on('error', (err) => res.status(500).json({ error: err.message }));
  proxyReq.write(postData);
  proxyReq.end();
});

app.listen(PORT, () => {
  console.log(`Jira Tool V2 rodando em http://localhost:${PORT}`);
  console.log('Autenticação: Postgres (Supabase) + Sessão Nativa');
});