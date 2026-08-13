import { chromium } from "playwright";

const base = process.env.APP_URL || "http://localhost:5173";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node-model", { timeout: 15000 });

const before = await page.locator(".react-flow__node-model").count();

// Right-click a model node → context menu should appear.
await page.locator(".react-flow__node-model").first().click({ button: "right", force: true });
await page.waitForTimeout(300);
const menuVisible = await page.getByText("View columns & details").count();
await page.screenshot({ path: "/tmp/demo-context-menu.png" });

// Click "Focus lineage" in the menu.
await page.getByText("Focus lineage").first().click();
await page.waitForTimeout(900);
const after = await page.locator(".react-flow__node-model").count();
const focused = await page.locator("text=Focused on").count();

// Now right-click another node and open its columns panel.
await page.locator(".react-flow__node-model").first().click({ button: "right", force: true });
await page.waitForTimeout(250);
await page.getByText("View columns & details").first().click();
await page.waitForTimeout(400);
const panel = await page.locator("aside").count();
await page.screenshot({ path: "/tmp/demo-context-after.png" });

await browser.close();
console.log(`menu appeared=${menuVisible > 0} | focus: ${before}→${after} nodes, banner=${focused > 0} | panel opened=${panel > 0}`);
if (errors.length) {
  console.log("PAGE ERRORS:", errors.slice(0, 5));
  process.exit(1);
}
console.log("OK");
