// Generic Github Gist Services
import { config } from './config.js';

const GITHUB_API = config.gist.apiBase;

class GistServiceError extends Error {
  constructor(key, params = {}) {
    super(key);
    this.key = key;
    this.params = params;
  }
}

async function request(url, options = {}) {
  let response;

  try {
    response = await fetch(url, options);
  } catch (error) {
    throw new GistServiceError('errorNetwork', {
      details: error?.message || ''
    });
  }

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    throw new Error(data?.message || `${response.status} ${response.statusText}`);
  }

  return data;
}

// Gist access is content-agnostic so other features can reuse this service.
export const GistService = Object.freeze({
  async readFile(gistId, filename, token = '') {
    const headers = {
      Accept: 'application/vnd.github+json'
    };

    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    const gist = await request(`${GITHUB_API}/gists/${encodeURIComponent(gistId)}`, {
      headers
    });

    const file = gist?.files?.[filename];

    if (!file) {
      throw new GistServiceError('errorGistFileMissing', { filename });
    }

    if (file.truncated) {
      throw new GistServiceError('errorGistFileTooLarge');
    }

    return {
      content: file.content ?? '',
      updatedAt: gist.updated_at ?? null
    };
  },

  async writeFile(gistId, token, filename, content) {
    return request(`${GITHUB_API}/gists/${encodeURIComponent(gistId)}`, {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        files: {
          [filename]: { content }
        }
      })
    });
  }
});