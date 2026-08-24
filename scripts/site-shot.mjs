// Full-page screenshots of every site page for design review.
import puppeteer from "puppeteer-core";

const PAGES = ["index", "how-it-works", "demo", "evidence", "sources", "run"];
const browser = await puppeteer.launch({
  executablePath: "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  headless: "new",
  defaultViewport: { width: 1360, height: 900, deviceScaleFactor: 1.5 },
});
const page = await browser.newPage();

for (const name of PAGES) {
  await page.goto(`file:///C:/Users/Nabeel%20Uthman/adtc/docs/${name}.html`, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in")));
  await new Promise((r) => setTimeout(r, name === "demo" ? 9000 : 700));
  await page.screenshot({ path: `docs/screenshots/site-${name}.png`, fullPage: true });
  console.log(`site-${name}.png`);
}

await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1.5 });
await page.goto("file:///C:/Users/Nabeel%20Uthman/adtc/docs/index.html", { waitUntil: "networkidle0" });
await page.evaluate(() => document.querySelectorAll(".reveal").forEach((el) => el.classList.add("in")));
await new Promise((r) => setTimeout(r, 700));
await page.screenshot({ path: "docs/screenshots/site-index-mobile.png", fullPage: true });
console.log("site-index-mobile.png");

await browser.close();
