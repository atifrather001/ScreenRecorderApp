// electron-builder afterSign hook (macOS).
// Without an Apple Developer ID the app is ad-hoc signed, and an ad-hoc signature's "designated requirement" is
// the exact code hash, which changes with every build. macOS ties Screen Recording / Microphone / Camera
// permission to that requirement, so every update would silently lose the permission. Re-sign the outer app with a
// requirement based on the bundle identifier, so permissions survive updates.
const { execFileSync } = require('child_process');
const path = require('path');

exports.default = async function afterSign(context) {
  if (context.electronPlatformName !== 'darwin') return;
  const identity = context.packager.platformSpecificBuildOptions.identity;
  if (identity !== '-') return; // A real Developer ID already has a stable requirement.
  const appId = context.packager.appInfo.id;
  const app = path.join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`);
  execFileSync('codesign', ['--force', '--sign', '-', `-r=designated => identifier "${appId}"`, app], { stdio: 'inherit' });
  execFileSync('codesign', ['--verify', '--deep', '--strict', app], { stdio: 'inherit' });
  console.log(`  • stable designated requirement set  identifier=${appId}`);
};
