import http from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, ".inspection");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".mov": "video/quicktime" };

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
      res.writeHead(200, { "Content-Type": types[path.extname(realFile).toLowerCase()] || "application/octet-stream", "Cache-Control": "no-store" }).end(bytes);
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
    browser = await chromium.launch({ headless: true });
    for (const [name, width, height] of [["desktop", 1440, 900], ["tablet", 768, 1024], ["mobile", 390, 844]]) {
      const page = await browser.newPage({ viewport: { width, height }, reducedMotion: "reduce" });
      const entry = { name, width, height, consoleErrors: [], pageErrors: [], failedRequests: [], httpErrors: [] };
      page.on("console", message => { if (message.type() === "error") entry.consoleErrors.push(message.text()); });
      page.on("pageerror", error => entry.pageErrors.push(error.message));
      page.on("requestfailed", request => entry.failedRequests.push({ url: request.url(), error: request.failure()?.errorText }));
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
      if (name === "mobile") {
        await page.locator(".mobile-nav summary").click();
        await page.locator('.mobile-nav-links a[href="#mastery"]').click();
        entry.mobileMenuClosed = await page.locator(".mobile-nav").evaluate(el => !el.open);
        entry.anchor = await page.locator("#mastery").evaluate(el => ({
          top: el.getBoundingClientRect().top,
          headerBottom: document.querySelector(".site-header").getBoundingClientRect().bottom
        }));
      }
      report.viewports.push(entry);
      await page.close();
    }
    await fs.writeFile(path.join(output, "report.json"), JSON.stringify(report, null, 2));
    const failed = report.viewports.some(v => v.horizontalOverflow || v.brokenImages.length || v.videoErrors.length || v.consoleErrors.length || v.pageErrors.length || v.failedRequests.length || v.httpErrors.length || v.mobileMenuClosed === false || (v.anchor && v.anchor.top < v.anchor.headerBottom));
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
