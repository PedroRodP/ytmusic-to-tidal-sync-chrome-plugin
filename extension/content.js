(async () => {
  const { getTrackSyncState, setTrackSyncState, getDebugMode } = await import(chrome.runtime.getURL('storage.js'));
  const { searchBestTidalTrack, addTrackToConfiguredPlaylist } = await import(chrome.runtime.getURL('tidal.js'));

  const DEBUG = await getDebugMode().catch(() => false);
  const injectedRows = new WeakSet();
  let observer = null;
  let bulkSyncRunning = false;

  const BUTTON_CLASS = 'ytm-tidal-sync-button';
  const BULK_BUTTON_ID = 'ytm-tidal-sync-all-button';

  function log(...args) {
    if (DEBUG) console.log('[ytm-tidal-sync]', ...args);
  }

  function isLikedSongsPage() {
    return location.pathname.includes('/playlist') && /LM|likes/i.test(location.href);
  }

  function wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function extractVideoIdFromRow(row) {
    const anchor = row.querySelector('a[href*="watch?v="]');
    if (!anchor) return '';
    const url = new URL(anchor.href, location.origin);
    return url.searchParams.get('v') || '';
  }

  function extractTrackInfo(row) {
    const titleEl = row.querySelector('yt-formatted-string.title, .title-column yt-formatted-string, [title]');
    const subtitle = row.querySelector('yt-formatted-string.byline, .secondary-flex-columns yt-formatted-string');

    const title = (titleEl?.getAttribute('title') || titleEl?.textContent || '').trim();
    const artistRaw = (subtitle?.textContent || '').trim();
    const artist = artistRaw.split('•')[0]?.trim() || artistRaw;
    const videoId = extractVideoIdFromRow(row) || row.getAttribute('data-row-id') || `${normalizeKey(artist)}-${normalizeKey(title)}`;

    if (!title || !artist) return null;

    return { title, artist, videoId };
  }

  function normalizeKey(v) {
    return String(v || '').toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
  }

  function buttonStateMeta(state) {
    switch (state) {
      case 'syncing':
        return { text: '⏳ Syncing', css: 'syncing', disabled: true };
      case 'synced':
        return { text: '✅ Synced', css: 'synced', disabled: false };
      case 'not_found':
        return { text: '🔍 Not found', css: 'not-found', disabled: false };
      case 'error':
        return { text: '❌ Error', css: 'error', disabled: false };
      default:
        return { text: '🎵 Sync to TIDAL', css: 'unsynced', disabled: false };
    }
  }

  function applyButtonState(button, state) {
    const meta = buttonStateMeta(state);
    button.textContent = meta.text;
    button.disabled = meta.disabled;
    button.dataset.state = state;
    button.classList.remove('unsynced', 'syncing', 'synced', 'not-found', 'error');
    button.classList.add(meta.css);
  }

  async function syncTrack(track, button) {
    try {
      applyButtonState(button, 'syncing');
      const found = await searchBestTidalTrack({ title: track.title, artist: track.artist, threshold: 0.85 });

      if (!found.found || !found.track?.id) {
        await setTrackSyncState(track.videoId, {
          tidalTrackId: '',
          status: 'not_found',
          syncedAt: Date.now()
        });
        applyButtonState(button, 'not_found');
        return { ok: true, status: 'not_found' };
      }

      await addTrackToConfiguredPlaylist(found.track.id);
      await setTrackSyncState(track.videoId, {
        tidalTrackId: String(found.track.id),
        status: 'synced',
        syncedAt: Date.now()
      });
      applyButtonState(button, 'synced');
      return { ok: true, status: 'synced' };
    } catch (error) {
      log('Track sync error:', error);
      const status = error.message === 'AUTH_REQUIRED' || error.message === 'FATAL_AUTH_ERROR' ? 'error' : 'error';
      await setTrackSyncState(track.videoId, {
        tidalTrackId: '',
        status,
        syncedAt: Date.now()
      });
      applyButtonState(button, 'error');

      if (error.message === 'AUTH_REQUIRED' || error.message === 'FATAL_AUTH_ERROR') {
        return { ok: false, fatal: true, error };
      }

      return { ok: false, fatal: false, error };
    }
  }

  async function injectButtonForRow(row) {
    if (!row || injectedRows.has(row)) return;
    const track = extractTrackInfo(row);
    if (!track || !track.videoId) return;

    const existing = row.querySelector(`.${BUTTON_CLASS}`);
    if (existing) {
      injectedRows.add(row);
      return;
    }

    const targetCell = row.querySelector('.fixed-columns, .middle-controls, .song-row') || row;
    const button = document.createElement('button');
    button.className = `${BUTTON_CLASS} unsynced`;
    button.type = 'button';
    button.dataset.videoId = track.videoId;

    const existingState = await getTrackSyncState(track.videoId);
    const mappedState = existingState?.status || 'unsynced';
    applyButtonState(button, mappedState);

    button.addEventListener('click', async (event) => {
      event.preventDefault();
      event.stopPropagation();
      await syncTrack(track, button);
    });

    targetCell.appendChild(button);
    injectedRows.add(row);
  }

  async function scanAndInject() {
    if (!isLikedSongsPage()) return;

    const rows = document.querySelectorAll('ytmusic-responsive-list-item-renderer');
    for (const row of rows) {
      await injectButtonForRow(row);
    }

    ensureBulkButton();
  }

  function getTrackRows() {
    return Array.from(document.querySelectorAll('ytmusic-responsive-list-item-renderer'));
  }

  async function syncAllUnsynced() {
    if (bulkSyncRunning) return;
    bulkSyncRunning = true;

    try {
      const rows = getTrackRows();
      for (const row of rows) {
        const button = row.querySelector(`.${BUTTON_CLASS}`);
        if (!button) continue;
        const state = button.dataset.state || 'unsynced';
        if (state === 'synced' || state === 'syncing') continue;

        const track = extractTrackInfo(row);
        if (!track) continue;

        const result = await syncTrack(track, button);
        if (result.fatal) {
          log('Bulk sync stopped on fatal auth error.');
          break;
        }

        await wait(500);
      }
    } finally {
      bulkSyncRunning = false;
    }
  }

  function ensureBulkButton() {
    if (!isLikedSongsPage()) return;
    if (document.getElementById(BULK_BUTTON_ID)) return;

    const header = document.querySelector('ytmusic-playlist-header-renderer #buttons, ytmusic-playlist-header-renderer');
    if (!header) return;

    const bulkButton = document.createElement('button');
    bulkButton.id = BULK_BUTTON_ID;
    bulkButton.type = 'button';
    bulkButton.textContent = 'Sync All Unsynced';
    bulkButton.className = 'ytm-tidal-sync-all';
    bulkButton.addEventListener('click', (event) => {
      event.preventDefault();
      syncAllUnsynced();
    });

    header.appendChild(bulkButton);
  }

  function observeDom() {
    if (observer) observer.disconnect();

    observer = new MutationObserver(() => {
      scanAndInject().catch((e) => log('scanAndInject failed', e));
    });

    observer.observe(document.body, { childList: true, subtree: true });
  }

  window.addEventListener('yt-navigate-finish', () => {
    scanAndInject().catch((e) => log('navigation scan failed', e));
  });

  window.addEventListener('beforeunload', () => {
    if (observer) observer.disconnect();
  });

  observeDom();
  scanAndInject().catch((e) => log('initial scan failed', e));
})();
