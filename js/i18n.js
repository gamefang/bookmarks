const DEFAULT_LOCALE = 'en';

// Add new locales here. Keep translation keys identical across languages.
const messages = {
  en: {
    documentTitle: 'Bookmarks',
    appTitle: 'Bookmarks',
    toolbarLabel: 'Main toolbar',
    tagFilterLabel: 'Filter bookmarks by tag',
    bookmarkListLabel: 'Bookmarks',
    searchLabel: 'Search bookmarks',
    searchPlaceholder: '🔍 Search...',
    pullButton: '⬇ Pull',
    pushButton: '⬆ Push',
    addButton: '＋ Add',
    settingsButton: '⚙ Settings',
    emptyBookmarks: 'No bookmarks yet. Add one to get started.',
    noSearchResults: 'No bookmarks match your search.',
    noTagResults: 'No bookmarks have this tag.',
    settingsTitle: 'Settings',
    gistIdLabel: 'GitHub Gist ID',
    gistIdPlaceholder: 'https://gist.github.com/yourname/{gist_id} -> Copy This',
    tokenLabel: 'GitHub Token',
    tokenPlaceholder: 'Settings.Developer settings.Personal access tokens.Tokens(classic).Generate new token -> Copy This',
    tokenHint: 'The token is only needed if a push is required.',
    nameLabel: 'Name',
    namePlaceholder: 'Bookmark name',
    urlLabel: 'URL',
    urlPlaceholder: 'https://example.com',
    descriptionLabel: 'Description',
    descriptionPlaceholder: 'A short description',
    tagsLabel: 'Tags',
    selectedTagsLabel: 'Selected tags',
    tagsPlaceholder: 'Type or select tags...',
    tagsCreateOption: 'Create “{tag}”',
    removeTagAction: 'Remove {tag}',
    saveButton: 'Save',
    cancelButton: 'Cancel',
    addDialogTitle: '＋ Add bookmark',
    editDialogTitle: '✏️ Edit bookmark',
    editAction: 'Edit {name}',
    deleteAction: 'Delete {name}',
    confirmDelete: 'Delete “{name}”?',
    confirmPullOverwrite: 'Pulling will replace your unsynced local changes. Continue?',
    statusLocalOnly: 'Local mode. Add a Gist ID in Settings to enable synchronization.',
    statusUnsynced: 'You have unsynced local changes. Push them, or pull to replace them.',
    statusSettingsSaved: 'Settings saved.',
    statusPulling: 'Pulling from GitHub...',
    statusPushing: 'Pushing to GitHub...',
    statusPulled: 'Loaded {count} bookmarks. Last updated: {date}.',
    statusPushSuccess: 'Synchronization complete.',
    statusPushOutdated: 'The saved snapshot was pushed, but newer local changes remain unsynced.',
    statusPullFailed: 'Pull failed: {error}',
    statusPushFailed: 'Push failed: {error}',
    statusSavedLocal: 'Changes saved locally. Push to synchronize with GitHub.',
    statusDeletedLocal: 'Bookmark deleted locally. Push to synchronize with GitHub.',
    statusChangesReverted: 'No unsynced changes. Your bookmarks match the last synchronized version.',
    statusClipboardUrl: 'URL pasted from clipboard.',
    statusMetadataLoaded: 'Page details filled from the website.',
    statusLocalStorageError: 'Could not save data to browser storage. Check available storage space and permissions.',
    errorGistIdRequired: 'Add a GitHub Gist ID in Settings first.',
    errorCredentialsRequired: 'Add both a GitHub Gist ID and a GitHub Token in Settings first.',
    errorGistFileMissing: 'The Gist does not contain the file “{filename}”.',
    errorGistFileTooLarge: 'The Gist file is marked as truncated. Import it another way or reduce its size.',
    errorNameRequired: 'A name is required.',
    errorInvalidUrl: 'Enter a valid HTTP or HTTPS URL.',
    errorTagSeparator: 'The | character cannot be used inside a tag.',
    errorCsvUnfinishedQuote: 'The CSV contains an unfinished quoted field.',
    errorCsvHeader: 'Expected CSV columns: name, url, desc, tags.',
    errorCsvRow: 'Invalid bookmark on CSV row {row}: {details}',
    errorNetwork: 'The network request failed.',
    errorLocalChangedDuringPull: 'Local data changed while the pull was in progress. The remote data was not applied.',
    metaSummary: '{count} bookmarks · {state}',
    syncStateClean: 'All changes saved locally',
    syncStateDirty: 'Unsynced changes',
    dateUnknown: 'unknown'
  }
};

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
  const template = messages[currentLocale]?.[key] ?? messages[DEFAULT_LOCALE]?.[key] ?? key;
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