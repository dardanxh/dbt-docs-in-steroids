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

// Unselected: default LOC badges should render on model nodes (monospace chips).
const badgeCount = await page.locator(".react-flow__node-model .font-mono").count();
await page.screenshot({ path: "/tmp/demo-badges-loc.png" });

// Select a node -> its neighbours should show used/total fractions.
const nodes = page.locator(".react-flow__node-model");
let fractionSeen = false;
for (let i = 0; i < Math.min(await nodes.count(), 20) && !fractionSeen; i++) {
  await nodes.nth(i).click({ force: true });
  await page.waitForTimeout(500);
  const chips = await page.locator(".react-flow__node-model .font-mono").allInnerTexts();
  fractionSeen = chips.some((t) => /\d+\/\d+/.test(t));
  if (fractionSeen) {
    await page.screenshot({ path: "/tmp/demo-badges-fractions.png" });
    // NodePanel should show quality metrics.
    const hasQuality = (await page.getByText("Complexity", { exact: true }).count()) > 0;
    const hasCohesion = (await page.getByText("Cohesion", { exact: true }).count()) > 0;
    console.log(`panel quality metrics: complexity=${hasQuality} cohesion=${hasCohesion}`);
  }
}

await browser.close();
console.log(`default LOC badges rendered=${badgeCount} | neighbour fraction badges seen=${fractionSeen}`);
if (errors.length) {
  console.log("PAGE ERRORS:", errors.slice(0, 6));
  process.exit(1);
}
console.log(badgeCount > 0 && fractionSeen ? "OK: badges + fractions work" : "WARN: check badges");
