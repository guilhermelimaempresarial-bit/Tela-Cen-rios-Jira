require('dotenv').config();

const express = require('express');
const session = require('express-session');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3333;
const DATA_DIR = path.join(__dirname, 'data');
const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_SECRET = process.env.SESSION_SECRET || 'jira-tool-dev-secret-change-me';
const TOKEN_KEY = process.env.TOKEN_ENCRYPTION_KEY || 'jira-tool-token-key-32bytes-long';

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
      email: user.email,
      jiraEmail: user.jiraEmail,
      role: user.role,
      createdAt: user.createdAt,
    },
  });
});

app.post('/api/auth/register', async (req, res) => {
  const { name, email, password, jiraEmail, jiraToken, jiraDomain } = req.body || {};

  if (!name || !email || !password || !jiraEmail || !jiraToken) {
    return res.status(400).json({ error: 'Campos obrigatórios: name, email, password, jiraEmail, jiraToken.' });
  }

  const users = loadUsers();
  const existing = users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (existing) {
    return res.status(409).json({ error: 'Usuário já cadastrado.' });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const timestamp = new Date().toISOString();
  const user = {
    id: crypto.randomUUID(),
    name: String(name).trim(),
    email: String(email).trim().toLowerCase(),
    passwordHash,
    jiraEmail: String(jiraEmail).trim(),
    jiraDomain: (jiraDomain || process.env.JIRA_DOMAIN || 'nimbi-portal.atlassian.net').trim(),
    jiraTokenEncrypted: encryptToken(jiraToken),
    role: 'qa',
    createdAt: timestamp,
    updatedAt: timestamp,
  };

  users.push(user);
  saveUsers(users);
  req.session.userId = user.id;

  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      jiraEmail: user.jiraEmail,
      role: user.role,
    },
  });
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'Email e senha são obrigatórios.' });
  }

  const users = loadUsers();
  const user = users.find((u) => u.email.toLowerCase() === String(email).trim().toLowerCase());
  if (!user) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: 'Credenciais inválidas.' });
  }

  req.session.userId = user.id;
  res.json({
    success: true,
    user: {
      id: user.id,
      name: user.name,
      email: user.email,
      jiraEmail: user.jiraEmail,
      role: user.role,
    },
  });
});

app.post('/api/auth/logout', (req, res) => {
  req.session.destroy(() => {
    res.json({ success: true });
  });
});

app.post('/api/auth/update-profile', requireAuth, async (req, res) => {
  const { jiraEmail, jiraDomain, jiraToken, currentPassword } = req.body || {};

  if (!jiraEmail || !currentPassword) {
    return res.status(400).json({ error: 'Email Jira e senha atual são obrigatórios.' });
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

  users[userIndex].jiraEmail = String(jiraEmail).trim();
  users[userIndex].jiraDomain = (jiraDomain || 'nimbi-portal.atlassian.net').trim();
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
  users[userIndex].updatedAt = new Date().toISOString();

  saveUsers(users);

  res.json({
    success: true,
    message: 'Senha alterada com sucesso.',
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
