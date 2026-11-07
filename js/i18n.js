// Localization System
import { config } from './config.js';

const DEFAULT_LOCALE = config.i18n.defaultLocale;
const messages = config.i18n.messages;

let currentLocale = DEFAULT_LOCALE;

export function setLocale(locale) {
  currentLocale = Object.hasOwn(messages, locale) ? locale : DEFAULT_LOCALE;
  document.documentElement.lang = currentLocale;
  applyTranslations();
}

export function getLocale() {
  return currentLocale;
}

export function t(key, values = {}) {
  const template = messages[currentLocale]?.[key]
    ?? messages[DEFAULT_LOCALE]?.[key]
    ?? key;

  return String(template).replace(/\{(\w+)\}/g, (match, name) => {
    return Object.hasOwn(values, name) ? String(values[name]) : match;
  });
}

export function applyTranslations(root = document) {
  const title = root.querySelector('title[data-i18n]');
  if (title) document.title = t(title.dataset.i18n);

  root.querySelectorAll('[data-i18n]').forEach((element) => {
    element.textContent = t(element.dataset.i18n);
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach((element) => {
    element.setAttribute('placeholder', t(element.dataset.i18nPlaceholder));
  });

  root.querySelectorAll('[data-i18n-title]').forEach((element) => {
    element.setAttribute('title', t(element.dataset.i18nTitle));
  });

  root.querySelectorAll('[data-i18n-aria-label]').forEach((element) => {
    element.setAttribute('aria-label', t(element.dataset.i18nAriaLabel));
  });
}