// Downloads ffmpeg/ffprobe builds for every platform/arch we ship into vendor/<platform>-<arch>/,
// so installers for macOS (Apple silicon + Intel) and Windows can be built from any machine.
// npm only installs the binaries for the platform it runs on, so we fetch the packages directly.
import { execFileSync } from 'child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['darwin-arm64', 'darwin-x64', 'win32-x64'];
for (const target of targets) {
  const out = join(process.cwd(), 'vendor', target);
  mkdirSync(out, { recursive: true });
  const exe = target.startsWith('win32') ? '.exe' : '';
  for (const tool of ['ffmpeg', 'ffprobe']) {
    const file = `${tool}${exe}`;
    if (existsSync(join(out, file))) continue;
    const tmp = mkdtempSync(join(tmpdir(), 'sra-ffmpeg-'));
    const pkg = `@${tool}-installer/${target}`;
    const tgz = execFileSync('npm', ['pack', pkg, '--silent'], { cwd: tmp, encoding: 'utf8', shell: process.platform === 'win32' }).trim().split('\n').pop();
    execFileSync('tar', ['-xzf', join(tmp, tgz), '-C', tmp]);
    copyFileSync(join(tmp, 'package', file), join(out, file));
    chmodSync(join(out, file), 0o755);
    rmSync(tmp, { recursive: true, force: true });
    console.log(`fetched ${target}/${file}`);
  }
}
