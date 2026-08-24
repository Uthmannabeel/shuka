// Full-page screenshots of the landing page (docs/index.html) for design review.
import puppeteer from "puppeteer-core";

const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  defaultViewport: { width: 1360, height: 900, deviceScaleFactor: 1.5 },
});
const page = await browser.newPage();
await page.goto("file:///C:/Users/Nabeel%20Uthman/adtc/docs/index.html", { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 800));
await page.screenshot({ path: "docs/screenshots/site-desktop.png", fullPage: true });
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1.5 });
await new Promise((r) => setTimeout(r, 500));
await page.screenshot({ path: "docs/screenshots/site-mobile.png", fullPage: true });
await browser.close();
console.log("done");
