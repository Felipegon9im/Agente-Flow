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
  requestStats: () => ipcRenderer.send('request-stats'),

  // Agendador de Mensagens
  saveSchedule: (scheduleData) => ipcRenderer.invoke('schedule-save', scheduleData),
  toggleSchedule: (id, enabled) => ipcRenderer.invoke('schedule-toggle', id, enabled),
  triggerScheduleNow: (id) => ipcRenderer.invoke('schedule-trigger-now', id),
  deleteSchedule: (id) => ipcRenderer.invoke('schedule-delete', id),
  onSchedulesUpdate: (callback) => ipcRenderer.on('schedules-update', (event, list) => callback(list)),

  // Agenda / Consultas por IA
  cancelAppointment: (id) => ipcRenderer.invoke('appointment-cancel', id),
  deleteAppointment: (id) => ipcRenderer.invoke('appointment-delete', id),
  onAppointmentsUpdate: (callback) => ipcRenderer.on('appointments-update', (event, list) => callback(list))
});
