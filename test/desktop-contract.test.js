const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");

const ROOT = path.join(__dirname, "..");

test("desktop package declares a secure LocalGist Electron shell", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const mainProcess = fs.readFileSync(path.join(ROOT, "electron-main.js"), "utf8");
  const preload = fs.readFileSync(path.join(ROOT, "electron-preload.js"), "utf8");

  assert.equal(manifest.name, "localgist");
  assert.equal(manifest.main, "electron-main.js");
  assert.match(manifest.scripts.desktop, /electron/);
  assert.equal(manifest.build.productName, "LocalGist");
  assert.equal(manifest.build.win.target[0].target, "nsis");
  assert.match(mainProcess, /contextIsolation:\s*true/);
  assert.match(mainProcess, /nodeIntegration:\s*false/);
  assert.match(mainProcess, /sandbox:\s*true/);
  assert.match(preload, /contextBridge\.exposeInMainWorld/);
});
