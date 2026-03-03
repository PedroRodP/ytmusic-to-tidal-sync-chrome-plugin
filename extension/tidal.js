import { getPlaylistId } from './storage.js';
import { getValidAccessToken } from './oauth.js';

const TIDAL_API_BASE = 'https://openapi.tidal.com/v2';

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function containsUnwantedQualifier(title, originalTitle) {
  const normalizedTitle = normalizeText(title);
  const normalizedOriginal = normalizeText(originalTitle);
  const disallowed = ['karaoke', 'live', 'remix'];

  return disallowed.some((word) => {
    if (!normalizedTitle.includes(word)) return false;
    return !normalizedOriginal.includes(word);
  });
}

function tokenSimilarity(a, b) {
  const aTokens = new Set(normalizeText(a).split(' ').filter(Boolean));
  const bTokens = new Set(normalizeText(b).split(' ').filter(Boolean));
  if (!aTokens.size || !bTokens.size) return 0;

  let inter = 0;
  aTokens.forEach((t) => {
    if (bTokens.has(t)) inter += 1;
  });

  return inter / Math.max(aTokens.size, bTokens.size);
}

function scoreTrackCandidate(candidate, inputTitle, inputArtist) {
  const candidateTitle = candidate?.attributes?.title || '';
  const candidateArtist =
    candidate?.attributes?.artists?.[0]?.name || candidate?.relationships?.artists?.data?.[0]?.attributes?.name || '';

  if (!candidateTitle || !candidateArtist) return 0;
  if (containsUnwantedQualifier(candidateTitle, inputTitle)) return 0;

  const normalizedInputArtist = normalizeText(inputArtist);
  const normalizedCandidateArtist = normalizeText(candidateArtist);

  const exactArtist =
    normalizedCandidateArtist === normalizedInputArtist ||
    normalizedCandidateArtist.includes(normalizedInputArtist) ||
    normalizedInputArtist.includes(normalizedCandidateArtist);

  const artistScore = exactArtist ? 1 : tokenSimilarity(inputArtist, candidateArtist);
  const titleScore = tokenSimilarity(inputTitle, candidateTitle);

  return 0.6 * artistScore + 0.4 * titleScore;
}

async function authorizedFetch(path, init = {}) {
  const token = await getValidAccessToken();
  if (!token) {
    throw new Error('AUTH_REQUIRED');
  }

  const response = await fetch(`${TIDAL_API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers || {})
    }
  });

  if (response.status === 401 || response.status === 403) {
    throw new Error('FATAL_AUTH_ERROR');
  }

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`TIDAL_API_ERROR:${response.status}:${text}`);
  }

  const contentType = response.headers.get('content-type') || '';
  return contentType.includes('application/json') ? response.json() : null;
}

export async function searchBestTidalTrack({ title, artist, threshold = 0.85 }) {
  const query = `${artist} - ${title}`.trim();
  const params = new URLSearchParams({
    query,
    type: 'tracks',
    limit: '10'
  });

  const result = await authorizedFetch(`/search?${params.toString()}`, { method: 'GET' });
  const tracks = result?.data || result?.tracks?.items || [];

  let best = null;
  let bestScore = 0;

  tracks.forEach((track) => {
    const score = scoreTrackCandidate(track, title, artist);
    if (score > bestScore) {
      bestScore = score;
      best = track;
    }
  });

  if (!best || bestScore < threshold) {
    return { found: false, score: bestScore, track: null };
  }

  return { found: true, score: bestScore, track: best };
}

export async function getPlaylistItems(playlistId) {
  return authorizedFetch(`/playlists/${encodeURIComponent(playlistId)}/items`, { method: 'GET' });
}

function extractTrackIdsFromPlaylistItems(payload) {
  const items = payload?.data || payload?.items || [];
  const ids = new Set();

  items.forEach((item) => {
    const directId = item?.id || item?.attributes?.id;
    if (directId) ids.add(String(directId));

    const relationshipId = item?.relationships?.item?.data?.id || item?.relationships?.track?.data?.id;
    if (relationshipId) ids.add(String(relationshipId));
  });

  return ids;
}

export async function addTrackToConfiguredPlaylist(tidalTrackId) {
  const playlistId = await getPlaylistId();
  if (!playlistId) {
    throw new Error('PLAYLIST_ID_NOT_SET');
  }

  const existing = await getPlaylistItems(playlistId);
  const existingIds = extractTrackIdsFromPlaylistItems(existing);
  if (existingIds.has(String(tidalTrackId))) {
    return { added: false, duplicate: true };
  }

  await authorizedFetch(`/playlists/${encodeURIComponent(playlistId)}/items`, {
    method: 'POST',
    body: JSON.stringify({
      data: [{
        id: String(tidalTrackId),
        type: 'tracks'
      }]
    })
  });

  return { added: true, duplicate: false };
}
