// One-off copy: pulls Cesium's prebuilt static tree out of node_modules and into
// assets/vendor/cesium so it can be loaded via a plain <script> tag at runtime,
// the same way assets/vendor/three.min.js was vendored. Re-run after bumping the
// `cesium` devDependency version.
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'node_modules', 'cesium', 'Build', 'Cesium');
const DEST = path.join(__dirname, '..', 'assets', 'vendor', 'cesium');
const FOLDERS = ['Workers', 'Assets', 'ThirdParty', 'Widgets'];

if (!fs.existsSync(SRC)) {
  console.error('Cesium build output not found at ' + SRC + ' - run npm install first.');
  process.exit(1);
}

fs.rmSync(DEST, { recursive: true, force: true });
fs.mkdirSync(DEST, { recursive: true });

fs.copyFileSync(path.join(SRC, 'Cesium.js'), path.join(DEST, 'Cesium.js'));
for (const folder of FOLDERS) {
  fs.cpSync(path.join(SRC, folder), path.join(DEST, folder), { recursive: true });
}

console.log('Vendored Cesium into ' + DEST);
