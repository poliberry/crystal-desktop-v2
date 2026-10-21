// Main process for `scripts/render-cosmetics.mjs`: one hidden window running scripts/cosmetics/render-entry.ts.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("node:path");

const [page, job] = process.argv.slice(-2);
app.commandLine.appendSwitch("disable-renderer-backgrounding");
app.commandLine.appendSwitch("disable-background-timer-throttling");
app.dock?.hide();

app.whenReady().then(() => {
  const win = new BrowserWindow({
    show: false,
    width: 400,
    height: 300,
    webPreferences: { nodeIntegration: true, contextIsolation: false, backgroundThrottling: false, sandbox: false },
  });
  ipcMain.on("log", (_e, line) => console.log(line));
  ipcMain.on("done", (_e, json) => {
    process.stdout.write(`\n@@RESULT@@${json}\n`);
    app.exit(0);
  });
  ipcMain.on("fail", (_e, message) => {
    console.error(message);
    app.exit(1);
  });
  win.webContents.on("console-message", (_e, _level, message) => console.log(`[page] ${message}`));
  win.webContents.on("render-process-gone", (_e, d) => {
    console.error("renderer gone", d);
    app.exit(1);
  });
  win.loadFile(path.resolve(page), { hash: job });
});
