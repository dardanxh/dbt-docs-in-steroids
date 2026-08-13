import { chromium } from "playwright";

const base = process.env.APP_URL || "http://localhost:5173";
const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => localStorage.removeItem("dbtsteroids-settings"));
await page.goto(base, { waitUntil: "networkidle" });
await page.waitForSelector(".react-flow__node-model", { timeout: 15000 });

const themeOf = () => page.evaluate(() => document.documentElement.dataset.theme);
const defaultTheme = await themeOf();

// Toggle to light.
await page.locator('header button[title^="Switch"]').click();
await page.waitForTimeout(400);
const afterToggle = await themeOf();
await page.screenshot({ path: "/tmp/demo-light.png" });

// Sidebar → Projects.
await page.locator('nav button[title="Projects"]').click();
await page.waitForTimeout(500);
const projectsHeading = await page.getByText("Register a dbt project").count();
await page.screenshot({ path: "/tmp/demo-projects.png" });

// Sidebar → Settings.
await page.locator('nav button[title="Settings"]').click();
await page.waitForTimeout(300);
const settingsHeading = await page.getByRole("heading", { name: "Settings" }).count();

// Back to dark + Lineage.
await page.locator('header button[title^="Switch"]').click();
await page.waitForTimeout(300);
const backTheme = await themeOf();

await browser.close();
console.log(`theme: default=${defaultTheme} afterToggle=${afterToggle} back=${backTheme}`);
console.log(`projects page=${projectsHeading > 0} settings page=${settingsHeading > 0}`);
if (errors.length) {
  console.log("PAGE ERRORS:", errors.slice(0, 6));
  process.exit(1);
}
console.log(
  defaultTheme === "dark" && afterToggle === "light" && projectsHeading > 0 && settingsHeading > 0
    ? "OK: theme toggle + sidebar nav + projects/settings work"
    : "WARN: something off",
);
