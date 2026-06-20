const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Configurações
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),
  getSettings: () => ipcRenderer.invoke('get-settings'),

  // Ações do WhatsApp
  connectWhatsApp: () => ipcRenderer.send('whatsapp-connect'),
  disconnectWhatsApp: () => ipcRenderer.send('whatsapp-disconnect'),
  sendManualMessage: (jid, text, filePath) => ipcRenderer.invoke('whatsapp-send-message', jid, text, filePath),
  selectFile: () => ipcRenderer.invoke('select-file'),

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
  createAppointment: (data) => ipcRenderer.invoke('appointment-create', data),
  onAppointmentsUpdate: (callback) => ipcRenderer.on('appointments-update', (event, list) => callback(list)),

  // Sistema de Cobrança
  saveBilling: (billingData) => ipcRenderer.invoke('billing-save', billingData),
  deleteBilling: (id) => ipcRenderer.invoke('billing-delete', id),
  triggerBillingNow: (id) => ipcRenderer.invoke('billing-trigger-now', id),
  onBillingsUpdate: (callback) => ipcRenderer.on('billings-update', (event, list) => callback(list)),

  // Robô de Vendas (Fluxo Numérico)
  saveSalesNode: (nodeData) => ipcRenderer.invoke('sales-node-save', nodeData),
  deleteSalesNode: (id) => ipcRenderer.invoke('sales-node-delete', id),
  onSalesFlowUpdate: (callback) => ipcRenderer.on('sales-flow-update', (event, salesFlow) => callback(salesFlow)),

  // Debug / Logs de Erros do Renderer
  logError: (err) => ipcRenderer.send('log-error-to-main', err)
});
