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
const mongoose = require('mongoose'); // Importando o Mongoose

const app = express();
const PORT = process.env.PORT || 3333;
const SESSION_SECRET = process.env.SESSION_SECRET || 'jira-tool-dev-secret-change-me';
const TOKEN_KEY = process.env.TOKEN_ENCRYPTION_KEY || 'jira-tool-token-key-32bytes-long';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'guilherme.lima@nimbi.com.br').trim().toLowerCase();

// ==============================================================
// ☁️ CONEXÃO COM O MONGODB
// ==============================================================
if (!process.env.MONGO_URI) {
  console.error('❌ ERRO CRÍTICO: Variável MONGO_URI não encontrada no .env ou no Render.');
  process.exit(1);
}

mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log('✅ Conectado com sucesso ao MongoDB Atlas!'))
  .catch(err => console.error('❌ Erro ao conectar no MongoDB:', err));

// ==============================================================
// 📋 MODELO (SCHEMA) DO USUÁRIO NO BANCO DE DADOS
// ==============================================================
const userSchema = new mongoose.Schema({
  id: { type: String, unique: true },
  name: String,
  username: String,
  passwordHash: String,
  requirePasswordChange: Boolean,
  jiraEmail: String,
  jiraDomain: String,
  jiraTokenEncrypted: String,
  mfaEnabled: Boolean,
  mfaSecretEncrypted: String,
  role: String,
  loginAttempts: { type: Number, default: 0 },
  loginBlocked: { type: Boolean, default: false },
  lockedAt: Date,
  createdAt: Date,
  updatedAt: Date
});
const User = mongoose.model('User', userSchema);

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

  const user = await User.findOne({ id: req.session.userId });
  
  // A Mágica de Segurança: Tempo de Login vs Tempo de Modificação da Conta
  const timeSessao = req.session.loginTime || 0;
  const timeUpdate = user?.updatedAt ? user.updatedAt.getTime() : 0;

  // 1. Se o Admin bloqueou ou alterou os dados (como reset de senha) APÓS o login, mata a sessão!
  if (!user || user.loginBlocked || timeUpdate > timeSessao) {
    req.session.destroy(() => {});
    return res.status(401).json({ error: 'Sessão invalidada por motivos de segurança. Faça login novamente.' });
  }

  // 2. Bloqueia APIs se exige troca de senha (mas libera a rota de trocar a senha em si)
  if (user.requirePasswordChange && !req.path.includes('/change-password')) {
    return res.status(403).json({ error: 'Ação bloqueada. Você precisa alterar sua senha obrigatória.' });
  }

  next();
}

async function requireAdmin(req, res, next) {
  const user = await User.findOne({ id: req.session.userId });
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }
  next();
}

async function requireAuthPage(req, res, next) {
  if (!req.session || !req.session.userId) return res.redirect('/login.html');
  
  const user = await User.findOne({ id: req.session.userId });
  
  const timeSessao = req.session.loginTime || 0;
  const timeUpdate = user?.updatedAt ? user.updatedAt.getTime() : 0;

  // Mata a sessão de navegação se a conta foi modificada pelo Admin
  if (!user || user.loginBlocked || timeUpdate > timeSessao) {
    req.session.destroy(() => {});
    return res.redirect('/login.html');
  }
  
  // Se exige troca, permite o acesso APENAS à página de trocar senha
  if (user.requirePasswordChange && req.path !== '/change-password.html') {
    return res.redirect('/change-password.html?forced=1');
  }
  
  next();
}

async function requireAdminPage(req, res, next) {
  const user = await User.findOne({ id: req.session.userId });
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
  const user = await User.findOne({ id: req.session.userId });
  
  const timeSessao = req.session.loginTime || 0;
  const timeUpdate = user?.updatedAt ? user.updatedAt.getTime() : 0;

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
    const user = await User.findOne({ username: normalizedUsername });
    if (!user || Boolean(user.loginBlocked)) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      user.loginAttempts = Number(user.loginAttempts || 0) + 1;
      user.updatedAt = new Date();
      if (user.loginAttempts >= 5) {
        user.loginBlocked = true;
        user.lockedAt = new Date();
      }
      await user.save();
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    user.loginAttempts = 0;
    user.loginBlocked = false;
    user.lockedAt = null;
    user.updatedAt = new Date();
    await user.save();

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

      user.mfaEnabled = true;
      user.mfaSecretEncrypted = encryptToken(pending.mfaSecret);
      user.updatedAt = new Date();
      await user.save();
      req.session.pendingMfaLogin = null;
    } else if (!mfaCode) {
      return res.status(401).json({ error: 'Código MFA obrigatório.', requiresMfa: true });
    } else {
      const secret = decryptToken(user.mfaSecretEncrypted);
      const valid = speakeasy.totp.verify({ secret, encoding: 'base32', token: String(mfaCode).trim(), window: 1 });
      if (!valid) return res.status(401).json({ error: 'Código MFA inválido.', requiresMfa: true });
    }

    // Marca a Sessão com o tempo exato em que ele conseguiu logar
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
  const user = await User.findOne({ username: String(username).trim().toLowerCase() });
  if (!user || !(await bcrypt.compare(String(password), user.passwordHash))) return res.status(401).json({ error: 'Senha incorreta.' });
  return res.json({ success: true, message: 'Senha validada.' });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => { res.json({ success: true }); });
});

// ==============================================================
// 🛡️ ROTAS DE PERFIL E MFA
// ==============================================================
app.post('/api/auth/setup-mfa', requireAuth, async (req, res) => {
  const user = await User.findOne({ id: req.session.userId });
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
  const user = await User.findOne({ id: req.session.userId });
  const pending = req.session.pendingMfaChange;
  
  if (pending && pending.userId === user.id) {
    if (password && !(await bcrypt.compare(String(password), user.passwordHash))) return res.status(401).json({ error: 'Senha incorreta.' });
    if (!speakeasy.totp.verify({ secret: pending.mfaSecret, encoding: 'base32', token: String(code).trim(), window: 1 })) return res.status(401).json({ error: 'Código inválido.' });
    
    user.mfaEnabled = true;
    user.mfaSecretEncrypted = encryptToken(pending.mfaSecret);
    user.updatedAt = new Date();
    await user.save();
    
    req.session.loginTime = Date.now(); // Mantém o usuário logado após ação própria
    req.session.pendingMfaChange = null;
    return res.json({ success: true, message: 'MFA ativado/trocado.' });
  }
  
  if (!user.mfaSecretEncrypted || !speakeasy.totp.verify({ secret: decryptToken(user.mfaSecretEncrypted), encoding: 'base32', token: String(code).trim(), window: 1 })) return res.status(401).json({ error: 'Código inválido.' });
  user.mfaEnabled = true;
  user.updatedAt = new Date();
  await user.save();
  
  req.session.loginTime = Date.now();
  res.json({ success: true });
});

app.post('/api/auth/update-profile', requireAuth, async (req, res) => {
  const { jiraToken, currentPassword } = req.body || {};
  const user = await User.findOne({ id: req.session.userId });
  if (!currentPassword || !(await bcrypt.compare(currentPassword, user.passwordHash))) return res.status(401).json({ error: 'Senha incorreta.' });

  if (jiraToken) user.jiraTokenEncrypted = encryptToken(jiraToken);
  user.updatedAt = new Date();
  await user.save();
  
  req.session.loginTime = Date.now(); // Atualiza tempo de login para não invalidar própria sessão
  res.json({ success: true, message: 'Perfil atualizado.' });
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};
  
  // 1. Verificações de Regex (Tamanho, Maiúsculas, Minúsculas, Números e Especiais)
  if (!newPassword || newPassword.length < 8) {
    return res.status(400).json({ error: 'A nova senha deve ter pelo menos 8 caracteres.' });
  }
  if (!/[A-Z]/.test(newPassword)) {
    return res.status(400).json({ error: 'A nova senha deve conter pelo menos 1 letra MAIÚSCULA.' });
  }
  if (!/[a-z]/.test(newPassword)) {
    return res.status(400).json({ error: 'A nova senha deve conter pelo menos 1 letra minúscula.' });
  }
  if (!/[0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'A nova senha deve conter pelo menos 1 número.' });
  }
  if (!/[^A-Za-z0-9]/.test(newPassword)) {
    return res.status(400).json({ error: 'A nova senha deve conter pelo menos 1 caractere especial (ex: @, #, !, $).' });
  }

  // 2. Verificação Avançada de Números Sequenciais (ex: 123, 345, 987)
  const hasSequentialNumbers = (str) => {
    for (let i = 0; i < str.length - 2; i++) {
      const c1 = str.charCodeAt(i);
      const c2 = str.charCodeAt(i + 1);
      const c3 = str.charCodeAt(i + 2);
      
      // Só verifica se os três caracteres atuais forem números (código ASCII entre 48 e 57)
      if (c1 >= 48 && c1 <= 57 && c2 >= 48 && c2 <= 57 && c3 >= 48 && c3 <= 57) {
         if (c2 === c1 + 1 && c3 === c2 + 1) return true; // Crescente (ex: 123)
         if (c2 === c1 - 1 && c3 === c2 - 1) return true; // Decrescente (ex: 321)
      }
    }
    return false;
  };

  if (hasSequentialNumbers(newPassword)) {
    return res.status(400).json({ error: 'A senha não pode conter 3 números sequenciais (ex: 123, 789, 321).' });
  }

  // 3. Validação do Banco de Dados
  const user = await User.findOne({ id: req.session.userId });
  if (!(await bcrypt.compare(currentPassword, user.passwordHash))) {
    return res.status(401).json({ error: 'A senha atual está incorreta.' });
  }

  // 4. Salvar nova senha
  user.passwordHash = await bcrypt.hash(newPassword, 10);
  user.requirePasswordChange = false;
  user.updatedAt = new Date();
  await user.save();
  
  req.session.loginTime = Date.now(); // Mantém o usuário logado após mudar a senha
  res.json({ success: true, message: 'Senha alterada com sucesso.' });
});

// ==============================================================
// 🛠️ ROTAS DE ADMINISTRAÇÃO
// ==============================================================
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const users = await User.find().select('-passwordHash -mfaSecretEncrypted -jiraTokenEncrypted');
  res.json({ success: true, users });
});

app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const user = await User.findOne({ id: req.params.id });
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  const generatedPassword = crypto.randomBytes(4).toString('hex');
  user.passwordHash = await bcrypt.hash(generatedPassword, 10);
  user.requirePasswordChange = true;
  user.updatedAt = new Date();
  await user.save();
  res.json({ success: true, tempPassword: generatedPassword, userName: user.name });
});

app.post('/api/admin/users/create', requireAuth, requireAdmin, async (req, res) => {
  const { name, username, jiraEmail, jiraToken, jiraDomain } = req.body || {};
  if (!name || !username || !jiraEmail) return res.status(400).json({ error: 'Campos obrigatórios faltando.' });
  
  const normalizedUsername = String(username).trim().toLowerCase();
  if (await User.findOne({ username: normalizedUsername })) return res.status(409).json({ error: 'Username já existe.' });

  const generatedPassword = crypto.randomBytes(4).toString('hex');
  const passwordHash = await bcrypt.hash(generatedPassword, 10);
  
  const newUser = new User({
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
    lockedAt: new Date(),
    createdAt: new Date(),
    updatedAt: new Date(),
  });

  await newUser.save();
  res.status(201).json({ success: true, tempPassword: generatedPassword, userName: newUser.name });
});

app.patch('/api/admin/users/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const user = await User.findOne({ id: req.params.id });
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  user.loginBlocked = Boolean(req.body.loginBlocked);
  user.loginAttempts = user.loginBlocked ? 5 : 0;
  user.lockedAt = user.loginBlocked ? new Date() : null;
  user.updatedAt = new Date();
  await user.save();
  res.json({ success: true });
});

app.patch('/api/admin/users/:id/mfa', requireAuth, requireAdmin, async (req, res) => {
  const user = await User.findOne({ id: req.params.id });
  if (!user) return res.status(404).json({ error: 'Usuário não encontrado.' });

  if (req.body.mfaEnabled === false) {
    user.mfaEnabled = false;
    user.mfaSecretEncrypted = '';
  } else {
    user.mfaEnabled = true;
  }
  user.updatedAt = new Date();
  await user.save();
  res.json({ success: true });
});

// ==============================================================
// 🔗 ROTAS DE PROXY PARA O JIRA
// ==============================================================
app.get('/api/jira/config', requireAuth, async (req, res) => {
  const user = await User.findOne({ id: req.session.userId });
  res.json({
    authenticated: true,
    hasCredentials: Boolean(user && user.jiraEmail && user.jiraTokenEncrypted),
    domain: user ? user.jiraDomain : '',
  });
});

app.post('/api/jira', requireAuth, async (req, res) => {
  const user = await User.findOne({ id: req.session.userId });
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
  console.log('Autenticação: MongoDB Atlas + Sessão do Backend');
});