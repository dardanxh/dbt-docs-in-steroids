import { chromium } from "playwright";

const base = process.env.APP_URL || "http://localhost:5173";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
// Force the dwh project (has real layers) so we get expanded model nodes.
await page.addInitScript(() => localStorage.removeItem("dbtsteroids-settings"));
await page.goto(base, { waitUntil: "networkidle" });
const projects = await page.evaluate(() => fetch("/api/v1/projects/").then((r) => r.json()));
const dwh = projects.find((p) => p.name === "dwh") ?? projects[0];
await page.goto(`${base}?project=${dwh.id}&view=lineage`, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node-model", { timeout: 15000 });
await page.waitForTimeout(500);

const nodeCount = () => page.locator(".react-flow__node-model").count();
const allNodes = await nodeCount();

// Right-click a model → "Focus in new tab".
await page.locator(".react-flow__node-model").first().click({ button: "right", force: true });
await page.waitForTimeout(300);
await page.getByText("Focus in new tab").click();
await page.waitForTimeout(900);

// A tab bar should appear with an "All" tab + the focus tab; canvas shows fewer nodes.
const tabBarAll = await page.getByRole("button", { name: "All" }).count();
const focusNodes = await nodeCount();
await page.screenshot({ path: "/tmp/demo-tabs-focus.png" });

// Switch back to All → full graph.
await page.getByRole("button", { name: "All" }).first().click();
await page.waitForTimeout(700);
const backToAll = await nodeCount();

// Close the focus tab (X). After closing, tab bar should disappear (only All left).
await page.locator('div:has-text("All") button[title="Close tab"]').first().click().catch(async () => {
  await page.locator('button[title="Close tab"]').first().click();
});
await page.waitForTimeout(400);
const closeButtons = await page.locator('button[title="Close tab"]').count();

await browser.close();
console.log(
  JSON.stringify({ allNodes, focusNodes, backToAll, tabBarAll, tabsAfterClose: closeButtons }, null, 2),
);
if (errors.length) {
  console.log("PAGE ERRORS:", errors.slice(0, 6));
  process.exit(1);
}
const ok = tabBarAll > 0 && focusNodes < allNodes && backToAll === allNodes && closeButtons === 0;
console.log(ok ? "OK: focus opens a closeable subgraph tab; All stays intact" : "WARN: check output");
