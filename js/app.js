import { config } from './config.js';
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
  tagPicker: document.querySelector('#tagPicker'),
  selectedTags: document.querySelector('#selectedTags'),
  tags: document.querySelector('#tagsInput'),
  tagOptions: document.querySelector('#tagOptions'),
  cancelBookmarkButton: document.querySelector('#cancelBookmarkButton'),
  bookmarkActions: document.querySelector('#bookmarkForm .dialog-actions'),
  appTitle: document.querySelector('#appTitle'),
  managerTitle: document.querySelector('#managerTitleInput'),
  gistFilename: document.querySelector('#gistFilenameInput'),
};

let bookmarks = [];
let selectedTags = [];
let isDirty = false;
let isBusy = false;
let activeTag = null;
let showUntaggedOnly = false;
let revision = 0;
let baselineFingerprint = null;
let tagOptionsOpen = false;
let activeTagOption = -1;
let bookmarkDialogSession = 0;
let tagUsage = Object.create(null);

function readConfig() {
  return {
    managerTitle: LocalStore.getString(
      StorageKeys.APP_TITLE,
      config.app.defaultTitle
    ).trim() || config.app.defaultTitle,

    gistFilename: LocalStore.getString(
      StorageKeys.GIST_FILENAME,
      config.app.gistFilename
    ).trim() || config.app.gistFilename,

    gistId: LocalStore.getString(StorageKeys.GIST_ID).trim(),
    token: LocalStore.getString(StorageKeys.GITHUB_TOKEN).trim()
  };
}

function applyManagerTitle() {
  const { managerTitle } = readConfig();

  elements.appTitle.textContent = managerTitle;
  document.title = managerTitle;
}

// A compact two-part fingerprint avoids storing a second full copy of the bookmark data.
// It is calculated only when data changes or synchronization completes, never during rendering.
function fingerprintText(text) {
  let hashA = 0x811c9dc5;
  let hashB = 0x9e3779b9;

  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    hashA = Math.imul(hashA ^ code, 0x01000193);
    hashB = Math.imul(hashB ^ code, 0x5bd1e995);
  }

  return `${text.length}:${hashA >>> 0}:${hashB >>> 0}`;
}

function getBookmarksFingerprint() {
  return fingerprintText(serializeBookmarksCSV(bookmarks));
}

function persistState() {
  const savedBookmarks = LocalStore.set(StorageKeys.BOOKMARKS, bookmarks);
  const savedDirty = LocalStore.set(StorageKeys.DIRTY, isDirty);
  const savedBaseline = baselineFingerprint === null
    || LocalStore.set(StorageKeys.SYNCED_FINGERPRINT, baselineFingerprint);

  return savedBookmarks && savedDirty && savedBaseline;
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
  revision += 1;
  isDirty = baselineFingerprint === null
    || getBookmarksFingerprint() !== baselineFingerprint;

  if (!persistState()) {
    setStatus(t('statusLocalStorageError'), 'error');
  } else {
    setStatus(isDirty ? message : t('statusChangesReverted'), isDirty ? '' : 'success');
  }

  render();
}

function loadTagUsage() {
  const saved = LocalStore.get(StorageKeys.TAG_USAGE, {});
  tagUsage = Object.create(null);

  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return;

  Object.entries(saved).forEach(([tag, count]) => {
    if (tag && Number.isSafeInteger(count) && count > 0) {
      tagUsage[tag] = count;
    }
  });
}

function recordTagUsage(tags) {
  const uniqueTags = [...new Set(tags)];
  if (!uniqueTags.length) return true;

  uniqueTags.forEach((tag) => {
    tagUsage[tag] = (tagUsage[tag] ?? 0) + 1;
  });

  return LocalStore.set(StorageKeys.TAG_USAGE, tagUsage);
}

function getAllTags() {
  return [...new Set(bookmarks.flatMap((bookmark) => bookmark.tags))]
    .sort((a, b) => {
      const usageDifference = (tagUsage[b] ?? 0) - (tagUsage[a] ?? 0);
      return usageDifference || a.localeCompare(b, getLocale());
    });
}

function createTagButton(tag) {
  const isUntagged = tag === null;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `tag-filter${isUntagged ? ' tag-filter-untagged' : ''}`;
  button.textContent = isUntagged ? t('untaggedFilter') : tag;
  button.dataset.filterType = isUntagged ? 'untagged' : 'tag';

  if (!isUntagged) button.dataset.tag = tag;

  button.style.backgroundColor = isUntagged
    ? config.tagColors.untagged
    : config.tagColors.normal;
  button.style.color = isUntagged
    ? config.tagColors.untaggedText
    : config.tagColors.normalText;
  button.setAttribute('aria-pressed', String(
    isUntagged ? showUntaggedOnly : !showUntaggedOnly && activeTag === tag
  ));
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

function scrollBookmarkDialogToBottom() {
  window.requestAnimationFrame(() => {
    if (!elements.bookmarkDialog.open) return;

    elements.bookmarkDialog.scrollTo({
      top: elements.bookmarkDialog.scrollHeight,
      behavior: 'smooth'
    });
  });
}

function renderTagPicker() {
  elements.selectedTags.replaceChildren();

  selectedTags.forEach((tag, index) => {
    const chip = document.createElement('span');
    chip.className = 'tag-chip';

    const label = document.createElement('span');
    label.textContent = tag;
    chip.append(label);

    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'tag-chip-remove';
    remove.textContent = '×';
    remove.title = t('removeTagAction', { tag });
    remove.setAttribute('aria-label', remove.title);
    remove.dataset.removeTagIndex = String(index);
    chip.append(remove);

    elements.selectedTags.append(chip);
  });

  const query = elements.tags.value.trim();
  const normalizedQuery = query.toLocaleLowerCase(getLocale());
  const selectedSet = new Set(selectedTags.map((tag) => tag.toLocaleLowerCase(getLocale())));
  const allTags = getAllTags();
  const exactMatch = allTags.find((tag) => tag.toLocaleLowerCase(getLocale()) === normalizedQuery);
  const options = [];

  if (
    query
    && !query.includes(',')
    && !query.includes('|')
    && !exactMatch
    && !selectedSet.has(normalizedQuery)
  ) {
    options.push({ tag: query, isNew: true });
  }

  allTags.forEach((tag) => {
    const normalizedTag = tag.toLocaleLowerCase(getLocale());
    if (selectedSet.has(normalizedTag)) return;
    if (normalizedQuery && !normalizedTag.includes(normalizedQuery)) return;
    options.push({ tag, isNew: false });
  });

  elements.tagOptions.replaceChildren();
  elements.tagOptions.hidden = !tagOptionsOpen || options.length === 0;
  elements.tags.setAttribute('aria-expanded', String(!elements.tagOptions.hidden));

  if (elements.tagOptions.hidden) {
    activeTagOption = -1;
    elements.tags.removeAttribute('aria-activedescendant');
    return;
  }

  // Append only enough candidates to fill the configured number of visual rows.
  const rowTops = [];

  for (const { tag, isNew } of options) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = `tag-option${isNew ? ' tag-option-create' : ''}`;
    option.setAttribute('role', 'option');
    option.dataset.tagOption = tag;
    option.textContent = isNew ? t('tagsCreateOption', { tag }) : tag;
    elements.tagOptions.append(option);

    const top = Math.round(option.getBoundingClientRect().top);

    if (rowTops.some((rowTop) => Math.abs(rowTop - top) <= 1)) continue;

    if (rowTops.length < config.tagPicker.maxVisibleRows) {
      rowTops.push(top);
    } else {
      option.remove();
      break;
    }
  }

  const visibleOptions = [...elements.tagOptions.querySelectorAll('.tag-option')];

  if (activeTagOption >= visibleOptions.length) activeTagOption = -1;

  visibleOptions.forEach((option, index) => {
    option.id = `tag-option-${index}`;
    option.setAttribute('aria-selected', String(index === activeTagOption));
  });

  if (activeTagOption < 0) {
    elements.tags.removeAttribute('aria-activedescendant');
  } else {
    elements.tags.setAttribute('aria-activedescendant', `tag-option-${activeTagOption}`);
  }

  // The options are part of normal document flow, so the dialog grows to fit
  // them. Scroll the dialog itself to keep the options and Save/Cancel visible.
  scrollBookmarkDialogToBottom();
}

function setTagOptionsOpen(value) {
  tagOptionsOpen = value;
  if (!value) activeTagOption = -1;
  renderTagPicker();
}

function updateActiveTagOption(direction) {
  if (!tagOptionsOpen) setTagOptionsOpen(true);

  const options = [...elements.tagOptions.querySelectorAll('.tag-option')];
  if (!options.length) return;

  activeTagOption = activeTagOption < 0
    ? (direction > 0 ? 0 : options.length - 1)
    : Math.max(0, Math.min(options.length - 1, activeTagOption + direction));

  options.forEach((option, index) => {
    option.setAttribute('aria-selected', String(index === activeTagOption));
  });

  elements.tags.setAttribute('aria-activedescendant', `tag-option-${activeTagOption}`);
}

function addSelectedTag(value) {
  const tag = String(value ?? '').trim();
  if (!tag) return;

  if (tag.includes(',') || tag.includes('|')) {
    setStatus(t('errorTagCharacters'), 'error');
    return;
  }

  const normalizedTag = tag.toLocaleLowerCase(getLocale());
  const existing = getAllTags().find((item) => item.toLocaleLowerCase(getLocale()) === normalizedTag);
  const selected = selectedTags.some((item) => item.toLocaleLowerCase(getLocale()) === normalizedTag);

  if (!selected) selectedTags.push(existing ?? tag);

  elements.tags.value = '';
  activeTagOption = -1;
  tagOptionsOpen = true;
  renderTagPicker();
  elements.tags.focus();
}

function commitTagInput() {
  const value = elements.tags.value.trim();
  if (!value) return;

  const existing = getAllTags().find((tag) => tag === value);
  addSelectedTag(existing ?? value);
}

function removeSelectedTag(index) {
  if (!Number.isInteger(index) || index < 0 || index >= selectedTags.length) return;

  selectedTags.splice(index, 1);
  renderTagPicker();
  elements.tags.focus();
}

function render() {
  const query = elements.search.value.trim().toLocaleLowerCase(getLocale());
  const allTags = getAllTags();

  if (activeTag && !allTags.includes(activeTag)) activeTag = null;

  const hasUntaggedBookmarks = bookmarks.some((bookmark) => bookmark.tags.length === 0);

  if (!hasUntaggedBookmarks) showUntaggedOnly = false;

  elements.tagBar.replaceChildren(
    ...(hasUntaggedBookmarks ? [createTagButton(null)] : []),
    ...allTags.map(createTagButton)
  );
  elements.grid.replaceChildren();

  const visibleBookmarks = bookmarks
    .map((bookmark, index) => ({ bookmark, index }))
    .filter(({ bookmark }) => {
      if (showUntaggedOnly && bookmark.tags.length > 0) return false;
      if (!showUntaggedOnly && activeTag && !bookmark.tags.includes(activeTag)) return false;
      if (!query) return true;

      return [bookmark.name, bookmark.url, bookmark.desc, ...bookmark.tags]
        .some((value) => value.toLocaleLowerCase(getLocale()).includes(query));
    });

  visibleBookmarks.forEach(({ bookmark, index }) => {
    elements.grid.append(createBookmarkCard(bookmark, index));
  });

  elements.emptyState.hidden = visibleBookmarks.length > 0;

  if (!visibleBookmarks.length) {
    if (bookmarks.length && (query || activeTag || showUntaggedOnly)) {
      elements.emptyState.textContent = (activeTag || showUntaggedOnly) && !query
        ? t('noTagResults')
        : t('noSearchResults');
    } else {
      elements.emptyState.textContent = t('emptyBookmarks');
    }
  }

  const state = isDirty ? t('syncStateDirty') : t('syncStateClean');
  elements.meta.textContent = t('metaSummary', {
    count: bookmarks.length,
    state
  });
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
  selectedTags = bookmark ? [...bookmark.tags] : [];
  elements.tags.value = '';

  setTagOptionsOpen(false);
  elements.bookmarkDialog.showModal();
  elements.name.focus();

  const session = ++bookmarkDialogSession;
  if (index < 0) prefillBookmarkFromClipboard(session);
}

function closeBookmarkDialog() {
  bookmarkDialogSession += 1;
  setTagOptionsOpen(false);
  elements.bookmarkDialog.close();
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
      tags: selectedTags
    });
  } catch (error) {
    setStatus(localizeError(error), 'error');
    return;
  }

  const duplicateIndex = bookmarks.findIndex((item, itemIndex) => {
    return itemIndex !== index && item.url === bookmark.url;
  });

  if (duplicateIndex >= 0) {
    const existing = bookmarks[duplicateIndex];

    if (!window.confirm(t('confirmDuplicateUrl', { name: existing.name }))) return;

    elements.bookmarkIndex.value = String(duplicateIndex);
    elements.bookmarkDialogTitle.textContent = t('editDialogTitle');
    elements.name.value = existing.name;
    elements.url.value = existing.url;
    elements.description.value = existing.desc;
    selectedTags = [...existing.tags];
    elements.tags.value = '';
    setTagOptionsOpen(false);
    renderTagPicker();
    elements.name.focus();
    return;
  }

  if (index >= 0) {
    bookmarks[index] = bookmark;
  } else {
    bookmarks.unshift(bookmark);
  }

  const usageSaved = recordTagUsage(bookmark.tags);

  closeBookmarkDialog();
  markChanged();

  if (!usageSaved) {
    setStatus(t('statusTagUsageError'), 'error');
  }
}

function deleteBookmark(index) {
  const bookmark = bookmarks[index];
  if (!bookmark) return;
  if (!window.confirm(t('confirmDelete', { name: bookmark.name }))) return;

  bookmarks.splice(index, 1);
  markChanged(t('statusDeletedLocal'));
}

function openSettings() {
  const settings = readConfig();

  elements.managerTitle.value = settings.managerTitle;
  elements.gistFilename.value = settings.gistFilename;
  elements.gistId.value = settings.gistId;
  elements.token.value = settings.token;

  elements.settingsDialog.showModal();
}

function saveSettings(event) {
  event.preventDefault();

  const managerTitle = elements.managerTitle.value.trim();
  const gistFilename = elements.gistFilename.value.trim();
  const gistId = elements.gistId.value.trim();
  const token = elements.token.value.trim();

  if (!managerTitle) {
    setStatus(t('errorManagerTitleRequired'), 'error');
    elements.managerTitle.focus();
    return;
  }

  const invalidFilename = !gistFilename
    || gistFilename.length <= 4
    || !gistFilename.toLowerCase().endsWith('.csv')
    || gistFilename.includes('/')
    || gistFilename.includes('\\')
    || gistFilename.includes('\n')
    || gistFilename.includes('\r');

  if (invalidFilename) {
    setStatus(t('errorGistFilenameRequired'), 'error');
    elements.gistFilename.focus();
    return;
  }

  const previousSettings = readConfig();

  // Warn before changing the remote target when local changes are pending.
  if (
    isDirty
    && gistFilename !== previousSettings.gistFilename
    && !window.confirm(t('confirmFilenameChangeWithDirty'))
  ) {
    return;
  }

  const saved = [
    LocalStore.set(StorageKeys.APP_TITLE, managerTitle),
    LocalStore.set(StorageKeys.GIST_FILENAME, gistFilename),
    LocalStore.set(StorageKeys.GIST_ID, gistId),
    LocalStore.set(StorageKeys.GITHUB_TOKEN, token)
  ].every(Boolean);

  if (!saved) {
    setStatus(t('statusLocalStorageError'), 'error');
    return;
  }

  applyManagerTitle();
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

function normalizeClipboardUrl(value) {
  const text = String(value ?? '').trim();
  if (!text || /\s/.test(text)) return null;

  try {
    const candidate = /^https?:\/\//i.test(text) ? text : `https://${text}`;
    const url = new URL(candidate);

    if (!['http:', 'https:'].includes(url.protocol)) return null;
    if (!url.hostname.includes('.') && url.hostname !== 'localhost') return null;
    if (url.href.length > Number(elements.url.maxLength)) return null;

    return url.href;
  } catch {
    return null;
  }
}

async function readHtmlHead(response) {
  if (!response.body?.getReader) {
    return (await response.text()).slice(0, config.metadata.maxHtmlBytes);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let html = '';
  let bytesRead = 0;

  try {
    while (bytesRead < config.metadata.maxHtmlBytes) {
      const { done, value } = await reader.read();

      if (done) {
        html += decoder.decode();
        break;
      }

      const chunk = value.subarray(0, config.metadata.maxHtmlBytes - bytesRead);
      bytesRead += chunk.byteLength;
      html += decoder.decode(chunk, { stream: true });

      if (/<\/head\s*>/i.test(html) || chunk.byteLength < value.byteLength) break;
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return html;
}

async function fetchPageMetadata(url) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), config.metadata.requestTimeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      mode: 'cors',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal: controller.signal
    });

    if (!response.ok) return null;

    const contentType = response.headers.get('content-type') ?? '';
    if (contentType && !contentType.toLowerCase().includes('text/html')) return null;

    const html = await readHtmlHead(response);
    const page = new DOMParser().parseFromString(html, 'text/html');
    const readMeta = (selector) => page.querySelector(selector)?.getAttribute('content')?.trim() ?? '';

    const title = readMeta('meta[property="og:title"]')
      || readMeta('meta[name="twitter:title"]')
      || page.querySelector('title')?.textContent?.trim()
      || '';

    const cleanText = (value) => value.replace(/\s+/g, ' ').trim();

    const description = readMeta('meta[property="og:description"]')
      || readMeta('meta[name="description"]')
      || readMeta('meta[name="twitter:description"]');

    return {
      title: cleanText(title),
      description: cleanText(description)
    };
  } catch {
    // Most sites do not allow cross-origin HTML reads. Clipboard URL filling still works.
    return null;
  } finally {
    window.clearTimeout(timeout);
  }
}

async function prefillBookmarkFromClipboard(session) {
  if (!navigator.clipboard?.readText) return;

  let clipboardText;

  try {
    clipboardText = await navigator.clipboard.readText();
  } catch {
    return;
  }

  const url = normalizeClipboardUrl(clipboardText);

  if (!url || session !== bookmarkDialogSession || !elements.bookmarkDialog.open) return;
  if (elements.url.value.trim()) return;

  elements.url.value = url;

  const canFillName = !elements.name.value.trim();
  const canFillDescription = !elements.description.value.trim();

  setStatus(t('statusClipboardUrl'));

  const metadata = await fetchPageMetadata(url);
  if (!metadata || session !== bookmarkDialogSession || !elements.bookmarkDialog.open) return;

  let filled = false;

  if (canFillName && !elements.name.value.trim() && metadata.title) {
    elements.name.value = metadata.title.slice(0, Number(elements.name.maxLength));
    filled = true;
  }

  if (canFillDescription && !elements.description.value.trim() && metadata.description) {
    elements.description.value = metadata.description.slice(0, Number(elements.description.maxLength));
    filled = true;
  }

  if (filled) setStatus(t('statusMetadataLoaded'), 'success');
}

async function pullBookmarks() {
  if (isBusy) return;

  const { gistId, gistFilename, token } = readConfig();

  if (!gistId) {
    setStatus(t('errorGistIdRequired'), 'error');
    return;
  }

  if (isDirty && !window.confirm(t('confirmPullOverwrite'))) return;

  const startRevision = revision;
  setBusy(true);
  setStatus(t('statusPulling'));

  try {
    const remote = await GistService.readFile(gistId, gistFilename, token);
    const incoming = parseBookmarksCSV(remote.content);

    if (revision !== startRevision) {
      throw new Error(t('errorLocalChangedDuringPull'));
    }

    bookmarks = incoming;
    baselineFingerprint = fingerprintText(serializeBookmarksCSV(incoming));
    isDirty = false;
    revision += 1;
    activeTag = null;
    showUntaggedOnly = false;

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

  const { gistId, token, gistFilename } = readConfig();

  if (!gistId || !token) {
    setStatus(t('errorCredentialsRequired'), 'error');
    return;
  }

  const content = serializeBookmarksCSV(bookmarks);
  const pushedFingerprint = fingerprintText(content);

  setBusy(true);
  setStatus(t('statusPushing'));

  try {
    await GistService.writeFile(gistId, token, gistFilename, content);

    // The uploaded content becomes the new baseline, even if local edits happened during the request.
    baselineFingerprint = pushedFingerprint;
    isDirty = getBookmarksFingerprint() !== baselineFingerprint;

    if (!persistState()) {
      setStatus(t('statusLocalStorageError'), 'error');
    } else if (isDirty) {
      setStatus(t('statusPushOutdated'));
    } else {
      setStatus(t('statusPushSuccess'), 'success');
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

  const savedFingerprint = LocalStore.getString(StorageKeys.SYNCED_FINGERPRINT, null);

  if (savedFingerprint !== null) {
    baselineFingerprint = savedFingerprint;
    isDirty = getBookmarksFingerprint() !== baselineFingerprint;
    LocalStore.set(StorageKeys.DIRTY, isDirty);
  } else if (!isDirty) {
    // On first run after this update, the current clean local data is the comparison baseline.
    baselineFingerprint = getBookmarksFingerprint();
    LocalStore.set(StorageKeys.SYNCED_FINGERPRINT, baselineFingerprint);
  }

  // Legacy installations already marked dirty have no known baseline; keep that warning
  // until the user performs a successful pull or push rather than guessing that data is clean.
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
  elements.cancelBookmarkButton.addEventListener('click', closeBookmarkDialog);

  elements.bookmarkDialog.addEventListener('close', () => {
    bookmarkDialogSession += 1;
    setTagOptionsOpen(false);
  });

  elements.tags.addEventListener('focus', () => setTagOptionsOpen(true));

  elements.tags.addEventListener('input', () => {
    activeTagOption = -1;
    tagOptionsOpen = true;
    renderTagPicker();
  });

  elements.tags.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      updateActiveTagOption(event.key === 'ArrowDown' ? 1 : -1);
    } else if (event.key === 'Enter') {
      event.preventDefault();

      if (activeTagOption >= 0) {
        elements.tagOptions.querySelectorAll('.tag-option')[activeTagOption]?.click();
      } else {
        commitTagInput();
      }
    } else if (event.key === 'Backspace' && !elements.tags.value && selectedTags.length) {
      selectedTags.pop();
      renderTagPicker();
    } else if (event.key === 'Escape' && !elements.tagOptions.hidden) {
      event.preventDefault();
      event.stopPropagation();
      setTagOptionsOpen(false);
    } else if (event.key === 'Tab') {
      setTagOptionsOpen(false);
    }
  });

  elements.tagPicker.addEventListener('click', (event) => {
    const removeButton = event.target.closest('button[data-remove-tag-index]');

    if (removeButton) {
      removeSelectedTag(Number.parseInt(removeButton.dataset.removeTagIndex, 10));
      return;
    }

    const option = event.target.closest('button[data-tag-option]');
    if (option) addSelectedTag(option.dataset.tagOption);
  });

  elements.tagOptions.addEventListener('mousedown', (event) => {
    if (event.target.closest('button[data-tag-option]')) event.preventDefault();
  });

  document.addEventListener('pointerdown', (event) => {
    if (
      tagOptionsOpen
      && !elements.tagPicker.contains(event.target)
      && !elements.bookmarkActions.contains(event.target)
    ) {
      setTagOptionsOpen(false);
    }
  });

  elements.tagBar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter-type]');
    if (!button) return;

    if (button.dataset.filterType === 'untagged') {
      showUntaggedOnly = !showUntaggedOnly;
      activeTag = null;
    } else {
      showUntaggedOnly = false;
      activeTag = activeTag === button.dataset.tag ? null : button.dataset.tag;
    }
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
  setLocale(LocalStore.getString(StorageKeys.LOCALE, config.i18n.defaultLocale));

  applyManagerTitle();

  loadBookmarks();
  loadTagUsage();
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