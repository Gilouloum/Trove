# Third-party notices

Trove itself is licensed under the [GPL-3.0](LICENSE). It is built on, and ships with, the following open-source software, fonts, models, and assets. Thank you to everyone who made them.

## Libraries

| Project | License | Used for |
|---|---|---|
| [Electron](https://github.com/electron/electron) | MIT | The app shell |
| [electron-updater](https://github.com/electron-userland/electron-builder) | MIT | Automatic updates |
| [electron-builder](https://github.com/electron-userland/electron-builder) | MIT | Building the installers |
| [heic-decode](https://github.com/catdad-experiments/heic-decode) | ISC | Decoding iPhone HEIC photos |
| [CesiumJS](https://github.com/CesiumGS/cesium) | Apache-2.0 | The 3D globe |
| [Transformers.js](https://github.com/huggingface/transformers.js) | Apache-2.0 | Running the AI models on your computer |
| [@vladmandic/face-api](https://github.com/vladmandic/face-api) | MIT | Face detection and recognition |

## AI models

| Model | License | Used for |
|---|---|---|
| [CLIP ViT-B/32](https://huggingface.co/Xenova/clip-vit-base-patch32), by OpenAI, converted by Xenova | MIT | Search by what's in a photo |
| [SlimSAM](https://huggingface.co/Xenova/slimsam-77-uniform), based on Meta's Segment Anything, converted by Xenova | Apache-2.0 | PhotoMod's Auto select |
| Face detection and recognition models bundled with [@vladmandic/face-api](https://github.com/vladmandic/face-api) | MIT | People |

## Fonts

| Font | License |
|---|---|
| [DM Sans](https://github.com/googlefonts/dm-fonts) | SIL Open Font License 1.1 |
| [DM Mono](https://github.com/googlefonts/dm-mono) | SIL Open Font License 1.1 |

## Images and map data

- `assets/earth/earth_clouds_2048.png`, the globe's cloud layer, is adapted from the [three.js](https://github.com/mrdoob/three.js) example textures (MIT): the same cloud map, recolored to plain white so only its transparency shapes the clouds.
- Satellite imagery, place labels, and elevation on the globe are streamed at runtime from [Esri ArcGIS](https://www.esri.com) services and are subject to Esri's terms. They are not part of this repository.
- Place names come from [OpenStreetMap](https://www.openstreetmap.org/copyright) via its Nominatim service, © OpenStreetMap contributors, available under the Open Database License.

Full license texts are included with each library in `node_modules/` after `npm install`, and in the vendored copies under `assets/vendor/` and `assets/models/`.
