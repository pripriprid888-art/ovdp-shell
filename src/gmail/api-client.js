const { getGoogleOAuthConfig } = require('./oauth-config');
const tokenStore = require('./token-store');

function decodeBase64Url(data) {
  if (!data) return '';
  const normalized = String(data).replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4;
  const padded = pad ? normalized + '='.repeat(4 - pad) : normalized;
  return Buffer.from(padded, 'base64').toString('utf8');
}

async function refreshAccessToken(refreshToken) {
  const config = getGoogleOAuthConfig();
  const body = new URLSearchParams({
    client_id: config.clientId,
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
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
    throw new Error(data.error_description || data.error || 'Не вдалося оновити Gmail токен');
  }
  return data;
}

async function getValidAccessToken() {
  const tokens = tokenStore.readTokens();
  if (!tokens) throw new Error('Gmail не підключено');

  const expiry = Number(tokens.expiry_date) || 0;
  if (tokens.access_token && expiry > Date.now() + 60_000) {
    return tokens.access_token;
  }

  if (!tokens.refresh_token) {
    if (tokens.access_token) return tokens.access_token;
    throw new Error('Gmail: немає refresh token — підключіть пошту знову');
  }

  const refreshed = await refreshAccessToken(tokens.refresh_token);
  tokenStore.writeTokens({
    ...tokens,
    access_token: refreshed.access_token,
    expiry_date: refreshed.expires_in
      ? Date.now() + Number(refreshed.expires_in) * 1000
      : tokens.expiry_date,
    scope: refreshed.scope || tokens.scope,
    token_type: refreshed.token_type || tokens.token_type,
  });
  return refreshed.access_token;
}

async function gmailApiRequest(path, accessToken) {
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const data = await response.json();
  if (!response.ok) {
    throw new Error(data.error?.message || 'Помилка Gmail API');
  }
  return data;
}

function collectMessageText(payload) {
  if (!payload) return '';
  const chunks = [];

  if (payload.body?.data) {
    chunks.push(decodeBase64Url(payload.body.data));
  }

  for (const part of payload.parts || []) {
    const mime = String(part.mimeType || '').toLowerCase();
    if (mime === 'text/plain' && part.body?.data) {
      chunks.push(decodeBase64Url(part.body.data));
    } else if (mime === 'text/html' && part.body?.data) {
      const html = decodeBase64Url(part.body.data);
      chunks.push(html.replace(/<[^>]+>/g, ' '));
    } else if (part.parts?.length) {
      chunks.push(collectMessageText(part));
    }
  }

  return chunks.join('\n').replace(/\s+/g, ' ').trim();
}

async function listMessageMetas(query, maxResults = 8) {
  const accessToken = await getValidAccessToken();
  const params = new URLSearchParams({
    q: query,
    maxResults: String(maxResults),
  });
  const list = await gmailApiRequest(`/messages?${params.toString()}`, accessToken);
  const ids = (list.messages || []).map((item) => item.id).filter(Boolean);
  if (!ids.length) return [];

  const metas = await Promise.all(
    ids.map(async (id) => {
      const meta = await gmailApiRequest(
        `/messages/${encodeURIComponent(id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        accessToken,
      );
      return {
        id,
        internalDate: Number(meta.internalDate) || 0,
        snippet: meta.snippet || '',
        subject: meta.payload?.headers?.find((h) => h.name === 'Subject')?.value || '',
        from: meta.payload?.headers?.find((h) => h.name === 'From')?.value || '',
      };
    }),
  );

  return metas.sort((a, b) => b.internalDate - a.internalDate);
}

async function getMessageText(messageId) {
  const accessToken = await getValidAccessToken();
  const message = await gmailApiRequest(
    `/messages/${encodeURIComponent(messageId)}?format=full`,
    accessToken,
  );
  const headerText = (message.payload?.headers || [])
    .filter((h) => /^(subject|from)$/i.test(h.name))
    .map((h) => h.value)
    .join(' ');
  const body = collectMessageText(message.payload);
  return `${headerText}\n${body}\n${message.snippet || ''}`.trim();
}

module.exports = {
  getValidAccessToken,
  listMessageMetas,
  getMessageText,
  decodeBase64Url,
};
