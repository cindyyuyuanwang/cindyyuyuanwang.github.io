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
  { src: 'IMG_4004.JPG', slug: 'flute-orchestra-rehearsal', group: 'music' },
  { src: '39146a4d2jf0b4e04dc6deb4bb245fbb.JPG', slug: 'football-through-defence', group: 'football' },
  { src: 'acb8c23ba89e31222bb5021f07c43516.jpg', slug: 'theatre-full-cast', group: 'stage' },
  { src: 'Weixin Image_20261110074517_138_28.png', slug: 'music-orchestra-conductor', group: 'music' },
  { src: 'Weixin Image_20261110074517_125_28.jpg', slug: 'golf-on-the-fairway', group: 'golf' },
  { src: 'Weixin Image_20261110074517_142_28.jpg', slug: 'outdoors-ridge-group', group: 'outdoors' },
  { src: '4d67488160e7bc65cdc823e288de323b.jpg', slug: 'flute-festival-duet', group: 'music' },
  { src: 'IMG_6696.JPEG', slug: 'jingju-full-costume', group: 'stage' },
  { src: 'IMG_3586.JPG', slug: 'golf-follow-through', group: 'golf' },
  { src: 'Weixin Image_20261110081934_144_28.jpg', slug: 'school-friends', group: 'everyday' },
  { src: '4f0d33c97v77b6e2ac43a0337950dde9.JPG', slug: 'football-tournament-team', group: 'football' },
  { src: 'IMG_6689.JPG', slug: 'jingju-backstage', group: 'stage' },
  { src: '9e19a12511833e1c433bb30e0f413f7a.jpg', slug: 'music-festival-stage', group: 'music' },
  { src: 'IMG_4587.JPG', slug: 'golf-approach', group: 'golf' },
  { src: '15891.jpg', slug: 'everyday-hiking', group: 'outdoors' },
  { src: 'b8783269611ba22c8c6cb0d7c94ffeb7.jpg', slug: 'theatre-three-performers', group: 'stage' },
  { src: 'IMG_8780.JPEG', slug: 'school-debate', group: 'everyday' },
  { src: '4e1854e9alf2a4940a06d14e95cb408a.JPG', slug: 'football-at-goal', group: 'football' },
  { src: 'IMG_4595.JPG', slug: 'golf-junior-podium', group: 'golf' },
  { src: 'ab644821cc41e204ed0202f49fc5e07e.jpg', slug: 'music-student-flutes', group: 'music' },
  { src: 'IMG_9997.JPG', slug: 'outdoors-parasailing', group: 'outdoors' },
  { src: 'Weixin Image_20261110074517_135_28.jpg', slug: 'music-festival-group', group: 'music' },
  { src: 'IMG_5352.JPG', slug: 'golf-iron-shot', group: 'golf' },
  { src: 'IMG_2916.JPG', slug: 'jingju-fan-practice', group: 'stage' },
  { src: 'a20f12d59lb79547c77a53ca5b02ffde.JPG', slug: 'football-goal-team', group: 'football' },
  { src: 'Weixin Image_20261110081937_146_28.jpg', slug: 'school-auditorium', group: 'everyday' },
  { src: '0e5f31ea79f769404a7313c34c5da530.jpg', slug: 'golf-school-award', group: 'golf' },
  { src: '8b7075064ld68fa407f72fac97f6a715.jpg', slug: 'football-midfield', group: 'football' },
  { src: 'IMG_3581.JPG', slug: 'golf-selection-team', group: 'golf' },
  { src: 'Weixin Image_20261110074517_136_28.jpg', slug: 'school-group-portrait', group: 'everyday' },
  { src: 'IMG_5360.JPG', slug: 'golf-invitational-awards', group: 'golf' },
  { src: 'ab6f3dad3i2ccf2149434bb8e37c8f3e.JPG', slug: 'football-contested-ball', group: 'football' },
  { src: '5c8fee7f7c8146c4cd7127dad50be886.jpg', slug: 'school-awards-group', group: 'everyday' },
  { src: 'IMG_7768.JPG', slug: 'golf-selection-portrait', group: 'golf' },
  { src: 'b76ab5733l715b9eb3b4dad3e76bc046.jpg', slug: 'football-medal-team', group: 'football' },
  { src: 'ff10aa51a96968168aa47f36265cb5eb.jpg', slug: 'golf-awards-auditorium', group: 'golf' },
];

const widths = { 480: 'thumbnail', 900: 'card', 1600: 'display' };

export const videos = [
  { src: '372_raw.MOV', slug: 'flute-concert-section', start: 0, end: null, poster: 15, maxHeight: 720 },
  { src: 'IMG_2908.MOV', slug: 'jingju-practice', start: 0.3, end: null, poster: 40.5, maxHeight: 720 },
  { src: '8238_raw.MP4', slug: 'music-dragonfruit-live', start: 120, end: 161, poster: 143, maxHeight: 720 },
  { src: 'IMG_4779.MOV', slug: 'outdoors-river-jump', start: 0, end: null, poster: 1.3, maxHeight: 720 },
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
