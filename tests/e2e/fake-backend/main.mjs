// Test only Electron entry. It opens a blank window with no preload, so a test can install
// the fake backend from fake-api.ts and then load the real built renderer.
import { BrowserWindow, app } from 'electron'

void app.whenReady().then(() => {
  const window = new BrowserWindow({ width: 1200, height: 800 })
  void window.loadURL('about:blank')
})
