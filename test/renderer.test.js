const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");

process.env.OLLAMA_URL = "http://127.0.0.1:1";
const { startInsightServer } = require("../insight-server");

const EDGE_PATH = "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe";
const TRANSCRIPT = "The rollout stalled because onboarding requires three approvals before a team can begin. Leaders want ownership defined before the next launch, even though the guide made setup clearer.";

test("renderer imports a transcript and renders evidence-backed fallback analysis", { timeout: 60000 }, async () => {
  const transcriptsDir = await fs.mkdtemp(path.join(os.tmpdir(), "localgist-renderer-"));
  const handle = await startInsightServer({ transcriptsDir, port: 0 });
  let browser;

  try {
    assert.equal((await fetch(handle.url)).status, 200);
    browser = await chromium.launch({ headless: true, executablePath: EDGE_PATH, args: ["--no-proxy-server", "--disable-gpu"], timeout: 15000 });
    const page = await browser.newPage({ viewport: { width: 1280, height: 820 } });
    await page.goto(handle.url, { waitUntil: "domcontentloaded" });
    await page.locator("#sourceList").waitFor({ state: "visible" });
    await page.setInputFiles("#fileInput", { name: "pilot.txt", mimeType: "text/plain", buffer: Buffer.from(TRANSCRIPT) });
    await page.locator("#questionInput").fill("What blocks rollout?");
    await page.locator("#analyzeButton").click();
    await page.locator("#results").waitFor({ state: "visible" });
    await page.screenshot({ path: path.join(os.tmpdir(), "localgist-renderer.png"), fullPage: true });

    assert.match(await page.locator("#overview").innerText(), /rollout/i);
    assert.ok(await page.locator(".finding").count());
    assert.equal(await page.locator(".source.selected").count(), 1);
  } finally {
    if (browser) await browser.close();
    await new Promise((resolve) => handle.server.close(resolve));
    await fs.rm(transcriptsDir, { recursive: true, force: true });
  }
});
