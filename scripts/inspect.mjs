import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".inspection");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".woff2": "font/woff2", ".mp4": "video/mp4", ".mov": "video/quicktime" };

export async function startServer() {
  const server = http.createServer(async (req, res) => {
    try {
      let decoded;
      try { decoded = decodeURIComponent((req.url || "/").split("?")[0]); }
      catch { res.writeHead(400).end("Bad request"); return; }
      const segments = decoded.replaceAll("\\", "/").split("/").filter(Boolean);
      if (segments.some(s => s === ".." || s.startsWith(".") || /^(private_records|profile_cindy\.txt|icloud photos|conf_token\.txt|node_modules)$/i.test(s))) {
        res.writeHead(403).end("Forbidden"); return;
      }
      const relative = segments.length ? segments.join(path.sep) : "index.html";
      const file = path.resolve(root, relative);
      if (!file.startsWith(root + path.sep) || !["index.html", "css", "js", "assets"].includes(segments[0] || "index.html")) {
        res.writeHead(403).end("Forbidden"); return;
      }
      const realFile = await fs.realpath(file);
      const relativeReal = path.relative(root, realFile);
      if (relativeReal.startsWith("..") || path.isAbsolute(relativeReal) || relativeReal.split(path.sep).some(s => s.startsWith(".") || /^(private_records|profile_cindy\.txt|icloud photos|conf_token\.txt|node_modules)$/i.test(s))) {
        res.writeHead(403).end("Forbidden"); return;
      }
      const bytes = await fs.readFile(realFile);
      const headers = { "Content-Type": types[path.extname(realFile).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store", "Accept-Ranges": "bytes" };
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || "");
      if (range) {
        const start = range[1] ? Number(range[1]) : Math.max(0, bytes.length - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), bytes.length - 1) : bytes.length - 1;
        if (start >= bytes.length || start > end) { res.writeHead(416, { "Content-Range": `bytes */${bytes.length}` }).end(); return; }
        res.writeHead(206, { ...headers, "Content-Range": `bytes ${start}-${end}/${bytes.length}`, "Content-Length": end - start + 1 }).end(bytes.subarray(start, end + 1));
        return;
      }
      res.writeHead(200, { ...headers, "Content-Length": bytes.length }).end(bytes);
    } catch (error) {
      if (error.code === "ENOENT" || error.code === "EISDIR") res.writeHead(404).end("Not found");
      else { console.error("Static server error:", error.message); res.writeHead(500).end("Server error"); }
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return { server, url: `http://127.0.0.1:${server.address().port}` };
}

async function inspect() {
  await fs.mkdir(output, { recursive: true });
  const { server, url } = await startServer();
  let browser;
  const report = { viewports: [], privacyChecks: [] };
  try {
    for (const route of ["/private_records/test.pdf", "/profile_cindy.txt", "/%2e%2e%5cprofile_cindy.txt", "/assets/iCloud%20Photos/test.JPG", "/.inspection/report.json"]) {
      const response = await fetch(url + route);
      report.privacyChecks.push({ route, status: response.status });
      if (response.status !== 403) throw new Error(`Protected path returned ${response.status}`);
    }
    browser = await chromium.launch({ headless: true, channel: "msedge" }).catch(() => chromium.launch({ headless: true }));
    report.browser = browser.version();
    for (const [name, width, height] of [["desktop", 1440, 900], ["tablet", 768, 1024], ["mobile", 390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
      const entry = { name, width, height, consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [] };
      page.on("console", message => { if (message.type() === "error") entry.consoleErrors.push(message.text()); });
      page.on("pageerror", error => entry.pageErrors.push(error.message));
      page.on("requestfailed", request => {
        const errorText = request.failure()?.errorText;
        // Chromium routinely cancels partially-buffered media downloads; real video failures are caught by the readyState checks.
        if (request.resourceType() === "media" && errorText === "net::ERR_ABORTED") return;
        entry.failedRequests.push({ url: request.url(), error: errorText });
      });
      page.on("response", response => { if (response.status() >= 400) entry.httpErrors.push({ url: response.url(), status: response.status() }); });
      await page.goto(url + "/index.html", { waitUntil: "networkidle" });
      await page.evaluate(() => document.fonts.ready);
      await page.evaluate(async () => {
        document.documentElement.style.scrollBehavior = "auto";
        for (let y = 0; y < document.documentElement.scrollHeight; y += innerHeight * 0.75) {
          scrollTo(0, y);
          await new Promise(resolve => setTimeout(resolve, 60));
        }
      });
      await page.waitForLoadState("networkidle");
      await page.evaluate(async () => {
        await Promise.all([...document.images].map(img => {
          if (img.complete) return;
          return new Promise(resolve => {
            img.addEventListener("load", resolve, { once: true });
            img.addEventListener("error", resolve, { once: true });
          });
        }));
        scrollTo(0, 0);
      });
      entry.videos = await page.evaluate(async () => Promise.all([...document.querySelectorAll("video")].map(video => new Promise(resolve => {
        const done = () => resolve({ src: video.currentSrc, readyState: video.readyState, duration: Math.round(video.duration * 10) / 10, width: video.videoWidth, height: video.videoHeight, poster: video.poster, error: video.error ? video.error.code : null });
        if (video.readyState >= 1 || video.error) return done();
        video.addEventListener("loadedmetadata", done, { once: true });
        video.addEventListener("error", done, { once: true });
        if (video.preload === "none") video.load();
        setTimeout(done, 10000);
      }))));
      Object.assign(entry, await page.evaluate(() => ({
        title: document.title,
        headings: [...document.querySelectorAll("h1,h2,h3")].map(el => ({ level: el.tagName, text: el.innerText.replace(/\s+/g, " ").trim() })),
        sectionIds: [...document.querySelectorAll("section[id],article[id]")].map(el => el.id),
        navTargets: [...document.querySelectorAll("nav a")].map(el => el.getAttribute("href")),
        brokenImages: [...document.images].filter(el => !el.complete || !el.naturalWidth).map(el => el.getAttribute("src")),
        videoErrors: [...document.querySelectorAll("video")].filter(el => el.error).map(el => ({ src: el.currentSrc, code: el.error.code })),
        horizontalOverflow: document.documentElement.scrollWidth > innerWidth,
        width: innerWidth, scrollWidth: document.documentElement.scrollWidth
      })));
      if (name !== "tablet") await page.screenshot({ path: path.join(output, `${name}-hero.png`) });
      await page.screenshot({ path: path.join(output, `${name}-full.png`), fullPage: true });

      const overflow = () => page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
      entry.gallery = { filters: {} };
      for (const group of ["music", "stage", "golf", "everyday", "all"]) {
        await page.locator(`.filter[data-filter="${group}"]`).click();
        entry.gallery.filters[group] = await page.evaluate(g => {
          const visible = [...document.querySelectorAll(".gallery-item")].filter(el => !el.hidden && el.offsetParent !== null);
          return { visible: visible.length, wrongGroup: visible.filter(el => g !== "all" && el.dataset.group !== g).length, overflow: document.documentElement.scrollWidth > innerWidth };
        }, group);
      }
      await page.locator('.filter[data-filter="golf"]').click();
      const firstGolf = page.locator('.gallery-item:not([hidden]) .gallery-button').first();
      await firstGolf.click();
      await page.waitForFunction(() => { const img = document.querySelector(".lightbox-media img"); return img && img.complete && img.naturalWidth > 0; }, null, { timeout: 10000 }).catch(() => {});
      entry.gallery.lightboxOpen = await page.evaluate(() => ({
        open: document.getElementById("lightbox").open,
        imageLoaded: !!document.querySelector(".lightbox-media img")?.naturalWidth,
        caption: document.querySelector(".lightbox-caption").textContent,
        count: document.querySelector(".lightbox-count").textContent,
        imageFits: (() => { const r = document.querySelector(".lightbox-media img")?.getBoundingClientRect(); return !!r && r.right <= innerWidth + 1 && r.bottom <= innerHeight + 1 && r.left >= -1 && r.top >= -1; })()
      }));
      entry.gallery.lightboxOverflow = await overflow();
      if (name !== "tablet") await page.screenshot({ path: path.join(output, `${name}-lightbox.png`) });
      await page.keyboard.press("ArrowRight");
      entry.gallery.afterArrowRight = await page.locator(".lightbox-count").textContent();
      await page.keyboard.press("ArrowLeft");
      entry.gallery.afterArrowLeft = await page.locator(".lightbox-count").textContent();
      await page.keyboard.press("Escape");
      entry.gallery.closedWithEscape = await page.waitForFunction(() => !document.getElementById("lightbox").open && !document.documentElement.classList.contains("lightbox-open"), null, { timeout: 3000 }).then(() => true, () => false);
      entry.gallery.focusReturned = await page.evaluate(() => document.activeElement?.classList.contains("gallery-button"));
      await page.locator('.filter[data-filter="music"]').click();
      await page.locator('.gallery-item:not([hidden]) .gallery-button.is-video').click();
      entry.gallery.lightboxVideo = await page.evaluate(() => new Promise(resolve => {
        const v = document.querySelector(".lightbox-media video");
        if (!v) return resolve({ present: false });
        const done = () => resolve({ present: true, readyState: v.readyState, error: v.error ? v.error.code : null });
        if (v.readyState >= 1) return done();
        v.addEventListener("loadedmetadata", done, { once: true });
        v.addEventListener("error", done, { once: true });
        setTimeout(done, 10000);
      }));
      await page.locator(".lightbox-close").click();
      entry.gallery.closedWithButton = await page.evaluate(() => !document.getElementById("lightbox").open);
      await page.locator('.filter[data-filter="all"]').click();
      entry.gallery.finalOverflow = await overflow();

      if (name === "mobile") {
        await page.evaluate(() => scrollTo(0, 0));
        await page.locator(".menu-toggle").click();
        await page.screenshot({ path: path.join(output, "mobile-menu.png") });
        await page.locator('#mobile-menu a[href="#golf"]').click();
        await page.waitForTimeout(400);
        entry.mobileMenuClosed = await page.locator("#mobile-menu").evaluate(el => el.hidden);
        entry.anchor = await page.locator("#golf").evaluate(el => ({
          top: el.getBoundingClientRect().top,
          headerBottom: document.querySelector(".site-header").getBoundingClientRect().bottom
        }));
      }
      report.viewports.push(entry);
      await page.close();
    }
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    const galleryFailed = g => !g || Object.values(g.filters).some(f => f.wrongGroup || f.overflow || !f.visible)
      || g.filters.all.visible !== 17 || !g.lightboxOpen.open || !g.lightboxOpen.imageLoaded || !g.lightboxOpen.imageFits
      || g.lightboxOverflow || g.afterArrowRight === g.lightboxOpen.count || g.afterArrowLeft !== g.lightboxOpen.count
      || !g.closedWithEscape || !g.focusReturned || !g.lightboxVideo.present || g.lightboxVideo.readyState < 1 || g.lightboxVideo.error
      || !g.closedWithButton || g.finalOverflow;
    const videoFailed = v => v.videos.length !== 2 || v.videos.some(x => x.error || x.readyState < 1 || !x.poster);
    const failed = report.viewports.some(v => v.horizontalOverflow || v.brokenImages.length || v.videoErrors.length || videoFailed(v) || galleryFailed(v.gallery) || v.consoleErrors.length || v.pageErrors.length || v.failedRequests.length || v.httpErrors.length || v.mobileMenuClosed === false || (v.anchor && v.anchor.top < v.anchor.headerBottom - 1));
    console.log(`Visual inspection complete: ${report.viewports.length} viewports; issues: ${failed ? "yes (see report)" : "none"}.`);
    if (failed) process.exitCode = 1;
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  inspect().catch(error => { console.error(error); process.exitCode = 1; });
}
