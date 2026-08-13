import { chromium } from "playwright";

const base = process.env.APP_URL || "http://localhost:5173";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.removeItem("dbtsteroids-settings"));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node-model", { timeout: 15000 });
await page.waitForTimeout(500);

const out = {};

// Pick 5: minimap present.
out.minimap = (await page.locator(".react-flow__minimap").count()) > 0;

// Pick 3: search/filter bar dims non-matches.
await page.getByPlaceholder("Search models…").fill("bill");
await page.waitForTimeout(500);
out.searchDims = (await page.locator(".react-flow__node.opacity-25, .react-flow__node-model.opacity-25").count()) > 0;
out.matchLabel = (await page.getByText(/\d+ match/).count()) > 0;
await page.getByPlaceholder("Search models…").fill("");
await page.waitForTimeout(300);

// Pick 1: Cmd-K palette opens, type, Enter selects a node.
await page.keyboard.press("Meta+k");
await page.waitForTimeout(300);
out.paletteOpen = (await page.getByPlaceholder("Search models, sources, seeds…").count()) > 0;
await page.getByPlaceholder("Search models, sources, seeds…").fill("merchant");
await page.waitForTimeout(300);
await page.keyboard.press("Enter");
await page.waitForTimeout(600);
out.paletteSelected = (await page.locator("aside").count()) > 0; // node panel opened

// Pick 2: SQL viewer in the panel.
const sqlToggle = page.getByRole("button", { name: /^SQL/ });
out.sqlSection = (await sqlToggle.count()) > 0;
if (out.sqlSection) {
  await sqlToggle.click();
  await page.waitForTimeout(300);
  out.sqlHighlighted = (await page.locator("aside pre span").count()) > 0;
}
await page.screenshot({ path: "/tmp/demo-picks-lineage.png" });

// Pick 4: Quality view via sidebar; sortable table with rows; row opens node.
await page.locator('nav button[title="Quality"]').click();
await page.waitForTimeout(500);
out.qualityRows = await page.locator("table tbody tr").count();
await page.screenshot({ path: "/tmp/demo-picks-quality.png" });
await page.locator("table tbody tr").first().click();
await page.waitForTimeout(500);
out.qualityOpensLineage = (await page.locator(".react-flow__node-model").count()) > 0;

await browser.close();
console.log(JSON.stringify(out, null, 2));
if (errors.length) {
  console.log("PAGE ERRORS:", errors.slice(0, 8));
  process.exit(1);
}
const ok =
  out.minimap && out.searchDims && out.paletteOpen && out.paletteSelected && out.sqlSection && out.qualityRows > 0;
console.log(ok ? "OK: all picks working" : "WARN: check output");
