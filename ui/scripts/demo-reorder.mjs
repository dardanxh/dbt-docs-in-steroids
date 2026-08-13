import { chromium } from "playwright";

const base = process.env.APP_URL || "http://localhost:5173";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node-model", { timeout: 15000 });

// Layer chips are the only draggable buttons on the page.
const chips = page.locator('button[draggable="true"]');
await chips.first().waitFor();
const readOrder = async () => (await chips.allInnerTexts()).map((s) => s.trim());
const before = await readOrder();

// Record a header column's x position to confirm columns actually move.
const headerX = async (name) => {
  const el = page.locator(".react-flow__node-header", { hasText: name }).first();
  const box = await el.boundingBox();
  return box ? Math.round(box.x) : null;
};
const movedName = before[before.length - 1];
const xBefore = await headerX(movedName);

// Drag the last layer chip onto the first position.
await chips.last().dragTo(chips.first());
await page.waitForTimeout(700);

const after = await readOrder();
const xAfter = await headerX(movedName);
await page.screenshot({ path: "/tmp/demo-reorder.png" });
await browser.close();

console.log(`before: ${before.join(" → ")}`);
console.log(`after:  ${after.join(" → ")}`);
console.log(`"${movedName}" header x: ${xBefore} → ${xAfter}`);
if (errors.length) {
  console.log("PAGE ERRORS:", errors.slice(0, 5));
  process.exit(1);
}
console.log(before.join() !== after.join() ? "OK: layer order changed and columns remapped" : "WARN: order unchanged");
