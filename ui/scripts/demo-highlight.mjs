import { chromium } from "playwright";

const base = process.env.APP_URL || "http://localhost:5173";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node-model", { timeout: 15000 });

// Click model nodes until we land on one that has direct edges to highlight.
const nodes = page.locator(".react-flow__node-model");
let active = 0;
let dimmed = 0;
for (let i = 0; i < Math.min(await nodes.count(), 20); i++) {
  await nodes.nth(i).click({ force: true });
  await page.waitForTimeout(250);
  active = await page.locator(".react-flow__edge.active").count();
  dimmed = await page.locator(".react-flow__edge.dimmed").count();
  if (active > 0) break;
}
await page.screenshot({ path: "/tmp/demo-highlight.png" });
await browser.close();

console.log(`on click → active(in/out) edges=${active}, dimmed edges=${dimmed}`);
if (errors.length) {
  console.log("PAGE ERRORS:", errors.slice(0, 5));
  process.exit(1);
}
console.log(active > 0 && dimmed > 0 ? "OK: direct arrows highlighted, rest dimmed" : "WARN: no highlight observed");
