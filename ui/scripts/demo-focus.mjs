import { chromium } from "playwright";

const base = process.env.APP_URL || "http://localhost:5173";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node-model", { timeout: 15000 });

const before = await page.locator(".react-flow__node-model").count();

// Open a model node that has upstream/downstream, then click the Focus button.
const nodes = page.locator(".react-flow__node-model");
let focused = false;
for (let i = 0; i < Math.min(await nodes.count(), 30) && !focused; i++) {
  await nodes.nth(i).click({ force: true });
  await page.waitForSelector("aside", { timeout: 5000 }).catch(() => {});
  const focusBtn = page.locator('aside button[title^="Focus"]');
  if (await focusBtn.count()) {
    await focusBtn.click();
    await page.waitForTimeout(1000);
    focused = true;
  }
}
const after = await page.locator(".react-flow__node-model").count();
const banner = await page.locator("text=Focused on").count();
await page.screenshot({ path: "/tmp/demo-focus.png" });
await browser.close();

console.log(`model nodes before focus=${before}, after focus=${after}, focus banner=${banner > 0}`);
if (errors.length) {
  console.log("PAGE ERRORS:", errors.slice(0, 5));
  process.exit(1);
}
console.log(after < before && banner > 0 ? "OK: focus isolates the subgraph" : "WARN: focus did not reduce nodes");
