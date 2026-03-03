import { clearOAuthData, getOAuthData, setOAuthData } from './storage.js';

const TIDAL_OAUTH_CONFIG = {
  clientId: '',
  authorizeEndpoint: 'https://auth.tidal.com/v1/oauth2/authorize',
  tokenEndpoint: 'https://auth.tidal.com/v1/oauth2/token',
  scope: 'r_usr+w_usr+w_sub'
};

function toBase64Url(bytes) {
  const str = btoa(String.fromCharCode(...bytes));
  return str.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

async function sha256Base64Url(input) {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return toBase64Url(new Uint8Array(digest));
}

function randomString(length = 64) {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes).slice(0, length);
}

function assertClientId() {
  if (!TIDAL_OAUTH_CONFIG.clientId) {
    throw new Error('MISSING_TIDAL_CLIENT_ID');
  }
}

async function getRedirectUri() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: 'GET_REDIRECT_URI' }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'REDIRECT_URI_ERROR'));
        return;
      }
      if (!response?.ok || !response?.redirectUri) {
        reject(new Error(response?.error || 'REDIRECT_URI_MISSING'));
        return;
      }
      resolve(response.redirectUri);
    });
  });
}

function validateRedirectUri(redirectUri) {
  const expectedPrefix = chrome.identity.getRedirectURL();
  if (!redirectUri.startsWith(expectedPrefix)) {
    throw new Error('INVALID_REDIRECT_ORIGIN');
  }
}

function parseOAuthResponse(redirectUri) {
  const url = new URL(redirectUri);
  const error = url.searchParams.get('error');
  if (error) {
    throw new Error(`OAUTH_ERROR:${error}`);
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  if (!code || !state) {
    throw new Error('OAUTH_CODE_OR_STATE_MISSING');
  }
  return { code, state };
}

async function runAuthFlow(url) {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(
      { type: 'OPEN_OAUTH_FLOW', payload: { url, interactive: true } },
      (response) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message || 'AUTH_FLOW_ERROR'));
          return;
        }
        if (!response?.ok || !response?.redirectUrl) {
          reject(new Error(response?.error || 'AUTH_FLOW_FAILED'));
          return;
        }
        resolve(response.redirectUrl);
      }
    );
  });
}

async function tokenRequest(bodyParams) {
  const body = new URLSearchParams(bodyParams);
  const response = await fetch(TIDAL_OAUTH_CONFIG.tokenEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });

  if (!response.ok) {
    const txt = await response.text();
    throw new Error(`TOKEN_REQUEST_FAILED:${response.status}:${txt}`);
  }

  return response.json();
}

function normalizeTokenPayload(payload) {
  const now = Date.now();
  const expiresIn = Number(payload.expires_in || 0);
  return {
    access_token: payload.access_token,
    refresh_token: payload.refresh_token || null,
    token_type: payload.token_type || 'Bearer',
    scope: payload.scope || '',
    expires_at: now + Math.max(expiresIn - 30, 0) * 1000
  };
}

export async function loginWithTidal() {
  assertClientId();

  const redirectUri = await getRedirectUri();
  const state = randomString(32);
  const codeVerifier = randomString(96);
  const codeChallenge = await sha256Base64Url(codeVerifier);

  const authUrl = new URL(TIDAL_OAUTH_CONFIG.authorizeEndpoint);
  authUrl.searchParams.set('response_type', 'code');
  authUrl.searchParams.set('client_id', TIDAL_OAUTH_CONFIG.clientId);
  authUrl.searchParams.set('redirect_uri', redirectUri);
  authUrl.searchParams.set('scope', TIDAL_OAUTH_CONFIG.scope);
  authUrl.searchParams.set('state', state);
  authUrl.searchParams.set('code_challenge', codeChallenge);
  authUrl.searchParams.set('code_challenge_method', 'S256');

  const callbackUrl = await runAuthFlow(authUrl.toString());
  validateRedirectUri(callbackUrl);

  const parsed = parseOAuthResponse(callbackUrl);
  if (parsed.state !== state) {
    throw new Error('STATE_MISMATCH');
  }

  const tokenPayload = await tokenRequest({
    grant_type: 'authorization_code',
    client_id: TIDAL_OAUTH_CONFIG.clientId,
    code: parsed.code,
    redirect_uri: redirectUri,
    code_verifier: codeVerifier
  });

  const normalized = normalizeTokenPayload(tokenPayload);
  await setOAuthData(normalized);
  return normalized;
}

export async function refreshAccessTokenIfNeeded(force = false) {
  const oauth = await getOAuthData();
  if (!oauth?.access_token) return null;

  const expired = !oauth.expires_at || Date.now() >= oauth.expires_at;
  if (!force && !expired) return oauth;

  if (!oauth.refresh_token) {
    await clearOAuthData();
    return null;
  }

  assertClientId();
  const tokenPayload = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: TIDAL_OAUTH_CONFIG.clientId,
    refresh_token: oauth.refresh_token
  });

  const normalized = normalizeTokenPayload({
    ...tokenPayload,
    refresh_token: tokenPayload.refresh_token || oauth.refresh_token
  });
  await setOAuthData(normalized);
  return normalized;
}

export async function getValidAccessToken() {
  const tokenData = await refreshAccessTokenIfNeeded(false);
  return tokenData?.access_token || null;
}

export async function logoutTidal() {
  await clearOAuthData();
}

export async function getAuthStatus() {
  const oauth = await getOAuthData();
  if (!oauth?.access_token) {
    return { loggedIn: false, expiresAt: null };
  }

  return {
    loggedIn: Date.now() < (oauth.expires_at || 0),
    expiresAt: oauth.expires_at || null
  };
}

export function configureTidalOAuthClientId(clientId) {
  TIDAL_OAUTH_CONFIG.clientId = String(clientId || '').trim();
}
