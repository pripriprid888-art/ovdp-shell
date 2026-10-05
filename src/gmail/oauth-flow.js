const { BrowserWindow, shell } = require('electron');
const http = require('http');
const net = require('net');
const { URL } = require('url');
const { getGoogleOAuthConfig, GMAIL_READONLY_SCOPE } = require('./oauth-config');
const tokenStore = require('./token-store');

const USER_CANCELLED = 'GMAIL_OAUTH_CANCELLED';
const OAUTH_TIMEOUT_MS = 5 * 60 * 1000;

function pickAvailablePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      server.close((err) => {
        if (err) reject(err);
        else resolve(port);
      });
    });
    server.on('error', reject);
  });
}

async function fetchUserEmail(accessToken) {
  if (!accessToken) return null;
  try {
    const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.email || null;
  } catch {
    return null;
  }
}

async function exchangeCodeForTokens(code, redirectUri, config) {
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (config.clientSecret) {
    body.set('client_secret', config.clientSecret);
  }

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error_description || data.error || 'Не вдалося отримати токен Google');
  }
  return data;
}

function buildAuthUrl(config, redirectUri) {
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: [
      GMAIL_READONLY_SCOPE,
      'openid',
      'email',
      'profile',
    ].join(' '),
    access_type: 'offline',
    prompt: 'consent',
    include_granted_scopes: 'true',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

function runLoopbackOAuth(parentWindow) {
  const config = getGoogleOAuthConfig();
  if (!config.configured) {
    return Promise.reject(new Error('Google OAuth не налаштовано (GOOGLE_CLIENT_ID у .env)'));
  }

  return new Promise(async (resolve, reject) => {
    let settled = false;
    let authWindow = null;
    let server = null;
    let timeoutId = null;

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      if (timeoutId) clearTimeout(timeoutId);
      if (server) {
        try {
          server.close();
        } catch {
          // ignore
        }
      }
      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
      }
      fn(value);
    };

    try {
      const port = await pickAvailablePort();
      const redirectUri = `http://127.0.0.1:${port}/oauth2callback`;
      const authUrl = buildAuthUrl(config, redirectUri);

      server = http.createServer(async (req, res) => {
        try {
          const requestUrl = new URL(req.url || '/', redirectUri);
          if (requestUrl.pathname !== '/oauth2callback') {
            res.writeHead(404);
            res.end();
            return;
          }

          const error = requestUrl.searchParams.get('error');
          if (error) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body><p>Доступ скасовано. Можете закрити це вікно.</p></body></html>');
            const cancelled = new Error(USER_CANCELLED);
            finish(reject, cancelled);
            return;
          }

          const code = requestUrl.searchParams.get('code');
          if (!code) {
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end('<html><body><p>Немає коду авторизації.</p></body></html>');
            finish(reject, new Error('Google не повернув код авторизації'));
            return;
          }

          const tokenResponse = await exchangeCodeForTokens(code, redirectUri, config);
          const email = await fetchUserEmail(tokenResponse.access_token);
          tokenStore.saveOAuthResult(tokenResponse, email);

          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><p>Gmail підключено. Поверніться до OVDP Shell.</p></body></html>');
          finish(resolve, { email, connected: true });
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end('<html><body><p>Помилка входу. Спробуйте ще раз у застосунку.</p></body></html>');
          finish(reject, err);
        }
      });

      await new Promise((listenResolve, listenReject) => {
        server.once('error', listenReject);
        server.listen(port, '127.0.0.1', listenResolve);
      });

      authWindow = new BrowserWindow({
        parent: parentWindow || undefined,
        modal: Boolean(parentWindow),
        width: 520,
        height: 720,
        show: true,
        title: 'Підключення Gmail',
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          sandbox: true,
        },
      });

      authWindow.on('closed', () => {
        finish(reject, new Error(USER_CANCELLED));
      });

      timeoutId = setTimeout(() => {
        finish(reject, new Error('Час очікування Google OAuth минув'));
      }, OAUTH_TIMEOUT_MS);

      authWindow.webContents.setWindowOpenHandler(({ url }) => {
        shell.openExternal(url);
        return { action: 'deny' };
      });

      await authWindow.loadURL(authUrl);
    } catch (err) {
      finish(reject, err);
    }
  });
}

module.exports = {
  USER_CANCELLED,
  runLoopbackOAuth,
  getGoogleOAuthConfig,
};
