// Bookmarks core logic
import { config } from './config.js';

const CSV_COLUMNS = config.csv.columns;
const TAG_SEPARATOR = config.csv.tagSeparator;

const LIST_SORT_OPTIONS = [
  'created-asc',
  'created-desc',
  'updated-asc',
  'updated-desc',
  'name-asc',
  'name-desc',
  'tag-asc',
  'tag-desc'
];

const TAG_SORT_OPTIONS = [
  'lastUsed-asc',
  'lastUsed-desc',
  'name-asc',
  'name-desc',
  'count-asc',
  'count-desc'
];

export class BookmarkDataError extends Error {
  constructor(key, params = {}, options = {}) {
    super(key, options);
    this.key = key;
    this.params = params;
  }
}

function escapeCSV(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text)
    ? `"${text.replace(/"/g, '""')}"`
    : text;
}

function parseCSVRows(input) {
  const text = String(input ?? '').replace(/^\uFEFF/, '');
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];

    if (inQuotes) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) {
      inQuotes = true;
    } else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n' || character === '\r') {
      row.push(field);
      if (row.some((value) => value !== '')) rows.push(row);
      row = [];
      field = '';

      if (character === '\r' && text[index + 1] === '\n') {
        index += 1;
      }
    } else {
      field += character;
    }
  }

  if (inQuotes) {
    throw new BookmarkDataError('errorCsvUnfinishedQuote');
  }

  row.push(field);
  if (row.some((value) => value !== '')) rows.push(row);

  return rows;
}

function normalizeTimestamp(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value !== 'string' || !value.trim()) return null;

  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString();
}

function normalizeTimestampMap(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {};
  }

  return Object.fromEntries(
    Object.entries(source)
      .map(([key, value]) => [key, normalizeTimestamp(value)])
      .filter(([key, value]) => key && value)
  );
}

function normalizeBookmarkTimes(source) {
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return {};
  }

  const result = {};

  Object.entries(source).forEach(([url, value]) => {
    if (!url || !value || typeof value !== 'object') return;

    const createdAt = normalizeTimestamp(value.createdAt);
    const updatedAt = normalizeTimestamp(value.updatedAt);

    if (createdAt || updatedAt) {
      result[url] = {
        createdAt: createdAt ?? updatedAt,
        updatedAt: updatedAt ?? createdAt
      };
    }
  });

  return result;
}

export function createDefaultSyncSettings(defaultTitle = 'Bookmarks') {
  return {
    listSort: 'created-desc',
    tagSort: 'lastUsed-desc',
    hiddenTags: [],
    pinnedTags: [],
    managerTitle: defaultTitle,
    tagLastUsed: {},
    bookmarkTimes: {}
  };
}

export function normalizeSyncSettings(data = {}, defaultTitle = 'Bookmarks') {
  const source = data && typeof data === 'object' && !Array.isArray(data)
    ? data
    : {};

  const defaults = createDefaultSyncSettings(defaultTitle);

  const listSort = LIST_SORT_OPTIONS.includes(source.listSort)
    ? source.listSort
    : defaults.listSort;

  const tagSort = TAG_SORT_OPTIONS.includes(source.tagSort)
    ? source.tagSort
    : defaults.tagSort;

  const normalizeTagList = (value) => {
    if (!Array.isArray(value)) return [];

    return [...new Set(
      value
        .map((tag) => String(tag ?? '').trim())
        .filter(Boolean)
    )];
  };

  return {
    listSort,
    tagSort,
    hiddenTags: normalizeTagList(source.hiddenTags),
    pinnedTags: normalizeTagList(source.pinnedTags),
    managerTitle: String(source.managerTitle ?? '').trim() || defaultTitle,
    tagLastUsed: normalizeTimestampMap(source.tagLastUsed),
    bookmarkTimes: normalizeBookmarkTimes(source.bookmarkTimes)
  };
}

export function normalizeBookmark(data = {}) {
  return {
    name: String(data.name ?? '').trim(),
    url: String(data.url ?? '').trim(),
    desc: String(data.desc ?? '').trim(),
    tags: Array.isArray(data.tags)
      ? [...new Set(data.tags.map((tag) => String(tag).trim()).filter(Boolean))]
      : String(data.tags ?? '')
        .split(TAG_SEPARATOR)
        .map((tag) => tag.trim())
        .filter(Boolean)
  };
}

export function createBookmark(data) {
  const bookmark = normalizeBookmark(data);

  if (
    bookmark.name.includes(',')
    || bookmark.url.includes(',')
    || bookmark.desc.includes(',')
  ) {
    throw new BookmarkDataError('errorCsvComma');
  }

  if (bookmark.tags.some((tag) => tag.includes(',') || tag.includes('|'))) {
    throw new BookmarkDataError('errorTagCharacters');
  }

  let parsedUrl;

  try {
    parsedUrl = new URL(bookmark.url);
  } catch {
    throw new BookmarkDataError('errorInvalidUrl');
  }

  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    throw new BookmarkDataError('errorInvalidUrl');
  }

  bookmark.url = parsedUrl.href;
  return bookmark;
}

export function isSafeWebUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol);
  } catch {
    return false;
  }
}

export function parseBookmarksCSV(input) {
  if (!String(input ?? '').trim()) {
    throw new BookmarkDataError('errorCsvSystemRow');
  }

  const rows = parseCSVRows(input);

  if (rows.length < 2) {
    throw new BookmarkDataError('errorCsvSystemRow');
  }

  const headers = rows.shift().map((header) => header.trim().toLowerCase());
  const columnIndex = Object.fromEntries(
    CSV_COLUMNS.map((column) => [column, headers.indexOf(column)])
  );

  const hasValidHeader = CSV_COLUMNS.length === headers.length
    && CSV_COLUMNS.every((column, index) => headers[index] === column);

  if (!hasValidHeader) {
    throw new BookmarkDataError('errorCsvHeader');
  }

  const systemRow = rows.shift();

  if (systemRow[columnIndex.url] !== 'SYS') {
    throw new BookmarkDataError('errorCsvSystemRow');
  }

  let settings;

  try {
    settings = normalizeSyncSettings(
      JSON.parse(systemRow[columnIndex.desc] || '{}')
    );
  } catch (error) {
    if (error instanceof BookmarkDataError) throw error;
    throw new BookmarkDataError('errorCsvSystemSettings');
  }

  const bookmarks = rows.map((row, index) => {
    try {
      return createBookmark({
        name: row[columnIndex.name] ?? '',
        url: row[columnIndex.url] ?? '',
        desc: row[columnIndex.desc] ?? '',
        tags: row[columnIndex.tags] ?? ''
      });
    } catch (error) {
      throw new BookmarkDataError('errorCsvRow', {
        row: index + 3
      }, {
        cause: error
      });
    }
  });

  return { bookmarks, settings };
}

export function serializeBookmarksCSV(bookmarks, settings) {
  const normalizedSettings = normalizeSyncSettings(settings);
  const systemValues = {
    name: '',
    url: 'SYS',
    desc: JSON.stringify(normalizedSettings),
    tags: ''
  };

  const rows = [
    CSV_COLUMNS
      .map((column) => escapeCSV(systemValues[column] ?? ''))
      .join(',')
  ];

  bookmarks.forEach((bookmark) => {
    const values = {
      name: bookmark.name,
      url: bookmark.url,
      desc: bookmark.desc,
      tags: bookmark.tags.join(TAG_SEPARATOR)
    };

    rows.push(
      CSV_COLUMNS
        .map((column) => escapeCSV(values[column] ?? ''))
        .join(',')
    );
  });

  return `${CSV_COLUMNS.join(',')}\n${rows.join('\n')}\n`;
}