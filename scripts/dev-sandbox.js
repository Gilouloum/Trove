// npm run dev:sandbox            start Trove on a throwaway library (kept between runs)
// npm run dev:sandbox -- --reset wipe that library first, so it starts completely empty
//
// The sandbox library lives in data-sandbox/ (gitignored), or in TROVE_DATA_DIR if you set it.
// It never touches an installed Trove's library, and starts empty: only the files you add to
// it are in it. Trove still deletes real files when you tell it to, so add *copies* of photos.
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const dir = path.resolve(process.env.TROVE_DATA_DIR || path.join(root, 'data-sandbox'));

if (process.argv.includes('--reset')) {
  fs.rmSync(dir, { recursive: true, force: true });
  console.log(`Sandbox library reset: ${dir}`);
}
console.log(`Sandbox library: ${dir}`);

// VS Code's terminal sets ELECTRON_RUN_AS_NODE, which would make Electron start as plain Node.
const env = { ...process.env, TROVE_DATA_DIR: dir };
delete env.ELECTRON_RUN_AS_NODE;

const child = spawn(require('electron'), ['.'], { cwd: root, env, stdio: 'inherit' });
child.on('exit', code => process.exit(code ?? 0));
