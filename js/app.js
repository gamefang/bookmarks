import { getLocale, setLocale, t } from './i18n.js';
import { LocalStore, StorageKeys } from './storage.js';
import { GistService } from './gist.js';
import {
  createBookmark,
  isSafeWebUrl,
  normalizeBookmark,
  parseBookmarksCSV,
  serializeBookmarksCSV
} from './bookmarks.js';

const GIST_FILENAME = 'bookmarks.csv';

const elements = {
  search: document.querySelector('#searchInput'),
  pullButton: document.querySelector('#pullButton'),
  pushButton: document.querySelector('#pushButton'),
  addButton: document.querySelector('#addButton'),
  settingsButton: document.querySelector('#settingsButton'),
  status: document.querySelector('#status'),
  tagBar: document.querySelector('#tagBar'),
  grid: document.querySelector('#bookmarkGrid'),
  emptyState: document.querySelector('#emptyState'),
  meta: document.querySelector('#meta'),
  settingsDialog: document.querySelector('#settingsDialog'),
  settingsForm: document.querySelector('#settingsForm'),
  gistId: document.querySelector('#gistIdInput'),
  token: document.querySelector('#tokenInput'),
  cancelSettingsButton: document.querySelector('#cancelSettingsButton'),
  bookmarkDialog: document.querySelector('#bookmarkDialog'),
  bookmarkDialogTitle: document.querySelector('#bookmarkDialogTitle'),
  bookmarkForm: document.querySelector('#bookmarkForm'),
  bookmarkIndex: document.querySelector('#bookmarkIndexInput'),
  name: document.querySelector('#nameInput'),
  url: document.querySelector('#urlInput'),
  description: document.querySelector('#descriptionInput'),
  tags: document.querySelector('#tagsInput'),
  cancelBookmarkButton: document.querySelector('#cancelBookmarkButton')
};

let bookmarks = [];
let isDirty = false;
let isBusy = false;
let activeTag = null;
let revision = 0;

function readConfig() {
  return {
    gistId: LocalStore.getString(StorageKeys.GIST_ID).trim(),
    token: LocalStore.getString(StorageKeys.GITHUB_TOKEN).trim()
  };
}

function persistState() {
  return LocalStore.set(StorageKeys.BOOKMARKS, bookmarks)
    && LocalStore.set(StorageKeys.DIRTY, isDirty);
}

function setStatus(message, type = '') {
  elements.status.textContent = message;
  elements.status.className = `status${type ? ` ${type}` : ''}`;
}

function setBusy(value) {
  isBusy = value;
  elements.pullButton.disabled = value;
  elements.pushButton.disabled = value;
}

function markChanged(message = t('statusSavedLocal')) {
  isDirty = true;
  revision += 1;

  if (!persistState()) {
    setStatus(t('statusLocalStorageError'), 'error');
  } else {
    setStatus(message);
  }

  render();
}

function createTagButton(tag) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tag-filter';
  button.textContent = tag;
  button.dataset.tag = tag;
  button.setAttribute('aria-pressed', String(activeTag === tag));
  return button;
}

function createActionButton(action, index, name) {
  const button = document.createElement('button');
  const isEdit = action === 'edit';
  button.type = 'button';
  button.className = 'icon-button';
  button.dataset.action = action;
  button.dataset.index = String(index);
  button.textContent = isEdit ? '✏️' : '🗑';
  button.title = t(isEdit ? 'editAction' : 'deleteAction', { name });
  button.setAttribute('aria-label', button.title);
  return button;
}

function createBookmarkCard(bookmark, index) {
  const card = document.createElement('article');
  card.className = 'bookmark-card';

  const actions = document.createElement('div');
  actions.className = 'bookmark-actions';
  actions.append(
    createActionButton('edit', index, bookmark.name),
    createActionButton('delete', index, bookmark.name)
  );
  card.append(actions);

  const heading = document.createElement('h2');
  heading.className = 'bookmark-title';

  if (isSafeWebUrl(bookmark.url)) {
    const link = document.createElement('a');
    link.href = bookmark.url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = bookmark.name;
    heading.append(link);
  } else {
    heading.textContent = bookmark.name;
  }
  card.append(heading);

  const urlText = document.createElement('p');
  urlText.className = 'bookmark-url';
  urlText.textContent = bookmark.url;
  card.append(urlText);

  if (bookmark.desc) {
    const description = document.createElement('p');
    description.className = 'bookmark-description';
    description.textContent = bookmark.desc;
    card.append(description);
  }

  if (bookmark.tags.length) {
    const tagList = document.createElement('div');
    tagList.className = 'bookmark-tags';

    bookmark.tags.forEach((tag) => {
      const tagElement = document.createElement('span');
      tagElement.className = 'bookmark-tag';
      tagElement.textContent = tag;
      tagList.append(tagElement);
    });

    card.append(tagList);
  }

  return card;
}

function render() {
  const query = elements.search.value.trim().toLocaleLowerCase(getLocale());
  const allTags = [...new Set(bookmarks.flatMap((bookmark) => bookmark.tags))]
    .sort((a, b) => a.localeCompare(b, getLocale()));

  if (activeTag && !allTags.includes(activeTag)) activeTag = null;

  elements.tagBar.replaceChildren(...allTags.map(createTagButton));
  elements.grid.replaceChildren();

  const visibleBookmarks = bookmarks
    .map((bookmark, index) => ({ bookmark, index }))
    .filter(({ bookmark }) => {
      if (activeTag && !bookmark.tags.includes(activeTag)) return false;
      if (!query) return true;

      return [bookmark.name, bookmark.url, bookmark.desc, ...bookmark.tags]
        .some((value) => value.toLocaleLowerCase(getLocale()).includes(query));
    });

  visibleBookmarks.forEach(({ bookmark, index }) => {
    elements.grid.append(createBookmarkCard(bookmark, index));
  });

  elements.emptyState.hidden = visibleBookmarks.length > 0;
  if (!visibleBookmarks.length) {
    if (bookmarks.length && (query || activeTag)) {
      elements.emptyState.textContent = activeTag && !query
        ? t('noTagResults')
        : t('noSearchResults');
    } else {
      elements.emptyState.textContent = t('emptyBookmarks');
    }
  }

  const state = isDirty ? t('syncStateDirty') : t('syncStateClean');
  elements.meta.textContent = t('metaSummary', { count: bookmarks.length, state });
}

function openBookmarkDialog(index = -1) {
  const bookmark = index >= 0 ? bookmarks[index] : null;
  if (index >= 0 && !bookmark) return;

  elements.bookmarkForm.reset();
  elements.bookmarkIndex.value = String(index);
  elements.bookmarkDialogTitle.textContent = t(index >= 0 ? 'editDialogTitle' : 'addDialogTitle');
  elements.name.value = bookmark?.name ?? '';
  elements.url.value = bookmark?.url ?? '';
  elements.description.value = bookmark?.desc ?? '';
  elements.tags.value = bookmark?.tags.join('|') ?? '';
  elements.bookmarkDialog.showModal();
  elements.name.focus();
}

function saveBookmark(event) {
  event.preventDefault();

  const index = Number.parseInt(elements.bookmarkIndex.value, 10);
  let bookmark;

  try {
    bookmark = createBookmark({
      name: elements.name.value,
      url: elements.url.value,
      desc: elements.description.value,
      tags: elements.tags.value.split('|')
    });
  } catch (error) {
    setStatus(localizeError(error), 'error');
    return;
  }

  if (index >= 0) {
    bookmarks[index] = bookmark;
  } else {
    bookmarks.unshift(bookmark);
  }

  elements.bookmarkDialog.close();
  markChanged();
}

function deleteBookmark(index) {
  const bookmark = bookmarks[index];
  if (!bookmark) return;
  if (!window.confirm(t('confirmDelete', { name: bookmark.name }))) return;

  bookmarks.splice(index, 1);
  markChanged(t('statusDeletedLocal'));
}

function openSettings() {
  const config = readConfig();
  elements.gistId.value = config.gistId;
  elements.token.value = config.token;
  elements.settingsDialog.showModal();
}

function saveSettings(event) {
  event.preventDefault();

  const gistIdSaved = LocalStore.set(StorageKeys.GIST_ID, elements.gistId.value.trim());
  const tokenSaved = LocalStore.set(StorageKeys.GITHUB_TOKEN, elements.token.value.trim());

  if (!gistIdSaved || !tokenSaved) {
    setStatus(t('statusLocalStorageError'), 'error');
    return;
  }

  elements.settingsDialog.close();
  setStatus(t('statusSettingsSaved'));
}

function localizeError(error) {
  if (error?.key === 'errorCsvRow') {
    return t(error.key, {
      ...error.params,
      details: localizeError(error.cause)
    });
  }
  if (error?.key) return t(error.key, error.params ?? {});
  return error?.message || String(error);
}

function formatDate(value) {
  if (!value) return t('dateUnknown');
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? t('dateUnknown') : date.toLocaleString(getLocale());
}

async function pullBookmarks() {
  if (isBusy) return;

  const { gistId } = readConfig();
  if (!gistId) {
    setStatus(t('errorGistIdRequired'), 'error');
    return;
  }

  if (isDirty && !window.confirm(t('confirmPullOverwrite'))) return;

  const startRevision = revision;
  setBusy(true);
  setStatus(t('statusPulling'));

  try {
    const remote = await GistService.readFile(gistId, GIST_FILENAME);
    const incoming = parseBookmarksCSV(remote.content);

    if (revision !== startRevision) {
      throw new Error(t('errorLocalChangedDuringPull'));
    }

    bookmarks = incoming;
    isDirty = false;
    revision += 1;
    activeTag = null;

    if (!persistState()) {
      setStatus(t('statusLocalStorageError'), 'error');
    } else {
      setStatus(t('statusPulled', {
        count: bookmarks.length,
        date: formatDate(remote.updatedAt)
      }), 'success');
    }

    render();
  } catch (error) {
    setStatus(t('statusPullFailed', { error: localizeError(error) }), 'error');
  } finally {
    setBusy(false);
  }
}

async function pushBookmarks() {
  if (isBusy) return;

  const { gistId, token } = readConfig();
  if (!gistId || !token) {
    setStatus(t('errorCredentialsRequired'), 'error');
    return;
  }

  const startRevision = revision;
  const content = serializeBookmarksCSV(bookmarks);
  setBusy(true);
  setStatus(t('statusPushing'));

  try {
    await GistService.writeFile(gistId, token, GIST_FILENAME, content);

    if (revision === startRevision) {
      isDirty = false;
      if (!persistState()) {
        setStatus(t('statusLocalStorageError'), 'error');
      } else {
        setStatus(t('statusPushSuccess'), 'success');
      }
    } else {
      isDirty = true;
      persistState();
      setStatus(t('statusPushOutdated'));
    }

    render();
  } catch (error) {
    setStatus(t('statusPushFailed', { error: localizeError(error) }), 'error');
  } finally {
    setBusy(false);
  }
}

function loadBookmarks() {
  const saved = LocalStore.get(StorageKeys.BOOKMARKS, []);
  bookmarks = Array.isArray(saved)
    ? saved.map((item) => normalizeBookmark(item ?? {})).filter((bookmark) => bookmark.name && bookmark.url)
    : [];
  isDirty = Boolean(LocalStore.get(StorageKeys.DIRTY, false));
}

function bindEvents() {
  elements.search.addEventListener('input', render);
  elements.pullButton.addEventListener('click', pullBookmarks);
  elements.pushButton.addEventListener('click', pushBookmarks);
  elements.addButton.addEventListener('click', () => openBookmarkDialog());
  elements.settingsButton.addEventListener('click', openSettings);

  elements.settingsForm.addEventListener('submit', saveSettings);
  elements.bookmarkForm.addEventListener('submit', saveBookmark);
  elements.cancelSettingsButton.addEventListener('click', () => elements.settingsDialog.close());
  elements.cancelBookmarkButton.addEventListener('click', () => elements.bookmarkDialog.close());

  elements.tagBar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-tag]');
    if (!button) return;
    activeTag = activeTag === button.dataset.tag ? null : button.dataset.tag;
    render();
  });

  elements.grid.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    if (!button) return;

    const index = Number.parseInt(button.dataset.index, 10);
    if (!Number.isInteger(index)) return;

    if (button.dataset.action === 'edit') openBookmarkDialog(index);
    if (button.dataset.action === 'delete') deleteBookmark(index);
  });
}

function init() {
  setLocale(LocalStore.getString(StorageKeys.LOCALE, 'en'));
  loadBookmarks();
  bindEvents();
  render();

  const { gistId } = readConfig();
  if (isDirty) {
    setStatus(t('statusUnsynced'));
  } else if (gistId) {
    pullBookmarks();
  } else {
    setStatus(t('statusLocalOnly'));
  }
}

init();
