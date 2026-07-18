const fs = require("node:fs/promises");
const path = require("node:path");
const { app, BrowserWindow, dialog, ipcMain, Menu, shell } = require("electron");
const { startInsightServer } = require("./insight-server");

const PRODUCT_NAME = "LocalGist";
const MAX_IMPORT_BYTES = 1024 * 1024;
let mainWindow;
let serverHandle;
let transcriptsDir;

function getDevelopmentTranscriptsDir() {
  return path.join(__dirname, "transcripts");
}

async function readTranscriptFiles(filePaths) {
  const documents = [];
  const skipped = [];

  for (const filePath of filePaths) {
    const extension = path.extname(filePath).toLowerCase();
    try {
      const stat = await fs.stat(filePath);
      if (![".txt", ".md"].includes(extension) || stat.size > MAX_IMPORT_BYTES) {
        skipped.push(path.basename(filePath));
        continue;
      }
      documents.push({
        id: `${path.basename(filePath)}-${stat.mtimeMs}`,
        title: path.basename(filePath, extension),
        content: await fs.readFile(filePath, "utf8"),
        bytes: stat.size
      });
    } catch (error) {
      skipped.push(path.basename(filePath));
    }
  }

  return { documents, skipped };
}

async function chooseTranscriptFiles() {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: "Add transcripts to LocalGist",
    filters: [{ name: "Transcript files", extensions: ["txt", "md"] }],
    properties: ["openFile", "multiSelections"]
  });
  if (result.canceled) return { documents: [], skipped: [] };
  return readTranscriptFiles(result.filePaths);
}

function createMainWindow(url) {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 940,
    minHeight: 650,
    show: false,
    backgroundColor: "#f8f8f5",
    title: PRODUCT_NAME,
    webPreferences: {
      preload: path.join(__dirname, "electron-preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  mainWindow.once("ready-to-show", () => mainWindow.show());
  mainWindow.loadURL(url);
  mainWindow.webContents.setWindowOpenHandler(({ url: externalUrl }) => {
    if (externalUrl.startsWith("https:")) shell.openExternal(externalUrl);
    return { action: "deny" };
  });
}

function createMenu() {
  return Menu.buildFromTemplate([
    {
      label: PRODUCT_NAME,
      submenu: [
        { label: "About LocalGist", role: "about" },
        { type: "separator" },
        { label: "Quit", role: "quit" }
      ]
    },
    {
      label: "File",
      submenu: [
        { label: "Add transcripts...", accelerator: "CmdOrCtrl+O", click: async () => mainWindow.webContents.send("transcripts:import", await chooseTranscriptFiles()) },
        { label: "Open transcript folder", click: () => shell.openPath(transcriptsDir) },
        { type: "separator" },
        { label: "Close window", role: "close" }
      ]
    },
    {
      label: "View",
      submenu: [{ role: "reload" }, { role: "toggleDevTools" }, { type: "separator" }, { role: "resetZoom" }, { role: "zoomIn" }, { role: "zoomOut" }, { type: "separator" }, { role: "togglefullscreen" }]
    }
  ]);
}

async function startDesktopApp() {
  app.setName(PRODUCT_NAME);
  transcriptsDir = app.isPackaged ? path.join(app.getPath("userData"), "transcripts") : getDevelopmentTranscriptsDir();
  await fs.mkdir(transcriptsDir, { recursive: true });
  serverHandle = await startInsightServer({ transcriptsDir, publicDir: path.join(__dirname, "insights-public"), port: 0 });

  ipcMain.handle("transcripts:choose", chooseTranscriptFiles);
  ipcMain.handle("transcripts:open-folder", () => shell.openPath(transcriptsDir));
  Menu.setApplicationMenu(createMenu());
  createMainWindow(serverHandle.url);
}

app.whenReady().then(startDesktopApp).catch((error) => {
  console.error("LocalGist failed to start:", error);
  dialog.showErrorBox("LocalGist could not start", error.stack || error.message);
  app.quit();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  if (serverHandle) serverHandle.server.close();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0 && serverHandle) createMainWindow(serverHandle.url);
});
