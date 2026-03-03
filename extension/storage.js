const STORAGE_KEYS = {
  OAUTH: 'tidal_oauth',
  PLAYLIST_ID: 'tidal_playlist_id',
  TRACK_SYNC_MAP: 'track_sync_map',
  DEBUG: 'debug_mode'
};

function getFromStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(keys, (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'STORAGE_GET_FAILED'));
        return;
      }
      resolve(result);
    });
  });
}

function setInStorage(values) {
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

function removeFromStorage(keys) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.remove(keys, () => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message || 'STORAGE_REMOVE_FAILED'));
        return;
      }
      resolve();
    });
  });
}

export async function getOAuthData() {
  const data = await getFromStorage([STORAGE_KEYS.OAUTH]);
  return data[STORAGE_KEYS.OAUTH] || null;
}

export async function setOAuthData(oauthData) {
  await setInStorage({ [STORAGE_KEYS.OAUTH]: oauthData });
}

export async function clearOAuthData() {
  await removeFromStorage([STORAGE_KEYS.OAUTH]);
}

export async function getPlaylistId() {
  const data = await getFromStorage([STORAGE_KEYS.PLAYLIST_ID]);
  return data[STORAGE_KEYS.PLAYLIST_ID] || '';
}

export async function setPlaylistId(playlistId) {
  await setInStorage({ [STORAGE_KEYS.PLAYLIST_ID]: String(playlistId || '').trim() });
}

export async function getTrackSyncMap() {
  const data = await getFromStorage([STORAGE_KEYS.TRACK_SYNC_MAP]);
  return data[STORAGE_KEYS.TRACK_SYNC_MAP] || {};
}

export async function getTrackSyncState(youtubeVideoId) {
  if (!youtubeVideoId) return null;
  const map = await getTrackSyncMap();
  return map[youtubeVideoId] || null;
}

export async function setTrackSyncState(youtubeVideoId, state) {
  if (!youtubeVideoId) {
    throw new Error('YOUTUBE_VIDEO_ID_REQUIRED');
  }

  const map = await getTrackSyncMap();
  map[youtubeVideoId] = {
    ...state,
    syncedAt: state?.syncedAt || Date.now()
  };

  await setInStorage({ [STORAGE_KEYS.TRACK_SYNC_MAP]: map });
}

export async function removeTrackSyncState(youtubeVideoId) {
  if (!youtubeVideoId) return;
  const map = await getTrackSyncMap();
  delete map[youtubeVideoId];
  await setInStorage({ [STORAGE_KEYS.TRACK_SYNC_MAP]: map });
}

export async function clearTrackSyncMap() {
  await removeFromStorage([STORAGE_KEYS.TRACK_SYNC_MAP]);
}

export async function getDebugMode() {
  const data = await getFromStorage([STORAGE_KEYS.DEBUG]);
  return Boolean(data[STORAGE_KEYS.DEBUG]);
}

export async function setDebugMode(enabled) {
  await setInStorage({ [STORAGE_KEYS.DEBUG]: Boolean(enabled) });
}

export { STORAGE_KEYS };
