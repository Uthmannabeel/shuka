// Screenshots of the Shuka web UI via installed Edge (headless, CDP).
// Usage: node shot.mjs <outDir>
import puppeteer from "puppeteer-core";

const outDir = process.argv[2] ?? ".";
const EDGE = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const BASE = "http://127.0.0.1:4180";

const browser = await puppeteer.launch({
  executablePath: EDGE,
  headless: "new",
  args: ["--window-size=1360,940"],
  defaultViewport: { width: 1360, height: 940, deviceScaleFactor: 2 },
});
const page = await browser.newPage();

// 1. empty state
await page.goto(BASE, { waitUntil: "networkidle2" });
await page.screenshot({ path: `${outDir}/ui-empty.png` });
console.log("saved ui-empty.png");

// 2. grounded answer (waits for the stamp)
await page.goto(
  `${BASE}/?q=${encodeURIComponent("My maize leaves have ragged holes and there are caterpillars in the whorl. What pest is this and how do I control it?")}`,
  { waitUntil: "domcontentloaded" }
);
await page.waitForSelector("#stamp:not([hidden])", { timeout: 240_000 });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${outDir}/ui-answer.png` });
console.log("saved ui-answer.png");

// 3. refusal (out-of-scope question)
await page.goto(
  `${BASE}/?q=${encodeURIComponent("My chickens are sneezing and have swollen eyes. What medicine should I give them?")}`,
  { waitUntil: "domcontentloaded" }
);
await page.waitForSelector("#stamp:not([hidden])", { timeout: 120_000 });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${outDir}/ui-refusal.png` });
console.log("saved ui-refusal.png");

// 4. mobile width, grounded answer
await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });
await page.goto(
  `${BASE}/?q=${encodeURIComponent("How do I select and prepare cassava stem cuttings for planting?")}`,
  { waitUntil: "domcontentloaded" }
);
await page.waitForSelector("#stamp:not([hidden])", { timeout: 240_000 });
await new Promise((r) => setTimeout(r, 600));
await page.screenshot({ path: `${outDir}/ui-mobile.png`, fullPage: true });
console.log("saved ui-mobile.png");

await browser.close();
