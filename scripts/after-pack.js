// electron-builder afterPack hook: stamp Orbit's icon + name into Orbit.exe.
// "signAndEditExecutable": false makes electron-builder skip its own resource editing, which is why the
// .exe used to show the default Electron icon. This does just the icon/name part (no code signing).
const path = require('path');
const fs = require('fs');
const os = require('os');
const { execFileSync } = require('child_process');

function findRceditExe(projectDir) {
  const cands = [
    // ships with electron-winstaller, which electron-builder already installs
    path.join(projectDir, 'node_modules', 'electron-winstaller', 'vendor', 'rcedit.exe'),
  ];
  // electron-builder's own download cache
  const cache = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'electron-builder', 'Cache', 'winCodeSign');
  try { for (const d of fs.readdirSync(cache)) cands.push(path.join(cache, d, 'rcedit-x64.exe'), path.join(cache, d, 'rcedit-ia32.exe')); } catch {}
  return cands.find(f => fs.existsSync(f));
}

exports.default = async function afterPack(ctx) {
  if (ctx.electronPlatformName !== 'win32') return;
  const projectDir = ctx.packager.projectDir;
  const exe = path.join(ctx.appOutDir, `${ctx.packager.appInfo.productFilename}.exe`);
  const icon = path.join(projectDir, 'electron', 'icon.ico');
  const version = ctx.packager.appInfo.version;
  const strings = { ProductName: 'Orbit', FileDescription: 'Orbit', CompanyName: 'Orbit', OriginalFilename: 'Orbit.exe', InternalName: 'Orbit' };

  // 1) the rcedit npm package, if you have it
  try {
    const mod = require('rcedit');
    const rcedit = mod.rcedit || mod.default || mod;
    await rcedit(exe, { icon, 'file-version': version, 'product-version': version, 'version-string': strings });
    return console.log('  • Orbit icon applied (rcedit package)');
  } catch (e) { if (e.code !== 'MODULE_NOT_FOUND') throw e; }

  // 2) a bundled rcedit.exe
  const tool = findRceditExe(projectDir);
  if (!tool) {
    console.warn('  ! Could not find rcedit, so Orbit.exe keeps the Electron icon. Run:  npm i -D rcedit   then build again.');
    return;
  }
  const args = [exe, '--set-icon', icon, '--set-file-version', version, '--set-product-version', version];
  for (const [k, v] of Object.entries(strings)) args.push('--set-version-string', k, v);
  execFileSync(tool, args, { stdio: 'inherit' });
  console.log('  • Orbit icon applied (' + path.basename(tool) + ')');
};
