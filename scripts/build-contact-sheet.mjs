import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import exifr from "exifr";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "assets", "iCloud Photos");
const output = path.join(root, ".inspection");
const thumbs = path.join(output, "thumbs");
const photos = new Set([".jpg", ".jpeg", ".png", ".heic", ".webp"]);
const videos = new Set([".mov", ".mp4"]);
const escape = text => String(text).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function locateTool(name) {
  try {
    return execFileSync("where.exe", [name], { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  } catch {
    const packages = path.join(process.env.LOCALAPPDATA, "Microsoft", "WinGet", "Packages");
    const candidates = await fs.readdir(packages);
    for (const folder of candidates.filter(n => n.startsWith("Gyan.FFmpeg_"))) {
      const base = path.join(packages, folder);
      for (const child of await fs.readdir(base)) {
        const candidate = path.join(base, child, "bin", name + ".exe");
        try { await fs.access(candidate); return candidate; }
        catch (error) { if (error.code !== "ENOENT") throw error; }
      }
    }
    throw new Error(`${name} not found in PATH or WinGet FFmpeg packages.`);
  }
}

async function walk(dir) {
  const files = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(full));
    else if (entry.isFile()) files.push(full);
  }
  return files;
}

async function main() {
  await fs.mkdir(thumbs, { recursive: true });
  const ffmpeg = await locateTool("ffmpeg");
  const ffprobe = await locateTool("ffprobe");
  const files = (await walk(source)).sort();
  const catalog = { totalFiles: files.length, totalBytes: 0, photos: 0, videos: 0, other: 0, gpsImages: 0, metadataErrors: [], renderErrors: [], tools: { ffmpeg, ffprobe }, items: [] };
  for (const [index, file] of files.entries()) {
    const ext = path.extname(file).toLowerCase();
    const stat = await fs.stat(file);
    catalog.totalBytes += stat.size;
    const item = { filename: path.relative(source, file), bytes: stat.size, kind: photos.has(ext) ? "Photo" : videos.has(ext) ? "Video" : "Other" };
    const thumb = path.join(thumbs, `${String(index + 1).padStart(3, "0")}.jpg`);
    if (item.kind === "Other") { catalog.other++; catalog.items.push(item); continue; }
    try {
      if (item.kind === "Photo") {
        catalog.photos++;
        const metadata = await sharp(file).metadata();
        item.width = metadata.width;
        item.height = metadata.height;
        try {
          const gps = await exifr.gps(await fs.readFile(file));
          item.hasGps = Boolean(gps && Number.isFinite(gps.latitude) && Number.isFinite(gps.longitude));
          if (item.hasGps) catalog.gpsImages++;
        } catch (error) { catalog.metadataErrors.push({ filename: item.filename, operation: "gps", error: error.message }); }
        await sharp(file).rotate().resize({ width: 320 }).jpeg({ quality: 80 }).toFile(thumb);
      } else {
        catalog.videos++;
        const probe = JSON.parse(execFileSync(ffprobe, ["-v", "error", "-show_streams", "-show_format", "-of", "json", file], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }));
        const video = probe.streams.find(stream => stream.codec_type === "video");
        if (!video) throw new Error("No video stream found.");
        Object.assign(item, { codec: video.codec_name, width: video.width, height: video.height, duration: Number(probe.format.duration) });
        execFileSync(ffmpeg, ["-v", "error", "-ss", "1", "-i", file, "-frames:v", "1", "-vf", "scale=320:-2", "-y", thumb], { stdio: "pipe" });
      }
      item.thumb = path.relative(output, thumb).split(path.sep).join("/");
    } catch (error) {
      item.error = error.message;
      catalog.renderErrors.push({ filename: item.filename, error: error.message });
      console.error(`Media audit failed for ${item.filename}: ${error.message}`);
    }
    catalog.items.push(item);
  }
  await fs.writeFile(path.join(output, "media-catalog.json"), JSON.stringify(catalog, null, 2));
  let browser;
  try {
    browser = await chromium.launch({ headless: true });
    for (let start = 0; start < catalog.items.length; start += 20) {
      const pageNumber = start / 20 + 1;
      const cards = catalog.items.slice(start, start + 20).map(item => `<figure>${item.thumb ? `<img src="${escape(item.thumb)}" alt="">` : `<div class="error">No preview: ${escape(item.error || "Unsupported file")}</div>`}<figcaption><b>${escape(item.filename)}</b><span>${item.kind} · ${item.width || "?"} × ${item.height || "?"}${item.duration ? ` · ${item.duration.toFixed(1)}s · ${escape(item.codec)}` : ""}</span></figcaption></figure>`).join("");
      const html = `<!doctype html><meta charset="utf-8"><title>Private media contact sheet ${pageNumber}</title><style>body{margin:24px;font:14px Segoe UI,sans-serif;background:#f5f3ee;color:#1e2926}main{display:grid;grid-template-columns:repeat(4,320px);gap:18px}figure{margin:0;border:1px solid #d9d8d0;background:white}img,.error{width:320px;height:210px;object-fit:contain;background:#e8e5de}figcaption{padding:9px;overflow-wrap:anywhere}figcaption span{display:block;font-size:12px;margin-top:5px}h1{font-size:20px}</style><h1>Private media contact sheet ${pageNumber}</h1><main>${cards}</main>`;
      const htmlFile = path.join(output, `contact-sheet-${pageNumber}.html`);
      await fs.writeFile(htmlFile, html);
      const page = await browser.newPage({ viewport: { width: 1400, height: 1600 } });
      await page.goto(pathToFileURL(htmlFile).href, { waitUntil: "networkidle" });
      await page.screenshot({ path: path.join(output, `contact-sheet-${pageNumber}.png`), fullPage: true });
      await page.close();
    }
  } finally {
    if (browser) await browser.close();
  }
  console.log(`Media catalog: ${catalog.photos} photos, ${catalog.videos} videos, ${catalog.other} other; ${catalog.gpsImages} GPS-tagged images; ${catalog.renderErrors.length} preview failures.`);
  if (catalog.renderErrors.length || catalog.metadataErrors.length) process.exitCode = 1;
}
main().catch(error => { console.error(error); process.exitCode = 1; });
