require('dotenv').config();

const express = require('express');
const session = require('express-session');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');

const app = express();
const PORT = process.env.PORT || 3333;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'jira-tool-dev-secret-change-me';
const TOKEN_KEY = process.env.TOKEN_ENCRYPTION_KEY || 'jira-tool-token-key-32bytes-long';
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || 'guilherme.lima@nimbi.com.br').trim().toLowerCase();
const userLoginLocks = new Map();

async function withUserLoginLock(email, callback) {
  const key = String(email || '').trim().toLowerCase();
  const previous = userLoginLocks.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  userLoginLocks.set(key, current);

  await previous;
  try {
    return await callback();
  } finally {
    release();
    if (userLoginLocks.get(key) === current) {
      userLoginLocks.delete(key);
    }
  }
}

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(USERS_FILE)) {
    fs.writeFileSync(USERS_FILE, JSON.stringify([], null, 2));
  }
}

function loadUsers() {
  ensureDataDir();
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8') || '[]');
  } catch (error) {
    return [];
  }
}

function saveUsers(users) {
  ensureDataDir();
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
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
  } catch (error) {
    return '';
  }
}

app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(session({
  secret: SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    sameSite: 'lax',
    secure: false,
    maxAge: 1000 * 60 * 60 * 8,
  },
}));
app.use(express.static(path.join(__dirname, 'public')));

function requireAuth(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.status(401).json({ error: 'Não autenticado. Faça login na aplicação.' });
  }
  next();
}

function requireAdmin(req, res, next) {
  const user = getCurrentUser(req);
  if (!user || user.role !== 'admin') {
    return res.status(403).json({ error: 'Acesso restrito ao administrador.' });
  }
  next();
}

function requireAuthPage(req, res, next) {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login.html');
  }
  next();
}

function requireAdminPage(req, res, next) {
  const user = getCurrentUser(req);
  if (!user) {
    return res.redirect('/login.html');
  }
  if (user.role !== 'admin') {
    return res.redirect('/');
  }
  next();
}

function getCurrentUser(req) {
  const users = loadUsers();
  return users.find((u) => u.id === req.session.userId) || null;
}

app.get('/login.html', (_req, res) => {
  res.sendFile(path.join(__dirname, 'login.html'));
});

app.get('/profile.html', requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'profile.html'));
});

app.get('/change-password.html', requireAuth, (_req, res) => {
  res.sendFile(path.join(__dirname, 'change-password.html'));
});

app.get('/admin', requireAuthPage, requireAdminPage, (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/admin.html', requireAuthPage, requireAdminPage, (_req, res) => {
  res.sendFile(path.join(__dirname, 'admin.html'));
});

app.get('/api/auth/session', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.json({ authenticated: false });
  }

  const user = getCurrentUser(req);
  if (!user) {
    req.session.destroy(() => {});
    return res.json({ authenticated: false });
  }

  res.json({
    authenticated: true,
    user: {
      id: user.id,
      name: user.name,
      username: user.username || user.email,
      jiraEmail: user.jiraEmail,
      requirePasswordChange: Boolean(user.requirePasswordChange),
      role: user.role,
      createdAt: user.createdAt,
      mfaEnabled: Boolean(user.mfaEnabled),
    },
  });
});

app.post('/api/auth/setup-mfa', requireAuth, async (req, res) => {
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Usuário não encontrado.' });
  }

  const { password, confirmChange } = req.body || {};
  const wantsToChange = confirmChange === true || confirmChange === 'true';

  if (!password || !String(password).trim()) {
    return res.status(400).json({ error: 'Informe sua senha atual para configurar o MFA.' });
  }

  const passwordOk = await bcrypt.compare(String(password), user.passwordHash);
  if (!passwordOk) {
    return res.status(401).json({ error: 'Senha atual incorreta.' });
  }

  if (user.mfaEnabled && !wantsToChange) {
    return res.status(400).json({ error: 'Confirme que você deseja trocar o MFA.' });
  }

  const secret = speakeasy.generateSecret({ length: 20, name: 'Jira Tool - Nimbi' });
  const otpauth = secret.otpauth_url;

  req.session.pendingMfaChange = {
    userId: user.id,
    mfaSecret: secret.base32,
    createdAt: Date.now(),
  };

  const qrCode = await QRCode.toDataURL(otpauth);
  res.json({
    success: true,
    requireMfaSetup: false,
    requirePasswordChange: Boolean(user.requirePasswordChange),
    qrCode,
    message: user.mfaEnabled
      ? 'Confirme a troca do MFA. Escaneie o novo QR code e valide o código do autenticator para finalizar a alteração.'
      : 'Escaneie este QR code no Google Authenticator ou Authy.',
    isChangingMfa: Boolean(user.mfaEnabled),
  });
});

app.post('/api/auth/enable-mfa', requireAuth, async (req, res) => {
  const { code, password } = req.body || {};
  if (!code) {
    return res.status(400).json({ error: 'Código MFA é obrigatório.' });
  }

  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Usuário não encontrado.' });
  }

  const pending = req.session.pendingMfaChange;
  const isChangingMfa = Boolean(pending && pending.userId === user.id);

  if (isChangingMfa) {
    if (password) {
      const passwordOk = await bcrypt.compare(String(password), user.passwordHash);
      if (!passwordOk) {
        return res.status(401).json({ error: 'Senha incorreta. A troca do MFA não foi concluída.' });
      }
    }

    const valid = speakeasy.totp.verify({
      secret: pending.mfaSecret,
      encoding: 'base32',
      token: String(code).trim(),
      window: 1,
    });

    if (!valid) {
      return res.status(401).json({
        error: 'Código do novo MFA inválido. O MFA antigo foi mantido.',
      });
    }

    const users = loadUsers();
    const userIndex = users.findIndex((u) => u.id === user.id);
    if (userIndex === -1) {
      return res.status(404).json({ error: 'Usuário não encontrado.' });
    }

    users[userIndex].mfaEnabled = true;
    users[userIndex].mfaSecretEncrypted = encryptToken(pending.mfaSecret);
    users[userIndex].updatedAt = new Date().toISOString();
    saveUsers(users);

    req.session.pendingMfaChange = null;
    return res.json({
      success: true,
      message: 'MFA trocado com sucesso.',
    });
  }

  if (!user.mfaSecretEncrypted) {
    return res.status(400).json({ error: 'Você precisa configurar o MFA antes de ativá-lo.' });
  }

  const secret = decryptToken(user.mfaSecretEncrypted);
  const valid = speakeasy.totp.verify({
    secret,
    encoding: 'base32',
    token: String(code).trim(),
    window: 1,
  });
  if (!valid) {
    return res.status(401).json({ error: 'Código MFA inválido.' });
  }

  const users = loadUsers();
  const userIndex = users.findIndex((u) => u.id === user.id);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  users[userIndex].mfaEnabled = true;
  users[userIndex].updatedAt = new Date().toISOString();
  saveUsers(users);

  res.json({
    success: true,
    message: 'MFA ativado com sucesso.',
  });
});


app.post('/api/auth/login', async (req, res) => {
  const { username, password, mfaCode } = req.body || {};
  if (!username || !password) {
    return res.status(400).json({ error: 'Username e senha são obrigatórios.' });
  }

  const normalizedUsername = String(username).trim().toLowerCase();

  await withUserLoginLock(normalizedUsername, async () => {
    const users = loadUsers();
    const user = users.find((u) => (u.username || u.email || '').toLowerCase() === normalizedUsername);

    if (!user || Boolean(user.loginBlocked)) {
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) {
      const currentAttempts = Number(user.loginAttempts || 0) + 1;
      user.loginAttempts = currentAttempts;
      user.updatedAt = new Date().toISOString();

      if (currentAttempts >= 5) {
        user.loginBlocked = true;
        user.lockedAt = new Date().toISOString();
      }

      saveUsers(users);
      return res.status(401).json({ error: 'Credenciais inválidas.' });
    }

    user.loginAttempts = 0;
    user.loginBlocked = false;
    user.lockedAt = null;
    user.updatedAt = new Date().toISOString();
    saveUsers(users);

    if (!user.mfaEnabled) {
      if (!mfaCode) {
        const secret = speakeasy.generateSecret({ length: 20, name: 'Jira Tool - Nimbi' });
        const qrCode = await QRCode.toDataURL(secret.otpauth_url);
        req.session.pendingMfaLogin = {
          userId: user.id,
          mfaSecret: secret.base32,
        };

        return res.status(200).json({
          success: false,
          requiresMfaSetup: true,
          qrCode,
          message: 'Este usuário ainda não possui MFA. Configure-o para continuar.',
        });
      }

      const pending = req.session.pendingMfaLogin;
      if (!pending || pending.userId !== user.id) {
        return res.status(401).json({ error: 'Sessão de MFA expirada. Tente novamente.', requiresMfaSetup: true });
      }

      const valid = speakeasy.totp.verify({
        secret: pending.mfaSecret,
        encoding: 'base32',
        token: String(mfaCode).trim(),
        window: 1,
      });

      if (!valid) {
        return res.status(401).json({ error: 'Código MFA inválido.', requiresMfaSetup: true });
      }

      const userIndex = users.findIndex((u) => u.id === user.id);
      if (userIndex !== -1) {
        users[userIndex].mfaEnabled = true;
        users[userIndex].mfaSecretEncrypted = encryptToken(pending.mfaSecret);
        users[userIndex].updatedAt = new Date().toISOString();
        saveUsers(users);
      }
      req.session.pendingMfaLogin = null;
    } else if (!mfaCode) {
      return res.status(401).json({
        error: 'Código MFA obrigatório.',
        requiresMfa: true,
      });
    } else {
      const secret = decryptToken(user.mfaSecretEncrypted);
      const valid = speakeasy.totp.verify({
        secret,
        encoding: 'base32',
        token: String(mfaCode).trim(),
        window: 1,
      });
      if (!valid) {
        return res.status(401).json({
          error: 'Código MFA inválido.',
          requiresMfa: true,
        });
      }
    }

    req.session.userId = user.id;
    return res.json({
      success: true,
      requirePasswordChange: Boolean(user.requirePasswordChange),
      user: {
        id: user.id,
        name: user.name,
        username: user.username || user.email,
        jiraEmail: user.jiraEmail,
        requirePasswordChange: Boolean(user.requirePasswordChange),
        role: user.role,
        mfaEnabled: true,
      },
    });
  });
});

app.post('/api/auth/validate-password', async (req, res) => {
  const { username, password } = req.body || {};

  if (!username || !password) {
    return res.status(400).json({ error: 'Username e senha são obrigatórios.' });
  }

  const users = loadUsers();
  const normalizedUsername = String(username).trim().toLowerCase();
  const user = users.find((u) => (u.username || u.email || '').toLowerCase() === normalizedUsername);
  if (!user) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  const ok = await bcrypt.compare(String(password), user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Senha incorreta.' });
  }

  return res.json({ success: true, message: 'Senha validada.' });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.post('/api/auth/update-profile', requireAuth, async (req, res) => {
  const { jiraToken, currentPassword } = req.body || {};

  if (!currentPassword) {
    return res.status(400).json({ error: 'Senha atual é obrigatória.' });
  }

  const users = loadUsers();
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Usuário não encontrado.' });
  }

  const passwordOk = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!passwordOk) {
    return res.status(401).json({ error: 'Senha atual incorreta.' });
  }

  const userIndex = users.findIndex((u) => u.id === user.id);
  if (userIndex === -1) {
    return res.status(401).json({ error: 'Usuário não encontrado.' });
  }


  if (jiraToken) {
    users[userIndex].jiraTokenEncrypted = encryptToken(jiraToken);
  }
  users[userIndex].updatedAt = new Date().toISOString();

  saveUsers(users);

  res.json({
    success: true,
    message: 'Perfil atualizado com sucesso.',
  });
});

app.post('/api/auth/change-password', requireAuth, async (req, res) => {
  const { currentPassword, newPassword } = req.body || {};

  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Senha atual e nova senha são obrigatórias.' });
  }

  if (newPassword.length < 6) {
    return res.status(400).json({ error: 'Nova senha deve ter pelo menos 6 caracteres.' });
  }

  const users = loadUsers();
  const user = getCurrentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Usuário não encontrado.' });
  }

  const passwordOk = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!passwordOk) {
    return res.status(401).json({ error: 'Senha atual incorreta.' });
  }

  const userIndex = users.findIndex((u) => u.id === user.id);
  if (userIndex === -1) {
    return res.status(401).json({ error: 'Usuário não encontrado.' });
  }

  users[userIndex].passwordHash = await bcrypt.hash(newPassword, 10);
  users[userIndex].requirePasswordChange = false;
  users[userIndex].updatedAt = new Date().toISOString();

  saveUsers(users);

  res.json({
    success: true,
    message: 'Senha alterada com sucesso.',
  });
});

app.get('/api/admin/users', requireAuth, requireAdmin, (req, res) => {
  const users = loadUsers().map((user) => ({
    id: user.id,
    name: user.name,
    username: user.username || user.email,
    role: user.role,
    mfaEnabled: Boolean(user.mfaEnabled),
    loginBlocked: Boolean(user.loginBlocked),
    loginAttempts: Number(user.loginAttempts || 0),
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
  }));

    res.json({
    success: true,
    users,
  });
});

app.post('/api/admin/users/:id/reset-password', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const users = loadUsers();
  const userIndex = users.findIndex((u) => u.id === id);

  if (userIndex === -1) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  try {
    const generatedPassword = crypto.randomBytes(4).toString('hex'); // 8 chars
    const passwordHash = await bcrypt.hash(generatedPassword, 10);
    const timestamp = new Date().toISOString();

    users[userIndex].passwordHash = passwordHash;
    users[userIndex].requirePasswordChange = true;
    users[userIndex].updatedAt = timestamp;
    
    // Opcional: Se quiser que o usuário tenha que configurar MFA de novo ao resetar, 
    // mas a solicitação diz manter a lógica, então apenas resetamos a senha.

    saveUsers(users);

    return res.json({
      success: true,
      tempPassword: generatedPassword,
      userName: users[userIndex].name,
      message: 'Senha resetada com sucesso.'
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao resetar senha: ' + error.message });
  }
});

app.post('/api/admin/users/create', requireAuth, requireAdmin, async (req, res) => {
  const { name, username, jiraEmail, jiraToken, jiraDomain } = req.body || {};

  if (!name || !username || !jiraEmail) {
    return res.status(400).json({ error: 'Nome, username e email do Jira são obrigatórios.' });
  }

  const normalizedUsername = String(username).trim().toLowerCase();
  const users = loadUsers();

  const existing = users.find((u) => (u.username || u.email || '').toLowerCase() === normalizedUsername);
  if (existing) {
    return res.status(409).json({ error: 'Username já está registrado no sistema.' });
  }

  if (jiraEmail && String(jiraEmail).trim() !== '') {
    const normalizedJiraEmail = String(jiraEmail).trim().toLowerCase();
    const existingJira = users.find((u) => (u.jiraEmail || '').toLowerCase() === normalizedJiraEmail);
    if (existingJira) {
      return res.status(409).json({ error: 'Email do Jira já está registrado no sistema.' });
    }
  }

  try {
    const generatedPassword = crypto.randomBytes(4).toString('hex'); // 8 chars
    const passwordHash = await bcrypt.hash(generatedPassword, 10);
    const timestamp = new Date().toISOString();
    const newUser = {
      id: crypto.randomUUID(),
      name: String(name).trim(),
      username: normalizedUsername,
      passwordHash,
      requirePasswordChange: true,
      jiraEmail: jiraEmail ? String(jiraEmail).trim() : '',
      jiraDomain: jiraDomain ? String(jiraDomain).trim() : (process.env.JIRA_DOMAIN || 'nimbi-portal.atlassian.net'),
      jiraTokenEncrypted: jiraToken ? encryptToken(String(jiraToken).trim()) : '',
      mfaEnabled: false,
      mfaSecretEncrypted: '',
      role: normalizedUsername === ADMIN_EMAIL ? 'admin' : 'qa',
      loginAttempts: 0,
      loginBlocked: true,
      lockedAt: timestamp,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

                users.push(newUser);
    saveUsers(users);

    // Retorno simplificado e direto para o admin
    return res.status(201).json({
      success: true,
      tempPassword: generatedPassword,
      userName: newUser.name,
      message: 'Usuário criado com sucesso.'
    });
  } catch (error) {
    return res.status(500).json({ error: 'Erro ao criar usuário: ' + error.message });
  }
});

app.patch('/api/admin/users/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { loginBlocked } = req.body || {};

  if (typeof loginBlocked !== 'boolean') {
    return res.status(400).json({ error: 'Campo loginBlocked obrigatório.' });
  }

  const users = loadUsers();
  const userIndex = users.findIndex((user) => user.id === id);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const target = users[userIndex];
  target.loginBlocked = loginBlocked;
  target.loginAttempts = loginBlocked ? Math.max(Number(target.loginAttempts || 0), 5) : 0;
  target.lockedAt = loginBlocked ? (target.lockedAt || new Date().toISOString()) : null;
  target.updatedAt = new Date().toISOString();
  saveUsers(users);

  res.json({
    success: true,
    user: {
      id: target.id,
      username: target.username || target.email,
      name: target.name,
      loginBlocked: Boolean(target.loginBlocked),
    },
  });
});

app.patch('/api/admin/users/:id/mfa', requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  const { mfaEnabled } = req.body || {};

  if (typeof mfaEnabled !== 'boolean') {
    return res.status(400).json({ error: 'Campo mfaEnabled obrigatório.' });
  }

  const users = loadUsers();
  const userIndex = users.findIndex((user) => user.id === id);
  if (userIndex === -1) {
    return res.status(404).json({ error: 'Usuário não encontrado.' });
  }

  const target = users[userIndex];
  if (mfaEnabled === false) {
    target.mfaEnabled = false;
    target.mfaSecretEncrypted = '';
  } else {
    target.mfaEnabled = true;
  }
  target.updatedAt = new Date().toISOString();
  saveUsers(users);

  res.json({
    success: true,
    user: {
      id: target.id,
      username: target.username || target.email,
      name: target.name,
      mfaEnabled: Boolean(target.mfaEnabled),
    },
  });
});

app.get('/api/jira/config', requireAuth, (req, res) => {
  const user = getCurrentUser(req);
  res.json({
    authenticated: true,
    hasCredentials: Boolean(user && user.jiraEmail && user.jiraTokenEncrypted),
    domain: user ? (user.jiraDomain || process.env.JIRA_DOMAIN || 'nimbi-portal.atlassian.net') : '',
  });
});

function resolveJiraCredentials(req) {
  const user = getCurrentUser(req);
  const payload = req.body || {};

  if (user) {
    return {
      email: user.jiraEmail,
      token: decryptToken(user.jiraTokenEncrypted),
      domain: user.jiraDomain || payload.domain || process.env.JIRA_DOMAIN || 'nimbi-portal.atlassian.net',
    };
  }

  const email = (payload.email || process.env.JIRA_EMAIL || '').trim();
  const token = (payload.token || process.env.JIRA_API_TOKEN || '').trim();
  const domain = (payload.domain || process.env.JIRA_DOMAIN || 'nimbi-portal.atlassian.net').trim();
  return { email, token, domain };
}

app.post('/api/jira', requireAuth, (req, res) => {
  const { method, endpoint, body } = req.body || {};
  const { email, token, domain } = resolveJiraCredentials(req);

  if (!email || !token || !domain || !endpoint) {
    return res.status(400).json({
      error: 'Credenciais do Jira ausentes para o usuário autenticado no backend.',
    });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const postData = body ? JSON.stringify(body) : '';

  const options = {
    hostname: domain,
    path: endpoint,
    method: method || 'POST',
    headers: {
      Authorization: `Basic ${auth}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  const proxyReq = https.request(options, (proxyRes) => {
    let data = '';
    proxyRes.on('data', (chunk) => { data += chunk; });
    proxyRes.on('end', () => {
      res.status(proxyRes.statusCode).send(data);
    });
  });

  proxyReq.on('error', (err) => {
    res.status(500).json({ error: err.message });
  });

  proxyReq.write(postData);
  proxyReq.end();
});

app.get('/', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/profile', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, 'profile.html'));
});

app.get('/change-password', (req, res) => {
  if (!req.session || !req.session.userId) {
    return res.redirect('/login.html');
  }
  res.sendFile(path.join(__dirname, 'change-password.html'));
});

app.listen(PORT, () => {
  console.log(`Jira Tool V2 rodando em http://localhost:${PORT}`);
  console.log('Autenticação: sessão do backend + token do Jira em armazenamento criptografado no servidor');
});
