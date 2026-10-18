// Downloads the yt-dlp binary for this platform into ./bin (it is not stored in the repository).
// Usage: npm run setup   (or: node setup.js)
const fs = require('fs');
const path = require('path');

const ASSETS = {
  win32: { remote: 'yt-dlp.exe', local: 'yt-dlp.exe' },
  darwin: { remote: 'yt-dlp_macos', local: 'yt-dlp' },
  linux: { remote: process.arch === 'arm64' ? 'yt-dlp_linux_aarch64' : 'yt-dlp_linux', local: 'yt-dlp' },
};

async function main() {
  const asset = ASSETS[process.platform];
  if (!asset) throw new Error('Unsupported platform: ' + process.platform + '. Install yt-dlp yourself and put it on your PATH.');
  const dir = path.join(__dirname, 'bin');
  const target = path.join(dir, asset.local);
  fs.mkdirSync(dir, { recursive: true });

  const url = 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/' + asset.remote;
  console.log('Downloading yt-dlp from ' + url);
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error('Download failed: HTTP ' + res.status);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(target, buf);
  if (process.platform !== 'win32') fs.chmodSync(target, 0o755);
  console.log('Saved ' + target + ' (' + (buf.length / 1048576).toFixed(1) + ' MB)');
}

main().catch((e) => { console.error(e.message); process.exit(1); });
