import { chromium } from "playwright";

const base = process.env.APP_URL || "http://localhost:5173";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.removeItem("dbtsteroids-settings"));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node-model", { timeout: 15000 });
await page.waitForTimeout(600);

// Toolbar should be inside the right <nav> (sidebar), not floating over the canvas.
const toolbarInSidebar = await page.locator("nav >> text=Graph controls").count();
const colorByInSidebar = await page.locator("nav >> text=Color by").count();
await page.screenshot({ path: "/tmp/demo-sidebar-toolbar.png" });

// Two-finger trackpad pan = wheel event; the viewport transform should change.
const transformBefore = await page.locator(".react-flow__viewport").getAttribute("style");
const box = await page.locator(".react-flow__pane").boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, 250); // two-finger scroll down
await page.waitForTimeout(400);
const transformAfter = await page.locator(".react-flow__viewport").getAttribute("style");
const panned = transformBefore !== transformAfter;

await browser.close();
console.log(`toolbar docked in sidebar: graphControls=${toolbarInSidebar > 0} colorBy=${colorByInSidebar > 0}`);
console.log(`two-finger scroll panned canvas: ${panned}`);
if (errors.length) {
  console.log("PAGE ERRORS:", errors.slice(0, 6));
  process.exit(1);
}
console.log(toolbarInSidebar > 0 && panned ? "OK: toolbar in sidebar + trackpad pan works" : "WARN");
