// Generic localStorage wrapper. Values are stored as JSON when possible.
export const StorageKeys = Object.freeze({
  BOOKMARKS: 'bm_items',
  DIRTY: 'bm_dirty',
  SYNCED_FINGERPRINT: 'bm_synced_fingerprint',
  GIST_ID: 'bm_gist',
  GITHUB_TOKEN: 'bm_token',
  LOCALE: 'bm_locale'
});

export const LocalStore = Object.freeze({
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },

  // Also accepts legacy values that were stored as plain, unquoted strings.
  getString(key, fallback = '') {
    try {
      const raw = localStorage.getItem(key);
      if (raw === null) return fallback;

      try {
        const value = JSON.parse(raw);
        return typeof value === 'string' ? value : String(value);
      } catch {
        return raw;
      }
    } catch {
      return fallback;
    }
  },

  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch {
      return false;
    }
  },

  remove(key) {
    try {
      localStorage.removeItem(key);
      return true;
    } catch {
      return false;
    }
  }
});