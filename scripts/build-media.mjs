// Builds public, metadata-free derivatives of the curated photos and videos.
// Reads non-destructively from assets/iCloud Photos (never deployed) and writes to assets/media.
import sharp from 'sharp';
import exifr from 'exifr';
import fs from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(root, 'assets', 'iCloud Photos');
const outDir = path.join(root, 'assets', 'media');
const fontsDir = path.join(root, 'assets', 'fonts');
const MAX_VIDEO_BYTES = 12 * 1024 * 1024;

export const photos = [
  { src: 'IMG_8487.JPG', slug: 'flute-concert-hall', group: 'music' },
  { src: 'IMG_4004.JPG', slug: 'flute-orchestra-rehearsal', group: 'music' },
  { src: 'IMG_4297.JPG', slug: 'flute-orchestra-seated', group: 'music' },
  { src: 'IMG_4298.JPG', slug: 'flute-with-section', group: 'music' },
  { src: 'IMG_6696.JPEG', slug: 'jingju-full-costume', group: 'stage' },
  { src: 'IMG_2916.JPG', slug: 'jingju-fan-practice', group: 'stage' },
  { src: 'IMG_6689.JPG', slug: 'jingju-backstage', group: 'stage' },
  { src: 'IMG_3586.JPG', slug: 'golf-follow-through', group: 'golf' },
  { src: 'IMG_5352.JPG', slug: 'golf-iron-shot', group: 'golf' },
  { src: 'IMG_6108.JPG', slug: 'golf-league-tee-shot', group: 'golf' },
  { src: 'IMG_4592.JPG', slug: 'golf-junior-tour-swing', group: 'golf' },
  { src: 'IMG_5742.JPG', slug: 'everyday-notebook', group: 'everyday' },
  { src: '15891.jpg', slug: 'everyday-hiking', group: 'everyday' },
  { src: 'a6ca3be25p14616418e512b5d49bfeb5.JPG', slug: 'everyday-football', group: 'everyday' },
  { src: 'IMG_4664.JPEG', slug: 'everyday-stream-scramble', group: 'everyday' },
];

const widths = { 1600: 'display', 900: 'card' };

export const videos = [
  // 371_raw opens on a wide shot that zooms in at ~1.2s; start after the zoom settles.
  { src: '371_raw.MP4', slug: 'flute-ensemble', start: 2.0, end: null, poster: 22, maxHeight: 720 },
  // Steady single take; keep the closing fan pose.
  { src: 'IMG_2908.MOV', slug: 'jingju-practice', start: 0.3, end: null, poster: 40.5, maxHeight: 720 },
];

function locateTool(name) {
  try {
    const found = execFileSync('where.exe', [name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).split(/\r?\n/)[0].trim();
    if (found) return found;
  } catch { /* fall through to WinGet lookup */ }
  const pkgRoot = path.join(process.env.LOCALAPPDATA ?? '', 'Microsoft', 'WinGet', 'Packages');
  if (existsSync(pkgRoot)) {
    for (const folder of readdirSync(pkgRoot).filter((n) => n.startsWith('Gyan.FFmpeg_'))) {
      const base = path.join(pkgRoot, folder);
      for (const build of readdirSync(base)) {
        const exe = path.join(base, build, 'bin', `${name}.exe`);
        if (existsSync(exe)) return exe;
      }
    }
  }
  throw new Error(`${name} not found in PATH or WinGet FFmpeg packages.`);
}

async function buildPhotos(manifest) {
  for (const p of photos) {
    const input = path.join(srcDir, p.src);
    const meta = await sharp(input).rotate().toBuffer({ resolveWithObject: true });
    const entry = { ...p, width: meta.info.width, height: meta.info.height, files: {} };
    for (const [w, label] of Object.entries(widths)) {
      const base = sharp(input).rotate().resize({ width: Number(w), withoutEnlargement: true });
      const webp = path.join(outDir, `${p.slug}-${w}.webp`);
      const jpg = path.join(outDir, `${p.slug}-${w}.jpg`);
      const info = await base.clone().webp({ quality: 82 }).toFile(webp);
      await base.clone().jpeg({ quality: 82, mozjpeg: true, progressive: true }).toFile(jpg);
      entry.files[label] = { width: info.width, height: info.height, webp: path.basename(webp), jpg: path.basename(jpg) };
    }
    delete entry.src;
    manifest.photos.push(entry);
    console.log(`photo ${p.slug} ${entry.width}x${entry.height}`);
  }
}

function buildVideos(manifest) {
  const ffmpeg = locateTool('ffmpeg');
  const ffprobe = locateTool('ffprobe');
  for (const v of videos) {
    const input = path.join(srcDir, v.src);
    const out = path.join(outDir, `${v.slug}.mp4`);
    const args = ['-v', 'error', '-y', '-ss', String(v.start), '-i', input];
    if (v.end) args.push('-to', String(v.end - v.start));
    args.push(
      '-map', '0:v:0', '-map', '0:a:0?',
      '-map_metadata', '-1', '-map_metadata:s:v', '-1', '-map_metadata:s:a', '-1', '-map_chapters', '-1',
      '-vf', `scale=-2:'min(${v.maxHeight},ih)'`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-profile:v', 'main', '-crf', '24', '-preset', 'slow',
      '-c:a', 'aac', '-b:a', '128k', '-ac', '2',
      '-movflags', '+faststart', '-fflags', '+bitexact', '-flags:v', '+bitexact', '-flags:a', '+bitexact',
      out,
    );
    execFileSync(ffmpeg, args, { stdio: 'inherit' });

    const frame = execFileSync(ffmpeg, ['-v', 'error', '-ss', String(v.poster), '-i', input, '-frames:v', '1', '-map_metadata', '-1', '-vf', `scale=-2:'min(${v.maxHeight},ih)'`, '-f', 'image2pipe', '-c:v', 'png', '-'], { maxBuffer: 64 * 1024 * 1024 });
    manifest._pending.push(
      sharp(frame).webp({ quality: 82 }).toFile(path.join(outDir, `${v.slug}-poster.webp`)),
      sharp(frame).jpeg({ quality: 82, mozjpeg: true, progressive: true }).toFile(path.join(outDir, `${v.slug}-poster.jpg`)),
    );

    const probe = JSON.parse(execFileSync(ffprobe, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', out], { encoding: 'utf8' }));
    const vs = probe.streams.find((s) => s.codec_type === 'video');
    const as = probe.streams.find((s) => s.codec_type === 'audio');
    manifest.videos.push({
      slug: v.slug, file: path.basename(out), poster: { webp: `${v.slug}-poster.webp`, jpg: `${v.slug}-poster.jpg` },
      width: vs.width, height: vs.height, codec: vs.codec_name, profile: vs.profile, pixFmt: vs.pix_fmt,
      audio: as ? `${as.codec_name} ${Math.round(Number(as.bit_rate) / 1000)}k` : 'none',
      duration: Number(Number(probe.format.duration).toFixed(2)), bytes: Number(probe.format.size),
      formatTags: probe.format.tags ?? {}, streamTags: probe.streams.map((s) => s.tags ?? {}),
    });
    console.log(`video ${v.slug} ${vs.width}x${vs.height} ${probe.format.duration}s ${probe.format.size} bytes`);
  }
}

async function verify(manifest) {
  const problems = [];
  for (const name of await fs.readdir(outDir)) {
    const file = path.join(outDir, name);
    if (/\.(jpe?g|webp|png)$/i.test(name)) {
      const buf = await fs.readFile(file);
      const tags = await exifr.parse(buf, { tiff: true, exif: true, gps: true, xmp: true, iptc: true, icc: false, mergeOutput: true }).catch(() => null);
      const gps = await exifr.gps(buf).catch(() => null);
      const sm = await sharp(buf).metadata();
      if (gps) problems.push(`${name}: GPS present`);
      if (tags && Object.keys(tags).length) problems.push(`${name}: metadata tags ${Object.keys(tags).join(',')}`);
      if (sm.exif || sm.xmp || sm.iptc) problems.push(`${name}: embedded EXIF/XMP/IPTC block`);
    }
  }
  const risky = /location|iso6709|creation_time|date|make|model|software|encoder|com\.apple/i;
  // FFmpeg's own "Lavc libx264" encoder tag identifies no device, person, place, or time.
  const isRisky = (k, val) => risky.test(k) && !(k === 'encoder' && /^Lavc/.test(String(val)));
  for (const v of manifest.videos) {
    for (const [k, val] of Object.entries(v.formatTags)) if (isRisky(k, val)) problems.push(`${v.file}: container tag ${k}=${val}`);
    v.streamTags.forEach((t, i) => Object.entries(t).forEach(([k, val]) => { if (isRisky(k, val)) problems.push(`${v.file}: stream ${i} tag ${k}=${val}`); }));
    if (v.bytes > MAX_VIDEO_BYTES) problems.push(`${v.file}: ${v.bytes} bytes exceeds 12 MB`);
    if (v.codec !== 'h264' || v.pixFmt !== 'yuv420p') problems.push(`${v.file}: not H.264 yuv420p`);
  }
  return problems;
}

async function main() {
  await fs.rm(outDir, { recursive: true, force: true });
  await fs.mkdir(outDir, { recursive: true });
  const manifest = { photos: [], videos: [], _pending: [] };
  await buildPhotos(manifest);
  buildVideos(manifest);
  await Promise.all(manifest._pending);
  delete manifest._pending;

  await fs.mkdir(fontsDir, { recursive: true });
  const fontSrc = path.join(root, 'node_modules', '@fontsource-variable');
  const fonts = [
    ['newsreader', 'newsreader-latin-wght-normal.woff2'],
    ['newsreader', 'newsreader-latin-wght-italic.woff2'],
    ['plus-jakarta-sans', 'plus-jakarta-sans-latin-wght-normal.woff2'],
  ];
  for (const [pkg, file] of fonts) await fs.copyFile(path.join(fontSrc, pkg, 'files', file), path.join(fontsDir, file));
  await fs.copyFile(path.join(fontSrc, 'newsreader', 'LICENSE'), path.join(fontsDir, 'OFL-newsreader.txt'));
  await fs.copyFile(path.join(fontSrc, 'plus-jakarta-sans', 'LICENSE'), path.join(fontsDir, 'OFL-plus-jakarta-sans.txt'));

  const problems = await verify(manifest);
  for (const v of manifest.videos) { delete v.formatTags; delete v.streamTags; }
  await fs.writeFile(path.join(root, '.inspection', 'media-manifest.json'), JSON.stringify(manifest, null, 2));

  let total = 0;
  for (const name of await fs.readdir(outDir)) total += (await fs.stat(path.join(outDir, name))).size;
  console.log(`assets/media: ${(await fs.readdir(outDir)).length} files, ${(total / 1048576).toFixed(2)} MB`);
  if (problems.length) {
    console.error('METADATA/QUALITY CHECK FAILED:');
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
  console.log('Metadata check passed: 0 EXIF/GPS/XMP/IPTC tags in images, 0 location/date/device tags in videos.');
}

await main();
