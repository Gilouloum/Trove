// electron-builder afterPack hook: gives the macOS build an ad-hoc code signature.
//
// Without an Apple Developer certificate, electron-builder does not sign the app at all - it
// logs "skipped macOS application code signing" and moves on (see the
// `if (!options.sign && identity == null) return false` branch in app-builder-lib's
// macPackager). There is no free ad-hoc fallback, despite it being easy to assume there is.
//
// That is fatal on Apple Silicon: the kernel refuses to run an arm64 binary carrying no
// signature whatsoever, so macOS reports a downloaded build as "«Trove.app» is damaged and
// can't be opened" instead of the usual unidentified-developer prompt. An ad-hoc signature
// ("-") costs nothing, needs no certificate, and is enough to make the app runnable.
//
// It does NOT satisfy Gatekeeper for a quarantined download, so a first-time user still has to
// strip the quarantine flag once (see the macOS section of README.md). The only way to remove
// that step is a paid Developer ID certificate plus notarization.
//
// Runs after the .app is packed but before the dmg/zip targets are built, so the signature
// ends up inside the published artifacts.

const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function adhocSignMac(context) {
  if (context.electronPlatformName !== 'darwin') return;
  // A real certificate is present, so electron-builder will do a proper (and better) signing
  // pass of its own right after this hook - don't overwrite it with an ad-hoc signature.
  if (process.env.CSC_LINK || process.env.CSC_NAME) return;

  const appPath = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  // --deep so the nested helper apps and Electron Framework get signed too; they are separate
  // bundles and an unsigned helper is just as unrunnable on Apple Silicon as an unsigned app.
  execFileSync('codesign', ['--force', '--deep', '--sign', '-', appPath], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', appPath], { stdio: 'inherit' });
  console.log(`Ad-hoc signed ${appPath}`);
};
