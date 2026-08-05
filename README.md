# Turn Highlighter

A companion Owlbear Rodeo extension that draws a glowing ring on the scene canvas around whichever token currently has the active turn in the [Battle Board](https://github.com/MissingLinkDev/battle-board) initiative tracker.

## Installing via GitHub Pages

This extension is hosted on GitHub Pages. To add it to an Owlbear Rodeo room:

1. **Add the extension as GM:** In Owlbear Rodeo, open the **Extensions** menu and choose **Add Custom Extension**. Paste in the manifest URL:

   ```
   https://cdelashmutt.github.io/battle-board-highlight-token/manifest.json
   ```

2. Once the GM adds it to a room, the extension is automatically visible to **everyone connected to that room** — no per-player install is required.

> GitHub Pages serves `manifest.json` with the correct `application/json` content-type automatically.

## How it works

Battle Board stores turn state directly on each scene item as OBR metadata. Turn Highlighter reads that metadata and draws a stroked circle attached to any token where `active: true`. The ring follows the token when it moves and disappears when the turn advances.

- Handles group turns — multiple tokens can be highlighted simultaneously
- Automatically hides all highlights when Battle Board's combat is not started
- Degrades gracefully if Battle Board is not installed in the room

## Settings

Click the extension icon in OBR to open the settings popover:

| Setting | Description |
|---|---|
| Enabled | Toggle highlights on/off without removing the extension |
| Color | Pick the ring color (default: gold `#ffd700`) |
| Ring width | Adjust stroke thickness (2–30px) |

Settings are persisted to room metadata and sync across all connected clients.

## Development

```bash
npm install
npm run dev      # local dev server
npm run build    # production build → dist/
```

Built with [Vite](https://vitejs.dev/) + TypeScript and the [`@owlbear-rodeo/sdk`](https://www.npmjs.com/package/@owlbear-rodeo/sdk).

To use in OBR, host the `dist/` folder on any static host and register the URL as an extension in your room.

## Disclaimer

Turn Highlighter is an unofficial, independent companion extension for Battle Board by Missing Link Dev. Not affiliated with or endorsed by the Battle Board project.
