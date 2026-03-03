import { configureTidalOAuthClientId, getAuthStatus, loginWithTidal, logoutTidal } from './oauth.js';
import { getPlaylistId, setPlaylistId, STORAGE_KEYS } from './storage.js';

const statusEl = document.getElementById('status');
const clientIdInput = document.getElementById('clientIdInput');
const playlistIdInput = document.getElementById('playlistIdInput');
const saveButton = document.getElementById('saveButton');
const loginButton = document.getElementById('loginButton');
const logoutButton = document.getElementById('logoutButton');

function setStatus(text, kind = '') {
  statusEl.className = kind;
  statusEl.textContent = text;
}

function getLocalStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (data) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'STORAGE_GET_FAILED'));
        return;
      }
      resolve(data);
    });
  });
}

function setLocalStorage(values) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(values, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'STORAGE_SET_FAILED'));
        return;
      }
      resolve();
    });
  });
}

async function refreshUi() {
  const playlistId = await getPlaylistId();
  const status = await getAuthStatus();
  const raw = await getLocalStorage(['tidal_client_id']);

  clientIdInput.value = raw.tidal_client_id || '';
  playlistIdInput.value = playlistId;

  if (!clientIdInput.value) {
    setStatus('Set your TIDAL Client ID first.', 'warn');
    return;
  }

  if (status.loggedIn) {
    const expires = status.expiresAt ? new Date(status.expiresAt).toLocaleString() : 'Unknown';
    setStatus(`Logged in. Token expires: ${expires}`, 'ok');
  } else {
    setStatus('Not logged in.', 'warn');
  }
}

saveButton.addEventListener('click', async () => {
  try {
    const clientId = clientIdInput.value.trim();
    const playlistId = playlistIdInput.value.trim();

    await setLocalStorage({ tidal_client_id: clientId });
    await setPlaylistId(playlistId);
    configureTidalOAuthClientId(clientId);

    setStatus('Saved settings.', 'ok');
  } catch (error) {
    setStatus(`Save failed: ${error.message}`, 'err');
  }
});

loginButton.addEventListener('click', async () => {
  try {
    const clientId = clientIdInput.value.trim();
    if (!clientId) {
      setStatus('Client ID is required before login.', 'warn');
      return;
    }

    configureTidalOAuthClientId(clientId);
    await loginWithTidal();
    await refreshUi();
  } catch (error) {
    setStatus(`Login failed: ${error.message}`, 'err');
  }
});

logoutButton.addEventListener('click', async () => {
  try {
    await logoutTidal();
    await refreshUi();
  } catch (error) {
    setStatus(`Logout failed: ${error.message}`, 'err');
  }
});

(async () => {
  const data = await getLocalStorage(['tidal_client_id', STORAGE_KEYS.PLAYLIST_ID]);
  configureTidalOAuthClientId(data.tidal_client_id || '');
  await refreshUi();
})();
