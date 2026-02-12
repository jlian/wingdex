# GitHub Sync Setup Guide

## How to Enable GitHub Sync

Bird-Dex can backup your data to a GitHub Gist, allowing you to:
- **Backup your data** to the cloud
- **Sync across devices** by pulling/pushing to the same Gist
- **Export your data** in a portable JSON format
- **Choose visibility** - keep it private or share publicly

## Getting a GitHub Personal Access Token

1. Go to [GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)](https://github.com/settings/tokens)

2. Click **"Generate new token"** → **"Generate new token (classic)"**

3. Give your token a descriptive name like "Bird-Dex Sync"

4. Set an expiration (or choose "No expiration" if you want permanent sync)

5. Select the **`gist`** scope - this is the only permission needed

6. Click **"Generate token"** at the bottom

7. **Copy the token immediately** - you won't be able to see it again!

8. Go to Bird-Dex Settings and paste the token to enable sync

## Public vs Private Gists

- **Private Gist**: Only you can see your data. Best for personal use.
- **Public Gist**: Anyone with the link can view your data. Good for sharing your life list with friends or the birding community.

You can change visibility anytime in Settings.

## Auto-Sync

When enabled, Bird-Dex will automatically push your data to GitHub after each outing is saved. This ensures your backup is always up to date.

## Manual Sync

- **Push**: Upload your current local data to GitHub
- **Pull**: Download data from GitHub and merge it with your local data

Pull operations are smart - they won't duplicate data and will prefer newer dates for your life list entries.

## Data Format

Your data is stored in a single JSON file called `birddex-data.json` containing:
- Photos (as base64-encoded data URLs)
- Outings
- Observations
- Life List entries
- Saved Spots

## Security

Your GitHub token is stored encrypted in your browser's local storage and is never transmitted anywhere except to GitHub's API.
