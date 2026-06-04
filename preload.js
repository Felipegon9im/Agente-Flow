const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Configurações
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getSettings: () => ipcRenderer.invoke('get-settings'),

  // Ações do WhatsApp
  connectWhatsApp: () => ipcRenderer.send('whatsapp-connect'),
  disconnectWhatsApp: () => ipcRenderer.send('whatsapp-disconnect'),
  sendManualMessage: (jid, text) => ipcRenderer.invoke('whatsapp-send-message', jid, text),

  // Escuta de Eventos
  onWhatsAppStatus: (callback) => ipcRenderer.on('whatsapp-status', (event, status) => callback(status)),
  onWhatsAppQR: (callback) => ipcRenderer.on('whatsapp-qr', (event, qrBase64) => callback(qrBase64)),
  onLog: (callback) => ipcRenderer.on('log-message', (event, log) => callback(log)),
  onStats: (callback) => ipcRenderer.on('stats-update', (event, stats) => callback(stats)),

  // Requisição de Estado Atual
  requestStatus: () => ipcRenderer.send('request-whatsapp-status'),
  requestStats: () => ipcRenderer.send('request-stats')
});
