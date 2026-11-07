// Bookmarks core logic
import { config } from './config.js';

const CSV_COLUMNS = config.csv.columns;
const TAG_SEPARATOR = config.csv.tagSeparator;

export class BookmarkDataError extends Error {
  constructor(key, params = {}, options = {}) {
    super(key, options);
    this.key = key;
    this.params = params;
  }
}

function escapeCSV(value) {
  const text = String(value ?? '');
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
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
      if (character === '\r' && text[index + 1] === '\n') index += 1;
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

export function normalizeBookmark(data = {}) {
  return {
    name: String(data.name ?? '').trim(),
    url: String(data.url ?? '').trim(),
    desc: String(data.desc ?? data.description ?? '').trim(),
    tags: Array.isArray(data.tags)
      ? [...new Set(data.tags.map((tag) => String(tag).trim()).filter(Boolean))]
      : String(data.tags ?? '').split(TAG_SEPARATOR).map((tag) => tag.trim()).filter(Boolean)
  };
}

export function createBookmark(data) {
  const bookmark = normalizeBookmark(data);

  if (!bookmark.name) {
    throw new BookmarkDataError('errorNameRequired');
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
  if (!String(input ?? '').trim()) return [];

  const rows = parseCSVRows(input);

  if (!rows.length) return [];

  const headers = rows.shift().map((header) => header.trim().toLowerCase());
  const columnIndex = Object.fromEntries(
    CSV_COLUMNS.map((column) => [column, headers.indexOf(column)])
  );

  if (columnIndex.name < 0 || columnIndex.url < 0 || columnIndex.tags < 0) {
    throw new BookmarkDataError('errorCsvHeader');
  }

  return rows.map((row, index) => {
    // Older versions wrote description commas without CSV quotes.
    // Rejoin the description columns when reading that legacy row shape.
    const hasLegacyDescription = row.length > headers.length
      && columnIndex.desc === headers.length - 2
      && columnIndex.tags === headers.length - 1;

    const getValue = (column) => {
      const position = columnIndex[column];

      if (hasLegacyDescription && column === 'desc') {
        return row.slice(position, -1).join(',');
      }

      if (hasLegacyDescription && column === 'tags') {
        return row.at(-1) ?? '';
      }

      return position >= 0 ? row[position] ?? '' : '';
    };

    try {
      return createBookmark({
        name: getValue('name'),
        url: getValue('url'),
        desc: getValue('desc'),
        tags: getValue('tags')
      });
    } catch (error) {
      throw new BookmarkDataError('errorCsvRow', {
        row: index + 2
      }, {
        cause: error
      });
    }
  });
}

export function serializeBookmarksCSV(bookmarks) {
  const rows = bookmarks.map((bookmark) => {
    const values = {
      name: bookmark.name,
      url: bookmark.url,
      desc: bookmark.desc,
      tags: bookmark.tags.join(TAG_SEPARATOR)
    };

    return CSV_COLUMNS
      .map((column) => escapeCSV(values[column] ?? ''))
      .join(',');
  });

  return `${CSV_COLUMNS.join(',')}\n${rows.join('\n')}\n`;
}