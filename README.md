# Minimal Bookmark Manager

A small, dependency-free browser app for managing bookmarks with local storage and GitHub Gist synchronization.

## Run

Serve this folder with any static HTTP server, then open `index.html` in a browser. ES modules are best used over HTTP rather than opening the file directly.

For example, from this folder:

```bash
python3 -m http.server 8000
```

Then visit `http://localhost:8000`.

## GitHub token

A token is only required for pushing changes. Use a fine-grained GitHub token with Gist access only. The token is stored in the browser's local storage, so do not use this app with a personal token on a shared or untrusted device.

## Sample of `bookmarks.csv`

```csv
name,url,desc,tags
Google,https://www.google.com/,Search engine,TOOL
GitHub,https://github.com,Code hosting platform,DEV|TOOL
```