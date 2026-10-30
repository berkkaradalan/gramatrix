import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { GramatrixApi } from '@shared/rpc'

const api: GramatrixApi = {
  invoke: (method, params) => ipcRenderer.invoke('rpc', method, params),
  on: (event, listener) => {
    const channel = `event:${event}`
    const wrapped = (_: IpcRendererEvent, payload: Parameters<typeof listener>[0]): void =>
      listener(payload)
    ipcRenderer.on(channel, wrapped)
    return () => ipcRenderer.removeListener(channel, wrapped)
  }
}

contextBridge.exposeInMainWorld('gramatrix', api)
