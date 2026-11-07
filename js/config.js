// Load the single runtime configuration shared by all application modules.
const response = await fetch(new URL('../config.json', import.meta.url), {
  cache: 'no-cache'
});

if (!response.ok) {
  throw new Error(`Unable to load config.json (${response.status} ${response.statusText})`);
}

export const config = await response.json();

if (!config || typeof config !== 'object') {
  throw new Error('config.json must contain a JSON object.');
}