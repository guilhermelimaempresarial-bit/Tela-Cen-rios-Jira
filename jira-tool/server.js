const express = require('express');
const https = require('https');
const path = require('path');

const app = express();
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Proxy para API do Jira (evita CORS)
app.post('/api/jira', async (req, res) => {
  const { email, token, domain, method, endpoint, body } = req.body;

  if (!email || !token || !domain || !endpoint) {
    return res.status(400).json({ error: 'Campos obrigatorios: email, token, domain, endpoint' });
  }

  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  const postData = body ? JSON.stringify(body) : '';

  const options = {
    hostname: domain,
    path: endpoint,
    method: method || 'POST',
    headers: {
      'Authorization': `Basic ${auth}`,
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

const PORT = 3333;
app.listen(PORT, () => {
  console.log(`Jira Tool rodando em http://localhost:${PORT}`);
});
