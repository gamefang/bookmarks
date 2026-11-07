// Generic localStorage wrapper
import { config } from './config.js';

// Storage key names are configured in config.json.
export const StorageKeys = Object.freeze(config.storage.keys);

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