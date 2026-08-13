import { chromium } from "playwright";

const base = process.env.APP_URL || "http://localhost:5173";
const target = process.env.MODEL || "mcc"; // model name to open
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node-model", { timeout: 15000 });

// 1) default lineage view
await page.screenshot({ path: "/tmp/demo-1-lineage.png" });

// 2) open models until one exposes a traceable column, then trace it.
const nodes = page.locator(".react-flow__node-model");
const total = await nodes.count();
console.log(`model nodes in DOM: ${total} (looking for one with column lineage, e.g. ${target})`);
let traced = false;
for (let i = 0; i < Math.min(total, 40) && !traced; i++) {
  const n = nodes.nth(i);
  await n.click({ force: true });
  await page.waitForSelector("aside", { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(150);
  const col = page.locator('aside button[title="Trace this column"]:not([disabled])').first();
  if (await col.count()) {
    await page.screenshot({ path: "/tmp/demo-2-node-panel.png" });
    const label = (await col.innerText()).split("\n")[0];
    await col.click();
    await page.waitForTimeout(1000);
    await page.screenshot({ path: "/tmp/demo-3-column-trace.png" });
    console.log(`opened node #${i}, traced column: ${label}`);
    traced = true;
  }
}
if (!traced) console.log("no traceable column found in first 40 model nodes");

await browser.close();
console.log("done");
