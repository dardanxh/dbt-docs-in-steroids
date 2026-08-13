import { chromium } from "playwright";

const base = process.env.APP_URL || "http://localhost:5173";
const errors = [];
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage();
page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

await page.goto(base, { waitUntil: "networkidle" });
// Wait for React Flow to render nodes.
await page.waitForSelector(".react-flow__node", { timeout: 15000 });
const nodeCount = await page.locator(".react-flow__node").count();
const edgeCount = await page.locator(".react-flow__edge").count();
console.log(`rendered react-flow nodes=${nodeCount} edges=${edgeCount}`);

// Open a model's detail panel: click a "model" node.
const firstModel = page.locator(".react-flow__node-model").first();
if (await firstModel.count()) {
  await firstModel.click();
  await page.waitForTimeout(500);
  const panel = await page.locator("aside").count();
  console.log(`node panel present=${panel > 0}`);
}
await page.screenshot({ path: "/tmp/dbtsteroids-lineage.png", fullPage: false });

// Switch to Analytics tab.
await page.getByText("Analytics", { exact: false }).first().click();
await page.waitForTimeout(1200);
await page.screenshot({ path: "/tmp/dbtsteroids-analytics.png", fullPage: false });

await browser.close();
if (errors.length) {
  console.log("CONSOLE ERRORS:");
  for (const e of errors.slice(0, 20)) console.log("  -", e);
  process.exit(1);
}
console.log("OK: no console errors");
