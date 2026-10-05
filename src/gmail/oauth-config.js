function getGoogleOAuthConfig() {
  const clientId = String(process.env.GOOGLE_CLIENT_ID || process.env.GOOGLE_OAUTH_CLIENT_ID || '').trim();
  const clientSecret = String(
    process.env.GOOGLE_CLIENT_SECRET || process.env.GOOGLE_OAUTH_CLIENT_SECRET || '',
  ).trim();

  if (!clientId) {
    return { configured: false, clientId: '', clientSecret: '' };
  }

  return {
    configured: true,
    clientId,
    clientSecret,
  };
}

module.exports = {
  getGoogleOAuthConfig,
  GMAIL_READONLY_SCOPE: 'https://www.googleapis.com/auth/gmail.readonly',
};
