// Writes resources/THIRD_PARTY_NOTICES.md: licences of everything shipped in the installers.
// Run after `npm install` when dependencies change: node scripts/gen-notices.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';

const root = process.cwd();
const nm = join(root, 'node_modules');

// Libraries bundled into the app (renderer and main), plus their runtime dependencies.
const seeds = [
  'electron', 'react', 'react-dom', 'zustand', 'lucide-react', 'clsx', 'tailwind-merge',
  '@huggingface/transformers', 'onnxruntime-web', '@anthropic-ai/sdk',
];
const skip = new Set(['onnxruntime-node', 'sharp', 'zod']);

const seen = new Map();
function visit(name) {
  if (seen.has(name) || skip.has(name)) return;
  const dir = join(nm, name);
  if (!existsSync(join(dir, 'package.json'))) return;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  const licFile = readdirSync(dir).find((f) => /^(licen[cs]e|copying)(\.(md|txt))?$/i.test(f));
  seen.set(name, {
    name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : pkg.license?.type ?? 'See package',
    homepage: pkg.homepage || (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) || '',
    text: licFile ? readFileSync(join(dir, licFile), 'utf8').trim() : '',
  });
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep);
}
seeds.forEach(visit);

const ffmpegNote = `## ffmpeg and ffprobe

The installers include ffmpeg/ffprobe executables (macOS builds from the @ffmpeg-installer / @ffprobe-installer
npm packages, Windows builds from @ffmpeg-installer/win32-x64 and @ffprobe-installer/win32-x64). They are separate
programs that ScreenRecorderApp runs; they are not linked into it.

These builds are configured with \`--enable-gpl --enable-version3\` and include libx264, libx265 and other libraries,
so they are distributed under the **GNU General Public License, version 3**
(https://www.gnu.org/licenses/gpl-3.0.html). The full licence text ships with the app as \`licenses/GPL-3.0.txt\`. FFmpeg is a trademark of Fabrice Bellard, originator of the FFmpeg project.

Source code: https://ffmpeg.org/download.html (release archives: https://ffmpeg.org/releases/). The exact version
is shown in the app under About and Settings › ffmpeg. If you received these binaries from us and need the
corresponding source, open an issue on the project's GitHub repository and we will provide it.

You can use your own ffmpeg build instead: Settings › ffmpeg › Custom ffmpeg binary.

## Speech recognition model

Live captions download OpenAI's Whisper model (converted to ONNX by the Hugging Face community,
https://huggingface.co/onnx-community) on first use. Whisper is released under the MIT License
(https://github.com/openai/whisper/blob/main/LICENSE). The model is not included in the installers.

## Fonts and icons

Interface icons are from Lucide (ISC License, listed below). The app uses the operating system's own fonts.
`;

const list = [...seen.values()].sort((a, b) => a.name.localeCompare(b.name));
let md = `# Third-party notices

ScreenRecorderApp is © ${new Date().getFullYear()} NexaSecure Cloud and AI and released under the MIT License.
It is built with the open-source software listed below. Thank you to all of their authors.

${ffmpegNote}
## JavaScript libraries

| Package | Version | License |
| --- | --- | --- |
${list.map((p) => `| ${p.name} | ${p.version} | ${p.license} |`).join('\n')}

## License texts
`;
for (const p of list) {
  md += `\n### ${p.name} ${p.version} (${p.license})\n${p.homepage ? `\n${p.homepage.replace(/^git\+/, '')}\n` : ''}\n\`\`\`\n${p.text || `Licensed under ${p.license}.`}\n\`\`\`\n`;
}
writeFileSync(join(root, 'resources', 'THIRD_PARTY_NOTICES.md'), md);
console.log(`Wrote notices for ${list.length} packages`);
