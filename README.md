# Minimal Personal Bookmark Manager

A lightweight, self-hosted bookmark manager for keeping your links organized and synchronized across devices with GitHub Gist.

## Features

- **Cross-device synchronization** — Store your bookmarks in a GitHub Gist and access them from different devices.
- **Simple bookmark management** — Add, edit, and delete bookmarks through a clean interface.
- **Tag management** — Organize bookmarks with tags. Create new tags or select existing ones from the tag picker. Frequently used tags are prioritized to make them easier to find.
- **Clipboard support** — Paste a webpage URL into the bookmark editor to fill in the address. The app attempts to retrieve a webpage's title and description when a URL is entered. This depends on the target website and browser network restrictions, so it may not work for every page.
- **Local-first access** — Bookmark data is kept in your browser's local storage, so you can continue managing your local copy between sync operations.
- **Customizable manager** — Set the manager title and the CSV filename used in your Gist.

## Getting Started

You need a GitHub account to use GitHub Gist for synchronization.

### 1. Create a GitHub Gist

1. Open [GitHub Gist](https://gist.github.com/) and sign in.
2. Create a new secret Gist and name the file `bookmarks.csv`.
3. Add the following example content:

```csv
name,url,desc,tags
My Bookmark,https://bookmarks.gamefang.fun,My personal bookmarks,TOOL
````

### 2. Create a GitHub Personal Access Token

1. Open GitHub's [Personal access tokens settings](https://github.com/settings/tokens).
2. Choose `Tokens(classic)`, then `Generate new token (classic)`.
3. In `Select scopes`, enable the `gist` scope.
4. Generate the token and copy it immediately. GitHub will not show you the full token again.

### 3. Open or Deploy the App

You can use the hosted version:

[https://bookmarks.gamefang.fun](https://bookmarks.gamefang.fun)

Or deploy the static project to a public web host, such as [GitHub Pages](https://pages.github.com).

### 4. Configure the App

Open Settings in the app and enter the following information:

|Setting|Description|
|---|---|
|Manager Title|The name displayed in the app and browser tab. Defaults to `Bookmarks`.|
|Gist Filename|The CSV filename stored in your Gist. Defaults to `bookmarks.csv`.|
|GitHub Gist ID|The ID of your Gist. It is the final part of its URL: `https://gist.github.com/yourname/{gist_id}`.|
|GitHub Token|The Personal Access Token created in Step 2. It is needed to push changes.|

### 5. Synchronize Your Bookmarks

- Pull — Retrieve the CSV data from your configured Gist and load it into the app. Pulling replaces the current local bookmark data, so make sure you do not have unsynchronized local changes you want to keep.
- Push — Upload your local bookmark data to the configured Gist. Enter a valid GitHub token before pushing.
- To use the same bookmarks on another device, open the app there and configure the same Gist ID, filename, and token. Pull the data from the Gist to load your bookmarks.

## Data and Privacy Notes

- Gist visibility: A Secret Gist is unlisted, not private. Anyone with its URL may be able to access its contents. Do not use it to store passwords, private notes, or other sensitive information.
- Token security: The app stores its settings in your browser. A token saved in the browser may be accessible to someone who can access that browser profile or its local data. Do not share your token or use it on a device you do not trust.
- Local storage: Local bookmark data is stored in the browser's local storage and is specific to the browser and website origin. Clearing browser data may remove the local copy.
- Sync carefully: When using multiple devices, pull and push deliberately. If different devices have made changes independently, pushing one device's data may overwrite the version currently stored in the Gist. Pulling also replaces the current local data.

## Technical Overview

- Frontend: HTML, CSS, and vanilla JavaScript.
- Storage: Browser `localStorage` for local bookmark data and settings.
- Synchronization: GitHub Gist REST API.
- Data format: CSV.
- Internationalization: Text is organized for data-driven language support.
- Deployment: Static hosting; no dedicated application server is required.
- AI tools were used to assist with development.