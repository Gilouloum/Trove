# Contributing to Trove

Thanks for taking a look. Trove is a one-person project, so bug reports, ideas, and pull requests all genuinely help.

## Reporting a bug or suggesting something

[Open an issue](https://github.com/Gilouloum/Trove-releases/issues). For bugs, it helps to include:

- your OS (Windows 10/11, or macOS and which Mac)
- what you did, what you expected, and what happened instead
- a screenshot, if it's something you can see

Please don't attach photos from your library unless you're comfortable with them being public.

## Running Trove from source

You need [Node.js](https://nodejs.org) 20 or newer and Git.

```bash
git clone https://github.com/Gilouloum/Trove-releases.git
cd Trove-releases
npm install

# One time: copy the libraries and AI models Trove loads from local disk into assets/.
# They're too big to keep in Git (about 190 MB), so these scripts fetch or copy them.
npm run vendor:cesium         # 3D globe
npm run vendor:transformers   # runs the AI models
npm run vendor:clip-model     # search by what's in a photo (downloads from Hugging Face)
npm run vendor:sam-model      # PhotoMod's Auto select (downloads from Hugging Face)
npm run vendor:face-api       # face recognition

npm start
```

When you run from source, your library is saved in a `data/` folder inside the repo (it's gitignored), not in your normal Trove profile. If you also have Trove installed, the first run starts from a copy of that library; after that, the two are separate, so you can experiment without touching the installed one. Builds run from source never send the anonymous usage ping.

To build installers yourself: `npm run build` (on macOS, Trove signs the app ad hoc; see `scripts/adhoc-sign-mac.js`).

## Where things live

Trove is an Electron app with no frontend framework: plain JavaScript, HTML, and CSS.

| File | What it does |
|---|---|
| `main.js` | The Electron main process: reading and saving your library, file access, imports, metadata and thumbnails, updates, and the usage ping. |
| `preload.js` | The bridge between the two: every call the UI can make into `main.js` is listed here as `window.api.*`. |
| `renderer.js` | The whole UI: library, sidebar, trips, people, sorting, the photo editor and PhotoMod, settings. It's big, so search it by function name. Translations live in the `I18N` table near the top (English, French, German, Spanish, Chinese). |
| `index.html` | All the markup and CSS. |
| `globe.js` | The 3D globe (CesiumJS). |
| `faceIndex.js` + `worker/face-worker.js` | Face recognition for People. |
| `semanticIndex.js` + `worker/semantic-worker.js` | Search by what's in a photo (CLIP). |
| `worker/segment-worker.js` | PhotoMod's Auto select (SlimSAM). |
| `worker/inpaint-worker.js` | PhotoMod's smart eraser. |
| `viewer360.js` | The 360° viewer and video frame grabs. |
| `media-types.js` | Every photo and video format Trove recognizes, shared by `main.js` and `renderer.js`. |
| `scripts/` | The `vendor:*` scripts above and the macOS signing hook. |

## Pull requests

- **Keep it small and focused.** One fix or feature per pull request is much easier to review. For anything big, open an issue first so we can agree on the approach before you spend time on it.
- **Your photos stay on the user's computer.** Trove never uploads, copies, or moves the user's files. Anything that touches the network has to be listed in [PRIVACY.md](PRIVACY.md), and photo content, file names, and paths never leave the machine.
- **Match the code around you.** Comments explain *why*, not just what. User-facing text goes through `t()` with an entry in `I18N` for every language (a best-effort translation is fine). Don't use em dashes in user-facing copy.
- **Test it in the app.** Run `npm start` and try your change on a real folder of photos, including a couple of HEIC and video files if it touches importing or thumbnails.

By submitting a pull request, you agree that your contribution is licensed under the [GPL-3.0](LICENSE), the same as the rest of Trove.

## Forking

You're free to fork Trove under the GPL-3.0. If you ship your own builds, point `telemetry-config.js` at your own Firebase project or delete it, so your users' usage pings don't end up in Trove's, and please give your fork a different name so people don't confuse the two.
