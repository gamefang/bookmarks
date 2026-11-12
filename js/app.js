import { config } from './config.js';
import { getLocale, setLocale, t } from './i18n.js';
import { LocalStore, StorageKeys } from './storage.js';
import { GistService } from './gist.js';
import {
  createBookmark,
  createDefaultSyncSettings,
  isSafeWebUrl,
  normalizeBookmark,
  normalizeSyncSettings,
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
  managerTitle: document.querySelector('#managerTitleInput'),
  listSort: document.querySelector('#listSortInput'),
  tagSort: document.querySelector('#tagSortInput'),
  gistFilename: document.querySelector('#gistFilenameInput'),
  gistId: document.querySelector('#gistIdInput'),
  token: document.querySelector('#tokenInput'),
  manageTagsButton: document.querySelector('#manageTagsButton'),
  cancelSettingsButton: document.querySelector('#cancelSettingsButton'),

  tagManagerDialog: document.querySelector('#tagManagerDialog'),
  tagManagerList: document.querySelector('#tagManagerList'),
  closeTagManagerButton: document.querySelector('#closeTagManagerButton'),

  tagEditDialog: document.querySelector('#tagEditDialog'),
  tagEditForm: document.querySelector('#tagEditForm'),
  tagEditName: document.querySelector('#tagEditNameInput'),
  tagEditHidden: document.querySelector('#tagEditHiddenInput'),
  tagEditPinned: document.querySelector('#tagEditPinnedInput'),
  deleteTagButton: document.querySelector('#deleteTagButton'),
  cancelTagEditButton: document.querySelector('#cancelTagEditButton'),

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

  appTitle: document.querySelector('#appTitle')
};

let bookmarks = [];
let appSettings = createDefaultSyncSettings(config.app.defaultTitle);
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
let editingTag = null;
let tagLongPressTimer = null;
let tagLongPressHandled = false;

function readConfig() {
  return {
    gistFilename: LocalStore.getString(
      StorageKeys.GIST_FILENAME,
      config.app.gistFilename
    ).trim() || config.app.gistFilename,

    gistId: LocalStore.getString(StorageKeys.GIST_ID).trim(),
    token: LocalStore.getString(StorageKeys.GITHUB_TOKEN).trim()
  };
}

function applyManagerTitle() {
  const title = appSettings.managerTitle || config.app.defaultTitle;

  elements.appTitle.textContent = title;
  document.title = title;
}

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
  return fingerprintText(serializeBookmarksCSV(bookmarks, appSettings));
}

function persistState() {
  return [
    LocalStore.set(StorageKeys.BOOKMARKS, bookmarks),
    LocalStore.set(StorageKeys.APP_SETTINGS, appSettings),
    LocalStore.set(StorageKeys.DIRTY, isDirty),
    baselineFingerprint === null
      || LocalStore.set(StorageKeys.SYNCED_FINGERPRINT, baselineFingerprint)
  ].every(Boolean);
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
    setStatus(
      isDirty ? message : t('statusChangesReverted'),
      isDirty ? '' : 'success'
    );
  }

  render();
}

function getAllTagNames() {
  return [...new Set(bookmarks.flatMap((bookmark) => bookmark.tags))];
}

function getTagCountMap() {
  const counts = Object.create(null);

  bookmarks.forEach((bookmark) => {
    new Set(bookmark.tags).forEach((tag) => {
      counts[tag] = (counts[tag] ?? 0) + 1;
    });
  });

  return counts;
}

function getTimestampValue(value) {
  if (!value) return 0;

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function sortTagNames(tags) {
  const counts = getTagCountMap();
  const pinned = new Set(appSettings.pinnedTags);
  const sort = appSettings.tagSort;
  const descending = sort.endsWith('-desc');
  const type = sort.replace(/-(asc|desc)$/, '');

  return [...tags].sort((a, b) => {
    const pinDifference = Number(pinned.has(b)) - Number(pinned.has(a));
    if (pinDifference) return pinDifference;

    let comparison = 0;

    if (type === 'name') {
      comparison = a.localeCompare(b, getLocale());
    } else if (type === 'count') {
      comparison = (counts[a] ?? 0) - (counts[b] ?? 0);
    } else {
      comparison = getTimestampValue(appSettings.tagLastUsed[a])
        - getTimestampValue(appSettings.tagLastUsed[b]);
    }

    if (descending) comparison *= -1;
    return comparison || a.localeCompare(b, getLocale());
  });
}

function getVisibleTags() {
  const hidden = new Set(appSettings.hiddenTags);

  return sortTagNames(
    getAllTagNames().filter((tag) => !hidden.has(tag))
  );
}

function sortBookmarks(items) {
  const sort = appSettings.listSort;
  const descending = sort.endsWith('-desc');
  const type = sort.replace(/-(asc|desc)$/, '');

  return [...items].sort((a, b) => {
    const { bookmark: first, index: firstIndex } = a;
    const { bookmark: second, index: secondIndex } = b;
    let comparison = 0;

    if (type === 'name') {
      comparison = first.name.localeCompare(second.name, getLocale());
    } else if (type === 'tag') {
      const firstTags = [...first.tags].sort().join('|');
      const secondTags = [...second.tags].sort().join('|');
      comparison = firstTags.localeCompare(secondTags, getLocale());
    } else {
      const firstTimes = appSettings.bookmarkTimes[first.url] ?? {};
      const secondTimes = appSettings.bookmarkTimes[second.url] ?? {};
      const key = type === 'created' ? 'createdAt' : 'updatedAt';

      comparison = getTimestampValue(firstTimes[key])
        - getTimestampValue(secondTimes[key]);
    }

    if (descending) comparison *= -1;
    return comparison || firstIndex - secondIndex;
  });
}

function createTagButton(tag) {
  const isUntagged = tag === null;
  const isPinned = !isUntagged && appSettings.pinnedTags.includes(tag);
  const button = document.createElement('button');

  button.type = 'button';
  button.className = `tag-filter${isUntagged ? ' tag-filter-untagged' : ''}`;
  button.textContent = isUntagged ? t('untaggedFilter') : tag;
  button.dataset.filterType = isUntagged ? 'untagged' : 'tag';

  if (!isUntagged) {
    button.dataset.tag = tag;
    button.style.backgroundColor = isPinned
      ? config.tagColors.pinned
      : config.tagColors.normal;
    button.style.color = isPinned
      ? config.tagColors.pinnedText
      : config.tagColors.normalText;
  } else {
    button.style.backgroundColor = config.tagColors.untagged;
    button.style.color = config.tagColors.untaggedText;
  }

  button.setAttribute('aria-pressed', String(
    isUntagged
      ? showUntaggedOnly
      : !showUntaggedOnly && activeTag === tag
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

  const visibleTags = bookmark.tags.filter(
    (tag) => !appSettings.hiddenTags.includes(tag)
  );

  if (visibleTags.length) {
    const tagList = document.createElement('div');
    tagList.className = 'bookmark-tags';

    visibleTags.forEach((tag) => {
      const isPinned = appSettings.pinnedTags.includes(tag);
      const tagElement = document.createElement('span');

      tagElement.className = `bookmark-tag${isPinned ? ' bookmark-tag-pinned' : ''}`;
      tagElement.textContent = tag;
      tagElement.style.backgroundColor = isPinned
        ? config.tagColors.pinned
        : config.tagColors.normal;
      tagElement.style.color = isPinned
        ? config.tagColors.pinnedText
        : config.tagColors.normalText;

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
  const selectedSet = new Set(
    selectedTags.map((tag) => tag.toLocaleLowerCase(getLocale()))
  );
  const allNames = getAllTagNames();
  const allNameSet = new Set(
    allNames.map((tag) => tag.toLocaleLowerCase(getLocale()))
  );
  const visibleTags = getVisibleTags();
  const exactMatch = visibleTags.find(
    (tag) => tag.toLocaleLowerCase(getLocale()) === normalizedQuery
  );
  const options = [];

  if (
    query
    && !query.includes(',')
    && !query.includes('|')
    && !allNameSet.has(normalizedQuery)
    && !selectedSet.has(normalizedQuery)
  ) {
    options.push({ tag: query, isNew: true });
  }

  visibleTags.forEach((tag) => {
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

  const rowTops = [];

  for (const { tag, isNew } of options) {
    const option = document.createElement('button');

    option.type = 'button';
    option.className = `tag-option${isNew ? ' tag-option-create' : ''}`;
    option.setAttribute('role', 'option');
    option.dataset.tagOption = tag;
    option.textContent = isNew ? t('tagsCreateOption', { tag }) : tag;

    if (!isNew && appSettings.pinnedTags.includes(tag)) {
      option.style.backgroundColor = config.tagColors.pinned;
      option.style.color = config.tagColors.pinnedText;
    }
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
  const existing = getAllTagNames().find(
    (item) => item.toLocaleLowerCase(getLocale()) === normalizedTag
  );

  if (existing && appSettings.hiddenTags.includes(existing)) {
    setStatus(t('errorTagHidden'), 'error');
    return;
  }

  const selected = selectedTags.some(
    (item) => item.toLocaleLowerCase(getLocale()) === normalizedTag
  );

  if (!selected) selectedTags.push(existing ?? tag);

  elements.tags.value = '';
  activeTagOption = -1;
  tagOptionsOpen = true;
  renderTagPicker();
  elements.tags.focus();
}

function commitTagInput() {
  const value = elements.tags.value.trim();
  if (value) addSelectedTag(value);
}

function removeSelectedTag(index) {
  if (!Number.isInteger(index) || index < 0 || index >= selectedTags.length) return;

  selectedTags.splice(index, 1);
  renderTagPicker();
  elements.tags.focus();
}

function render() {
  const query = elements.search.value.trim().toLocaleLowerCase(getLocale());
  const visibleTags = getVisibleTags();

  if (activeTag && !visibleTags.includes(activeTag)) activeTag = null;

  const hasUntaggedBookmarks = bookmarks.some(
    (bookmark) => bookmark.tags.length === 0
  );

  if (!hasUntaggedBookmarks) showUntaggedOnly = false;

  elements.tagBar.replaceChildren(
    ...(hasUntaggedBookmarks ? [createTagButton(null)] : []),
    ...visibleTags.map(createTagButton)
  );

  elements.grid.replaceChildren();

  const visibleBookmarks = sortBookmarks(
    bookmarks
      .map((bookmark, index) => ({ bookmark, index }))
      .filter(({ bookmark }) => {
        if (showUntaggedOnly && bookmark.tags.length > 0) return false;

        if (
          !showUntaggedOnly
          && activeTag
          && !bookmark.tags.includes(activeTag)
        ) {
          return false;
        }

        if (!query) return true;

        const searchableTags = bookmark.tags.filter(
          (tag) => !appSettings.hiddenTags.includes(tag)
        );

        return [
          bookmark.name,
          bookmark.url,
          bookmark.desc,
          ...searchableTags
        ].some(
          (value) => value.toLocaleLowerCase(getLocale()).includes(query)
        );
      })
  );

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
  elements.bookmarkDialogTitle.textContent = t(
    index >= 0 ? 'editDialogTitle' : 'addDialogTitle'
  );
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

function touchBookmark(bookmark, previous = null, now = new Date().toISOString()) {
  const previousTimes = previous
    ? appSettings.bookmarkTimes[previous.url]
    : null;

  if (previous && previous.url !== bookmark.url) {
    delete appSettings.bookmarkTimes[previous.url];
  }

  appSettings.bookmarkTimes[bookmark.url] = {
    createdAt: previousTimes?.createdAt ?? now,
    updatedAt: now
  };
}

function pruneTagSettings() {
  const usedTags = new Set(getAllTagNames());

  appSettings.hiddenTags = appSettings.hiddenTags.filter(
    (tag) => usedTags.has(tag)
  );
  appSettings.pinnedTags = appSettings.pinnedTags.filter(
    (tag) => usedTags.has(tag)
  );

  Object.keys(appSettings.tagLastUsed).forEach((tag) => {
    if (!usedTags.has(tag)) delete appSettings.tagLastUsed[tag];
  });
}

function saveBookmark(event) {
  event.preventDefault();

  const index = Number.parseInt(elements.bookmarkIndex.value, 10);
  const previous = index >= 0 ? bookmarks[index] : null;
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

    if (!window.confirm(t('confirmDuplicateUrl', { name: existing.name }))) {
      return;
    }

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

  const now = new Date().toISOString();
  const previousTags = new Set(previous?.tags ?? []);

  touchBookmark(bookmark, previous, now);

  bookmark.tags.forEach((tag) => {
    if (!previousTags.has(tag)) {
      appSettings.tagLastUsed[tag] = now;
    }
  });

  if (index >= 0) {
    bookmarks[index] = bookmark;
  } else {
    bookmarks.unshift(bookmark);
  }

  pruneTagSettings();
  closeBookmarkDialog();
  markChanged();
}

function deleteBookmark(index) {
  const bookmark = bookmarks[index];
  if (!bookmark) return;

  if (!window.confirm(t('confirmDelete', { name: bookmark.name }))) return;

  bookmarks.splice(index, 1);
  delete appSettings.bookmarkTimes[bookmark.url];
  pruneTagSettings();

  markChanged(t('statusDeletedLocal'));
}

function renderTagManager() {
  elements.tagManagerList.replaceChildren();

  const tags = sortTagNames(getAllTagNames());

  if (!tags.length) {
    const empty = document.createElement('p');
    empty.className = 'field-hint';
    empty.textContent = t('tagManagerEmpty');
    elements.tagManagerList.append(empty);
    return;
  }

  tags.forEach((tag) => {
    const hidden = appSettings.hiddenTags.includes(tag);
    const pinned = appSettings.pinnedTags.includes(tag);

    const item = document.createElement('div');
    item.className = 'tag-manager-item';

    const label = document.createElement('span');
    label.className = 'tag-manager-name';
    label.textContent = tag;
    label.style.backgroundColor = hidden
      ? config.tagColors.hidden
      : pinned
        ? config.tagColors.pinned
        : config.tagColors.normal;
    label.style.color = hidden
      ? config.tagColors.hiddenText
      : pinned
        ? config.tagColors.pinnedText
        : config.tagColors.normalText;
    item.append(label);

    const states = document.createElement('span');
    states.className = 'tag-manager-states';

    if (hidden) {
      const hiddenLabel = document.createElement('span');
      hiddenLabel.className = 'tag-manager-state tag-manager-state-hidden';
      hiddenLabel.textContent = t('tagHiddenLabel');
      states.append(hiddenLabel);
    }

    if (pinned) {
      const pinnedLabel = document.createElement('span');
      pinnedLabel.className = 'tag-manager-state tag-manager-state-pinned';
      pinnedLabel.textContent = t('tagPinnedLabel');
      states.append(pinnedLabel);
    }

    item.append(states);

    const editButton = document.createElement('button');
    editButton.type = 'button';
    editButton.className = 'button button-secondary tag-manager-edit';
    editButton.textContent = t('editTagButton');
    editButton.dataset.editTag = tag;
    item.append(editButton);

    elements.tagManagerList.append(item);
  });
}

function openTagManager() {
  renderTagManager();
  elements.tagManagerDialog.showModal();
}

function openTagEditor(tag) {
  if (!getAllTagNames().includes(tag)) return;

  editingTag = tag;
  elements.tagEditName.value = tag;
  elements.tagEditHidden.checked = appSettings.hiddenTags.includes(tag);
  elements.tagEditPinned.checked = appSettings.pinnedTags.includes(tag);
  elements.deleteTagButton.hidden = false;

  elements.tagEditDialog.showModal();
  elements.tagEditName.focus();
  elements.tagEditName.select();
}

function setTagMembership(list, tag, enabled) {
  return enabled
    ? [...new Set([...list, tag])]
    : list.filter((item) => item !== tag);
}

function saveTagEdit(event) {
  event.preventDefault();

  if (!editingTag) return;

  const oldTag = editingTag;
  const newTag = elements.tagEditName.value.trim();

  if (!newTag) {
    setStatus(t('errorTagNameRequired'), 'error');
    elements.tagEditName.focus();
    return;
  }

  if (newTag.includes(',') || newTag.includes('|')) {
    setStatus(t('errorTagCharacters'), 'error');
    elements.tagEditName.focus();
    return;
  }

  const duplicate = getAllTagNames().find((tag) => {
    return tag !== oldTag
      && tag.toLocaleLowerCase(getLocale()) === newTag.toLocaleLowerCase(getLocale());
  });

  if (duplicate) {
    setStatus(t('errorDuplicateTag'), 'error');
    elements.tagEditName.focus();
    return;
  }

  const hidden = elements.tagEditHidden.checked;
  const pinned = elements.tagEditPinned.checked;
  const renamed = oldTag !== newTag;
  const now = new Date().toISOString();

  if (renamed) {
    bookmarks.forEach((bookmark) => {
      if (!bookmark.tags.includes(oldTag)) return;

      bookmark.tags = bookmark.tags.map(
        (tag) => tag === oldTag ? newTag : tag
      );
      touchBookmark(bookmark, bookmark, now);
    });

    appSettings.hiddenTags = appSettings.hiddenTags.map(
      (tag) => tag === oldTag ? newTag : tag
    );
    appSettings.pinnedTags = appSettings.pinnedTags.map(
      (tag) => tag === oldTag ? newTag : tag
    );

    if (Object.hasOwn(appSettings.tagLastUsed, oldTag)) {
      appSettings.tagLastUsed[newTag] = appSettings.tagLastUsed[oldTag];
      delete appSettings.tagLastUsed[oldTag];
    }

    if (activeTag === oldTag) activeTag = newTag;
  }

  appSettings.hiddenTags = setTagMembership(
    appSettings.hiddenTags,
    newTag,
    hidden
  );
  appSettings.pinnedTags = setTagMembership(
    appSettings.pinnedTags,
    newTag,
    pinned
  );

  if (hidden && activeTag === newTag) activeTag = null;

  editingTag = null;
  elements.tagEditDialog.close();
  pruneTagSettings();
  markChanged();

  if (elements.tagManagerDialog.open) renderTagManager();
}

function deleteTag() {
  if (!editingTag) return;

  const tag = editingTag;

  if (!window.confirm(t('confirmDeleteTag', { tag }))) return;

  const now = new Date().toISOString();

  bookmarks.forEach((bookmark) => {
    if (!bookmark.tags.includes(tag)) return;

    bookmark.tags = bookmark.tags.filter((item) => item !== tag);
    touchBookmark(bookmark, bookmark, now);
  });

  appSettings.hiddenTags = appSettings.hiddenTags.filter(
    (item) => item !== tag
  );
  appSettings.pinnedTags = appSettings.pinnedTags.filter(
    (item) => item !== tag
  );
  delete appSettings.tagLastUsed[tag];

  if (activeTag === tag) activeTag = null;

  editingTag = null;
  elements.tagEditDialog.close();
  pruneTagSettings();
  markChanged();

  if (elements.tagManagerDialog.open) renderTagManager();
}

function openSettings() {
  const settings = readConfig();

  elements.managerTitle.value = appSettings.managerTitle;
  elements.listSort.value = appSettings.listSort;
  elements.tagSort.value = appSettings.tagSort;
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

  const previousConfig = readConfig();

  if (
    isDirty
    && gistFilename !== previousConfig.gistFilename
    && !window.confirm(t('confirmFilenameChangeWithDirty'))
  ) {
    return;
  }

  const previousSettings = JSON.stringify(appSettings);

  appSettings = normalizeSyncSettings({
    ...appSettings,
    managerTitle,
    listSort: elements.listSort.value,
    tagSort: elements.tagSort.value
  }, config.app.defaultTitle);

  const saved = [
    LocalStore.set(StorageKeys.APP_SETTINGS, appSettings),
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

  if (JSON.stringify(appSettings) !== previousSettings) {
    markChanged();
  } else {
    render();
    setStatus(t('statusSettingsSaved'), 'success');
  }
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
  return Number.isNaN(date.getTime())
    ? t('dateUnknown')
    : date.toLocaleString(getLocale());
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

      const chunk = value.subarray(
        0,
        config.metadata.maxHtmlBytes - bytesRead
      );

      bytesRead += chunk.byteLength;
      html += decoder.decode(chunk, { stream: true });

      if (/<\/head\s*>/i.test(html) || chunk.byteLength < value.byteLength) {
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => {});
  }

  return html;
}

async function fetchPageMetadata(url) {
  const controller = new AbortController();
  const timeout = window.setTimeout(
    () => controller.abort(),
    config.metadata.requestTimeoutMs
  );

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

    if (contentType && !contentType.toLowerCase().includes('text/html')) {
      return null;
    }

    const html = await readHtmlHead(response);
    const page = new DOMParser().parseFromString(html, 'text/html');
    const readMeta = (selector) => {
      return page.querySelector(selector)?.getAttribute('content')?.trim() ?? '';
    };

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

  if (!url || session !== bookmarkDialogSession || !elements.bookmarkDialog.open) {
    return;
  }

  if (elements.url.value.trim()) return;

  elements.url.value = url;

  const canFillName = !elements.name.value.trim();
  const canFillDescription = !elements.description.value.trim();

  setStatus(t('statusClipboardUrl'));

  const metadata = await fetchPageMetadata(url);

  if (!metadata || session !== bookmarkDialogSession || !elements.bookmarkDialog.open) {
    return;
  }

  let filled = false;

  if (canFillName && !elements.name.value.trim() && metadata.title) {
    elements.name.value = metadata.title.slice(
      0,
      Number(elements.name.maxLength)
    );
    filled = true;
  }

  if (
    canFillDescription
    && !elements.description.value.trim()
    && metadata.description
  ) {
    elements.description.value = metadata.description.slice(
      0,
      Number(elements.description.maxLength)
    );
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
    const remote = await GistService.readFile(
      gistId,
      gistFilename,
      token
    );

    const incoming = parseBookmarksCSV(remote.content);

    if (revision !== startRevision) {
      throw new Error(t('errorLocalChangedDuringPull'));
    }

    bookmarks = incoming.bookmarks;
    appSettings = incoming.settings;
    baselineFingerprint = fingerprintText(
      serializeBookmarksCSV(bookmarks, appSettings)
    );
    isDirty = false;
    revision += 1;
    activeTag = null;
    showUntaggedOnly = false;

    applyManagerTitle();

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
    setStatus(
      t('statusPullFailed', { error: localizeError(error) }),
      'error'
    );
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

  const content = serializeBookmarksCSV(bookmarks, appSettings);
  const pushedFingerprint = fingerprintText(content);

  setBusy(true);
  setStatus(t('statusPushing'));

  try {
    await GistService.writeFile(
      gistId,
      token,
      gistFilename,
      content
    );

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
    setStatus(
      t('statusPushFailed', { error: localizeError(error) }),
      'error'
    );
  } finally {
    setBusy(false);
  }
}

function loadBookmarks() {
  const savedBookmarks = LocalStore.get(StorageKeys.BOOKMARKS, []);
  const savedSettings = LocalStore.get(StorageKeys.APP_SETTINGS, null);

  bookmarks = Array.isArray(savedBookmarks)
    ? savedBookmarks
      .map((item) => normalizeBookmark(item ?? {}))
      .filter((bookmark) => bookmark.name && bookmark.url)
    : [];

  appSettings = normalizeSyncSettings(
    savedSettings ?? {},
    config.app.defaultTitle
  );

  isDirty = Boolean(LocalStore.get(StorageKeys.DIRTY, false));

  const savedFingerprint = LocalStore.getString(
    StorageKeys.SYNCED_FINGERPRINT,
    null
  );

  if (!savedSettings && bookmarks.length > 0) {
    // The old local data has no synchronized settings or timestamp metadata.
    // Do not guess or silently convert it.
    isDirty = true;
    baselineFingerprint = null;
  } else if (savedFingerprint !== null) {
    baselineFingerprint = savedFingerprint;
    isDirty = getBookmarksFingerprint() !== baselineFingerprint;
  } else if (!isDirty) {
    baselineFingerprint = getBookmarksFingerprint();
  } else {
    baselineFingerprint = null;
  }

  persistState();
}

function clearUnusedStorage() {
  LocalStore.remove('bm_title');
  LocalStore.remove('bm_tag_usage');
}

function bindEvents() {
  elements.search.addEventListener('input', render);
  elements.pullButton.addEventListener('click', pullBookmarks);
  elements.pushButton.addEventListener('click', pushBookmarks);
  elements.addButton.addEventListener('click', () => openBookmarkDialog());
  elements.settingsButton.addEventListener('click', openSettings);

  elements.settingsForm.addEventListener('submit', saveSettings);
  elements.bookmarkForm.addEventListener('submit', saveBookmark);
  elements.tagEditForm.addEventListener('submit', saveTagEdit);

  elements.cancelSettingsButton.addEventListener(
    'click',
    () => elements.settingsDialog.close()
  );

  elements.cancelBookmarkButton.addEventListener(
    'click',
    closeBookmarkDialog
  );

  elements.manageTagsButton.addEventListener('click', () => {
    elements.settingsDialog.close();
    openTagManager();
  });

  elements.closeTagManagerButton.addEventListener(
    'click',
    () => elements.tagManagerDialog.close()
  );

  elements.cancelTagEditButton.addEventListener(
    'click',
    () => {
      editingTag = null;
      elements.tagEditDialog.close();
    }
  );

  elements.deleteTagButton.addEventListener('click', deleteTag);

  elements.tagManagerList.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-edit-tag]');
    if (button) openTagEditor(button.dataset.editTag);
  });

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
        elements.tagOptions
          .querySelectorAll('.tag-option')[activeTagOption]
          ?.click();
      } else {
        commitTagInput();
      }
    } else if (
      event.key === 'Backspace'
      && !elements.tags.value
      && selectedTags.length
    ) {
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
    const removeButton = event.target.closest(
      'button[data-remove-tag-index]'
    );

    if (removeButton) {
      removeSelectedTag(
        Number.parseInt(removeButton.dataset.removeTagIndex, 10)
      );
      return;
    }

    const option = event.target.closest('button[data-tag-option]');

    if (option) addSelectedTag(option.dataset.tagOption);
  });

  elements.tagOptions.addEventListener('mousedown', (event) => {
    if (event.target.closest('button[data-tag-option]')) {
      event.preventDefault();
    }
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

  elements.tagBar.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('button[data-filter-type="tag"]');
    if (!button || event.button === 2) return;

    window.clearTimeout(tagLongPressTimer);
    tagLongPressHandled = false;

    tagLongPressTimer = window.setTimeout(() => {
      tagLongPressHandled = true;
      openTagEditor(button.dataset.tag);
    }, 550);
  });

  ['pointerup', 'pointercancel', 'pointerleave'].forEach((eventName) => {
    elements.tagBar.addEventListener(eventName, () => {
      window.clearTimeout(tagLongPressTimer);
      tagLongPressTimer = null;
    });
  });

  elements.tagBar.addEventListener('contextmenu', (event) => {
    if (event.target.closest('button[data-filter-type="tag"]')) {
      event.preventDefault();
    }
  });

  elements.tagBar.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-filter-type]');
    if (!button) return;

    if (tagLongPressHandled) {
      tagLongPressHandled = false;
      return;
    }

    if (button.dataset.filterType === 'untagged') {
      showUntaggedOnly = !showUntaggedOnly;
      activeTag = null;
    } else {
      showUntaggedOnly = false;
      activeTag = activeTag === button.dataset.tag
        ? null
        : button.dataset.tag;
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
  clearUnusedStorage();
  setLocale(LocalStore.getString(
    StorageKeys.LOCALE,
    config.i18n.defaultLocale
  ));

  loadBookmarks();
  applyManagerTitle();
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