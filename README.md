# LocalGist

LocalGist is a private Windows desktop app for finding evidence-backed insights in transcript files. It uses a local Ollama model when one is available and keeps a grounded extractive fallback for offline use.

## Install

Run `release/LocalGist Setup 1.0.0.exe` on Windows. The installer creates the LocalGist app and a local transcript folder.

## Development

```powershell
npm install
npm run desktop
npm test
npm run package:win
```

The desktop app reads its library from the app data folder when packaged. In development, it reads the local `transcripts/` folder. Add `.txt` or `.md` files from the app or place them in that folder.

## Privacy

Transcript content stays on the local machine. Analysis uses the local Ollama endpoint when configured; no hosted model API is used by the app.
