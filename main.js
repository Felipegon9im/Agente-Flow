const { app, BrowserWindow, ipcMain, Tray, Menu } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const QRCode = require('qrcode');
const { GoogleGenAI } = require('@google/genai');

// --- Logger de travamento/erros globais ---
process.on('uncaughtException', (err) => {
  try {
    fs.appendFileSync('c:\\Users\\Felipe Gondim\\HUB_Projetos\\Agente\\app_debug.log', `[${new Date().toLocaleTimeString()}] [UNCAUGHT EXCEPTION] ${err.stack || err}\n`);
  } catch (e) {}
});

process.on('unhandledRejection', (reason, promise) => {
  try {
    fs.appendFileSync('c:\\Users\\Felipe Gondim\\HUB_Projetos\\Agente\\app_debug.log', `[${new Date().toLocaleTimeString()}] [UNHANDLED REJECTION] ${reason.stack || reason}\n`);
  } catch (e) {}
});

// --- Globais ---
let mainWindow = null;
let sock = null;
let connectionStatus = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'qr'
let currentQR = '';
let settings = null;
let tray = null;
app.isQuitting = false;

function translateWhatsAppStatus(status) {
  switch (status) {
    case 'connected': return 'Conectado';
    case 'connecting': return 'Conectando...';
    case 'qr': return 'Aguardando Login (QR)';
    case 'disconnected': return 'Desconectado';
    default: return status;
  }
}

function updateTrayStatus(status) {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    { label: 'ZapFlow AI', enabled: false },
    { label: `WhatsApp: ${translateWhatsAppStatus(status)}`, enabled: false },
    { type: 'separator' },
    { label: 'Abrir Painel', click: () => {
        if (mainWindow) {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    },
    { label: 'Sair', click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  tray.setContextMenu(contextMenu);
}

function setConnectionStatus(status) {
  connectionStatus = status;
  updateTrayStatus(status);
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('whatsapp-status', status);
  }
}

function createTray() {
  try {
    const iconPath = path.join(__dirname, 'icon.png');
    if (!fs.existsSync(iconPath)) {
      logToUI('SYSTEM', `Aviso: icon.png não encontrado para a bandeja do sistema.`);
      return;
    }
    tray = new Tray(iconPath);
    
    tray.setToolTip('ZapFlow AI - WhatsApp Agent');
    updateTrayStatus(connectionStatus);
    
    tray.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isVisible()) {
          mainWindow.hide();
        } else {
          mainWindow.show();
          mainWindow.focus();
        }
      }
    });
  } catch (err) {
    logToUI('SYSTEM', `Erro ao criar ícone de bandeja: ${err.message}`);
  }
}
let expressServer = null;

// Estatísticas
const stats = {
  totalReceived: 0,
  totalSent: 0,
  aiResponses: 0,
  n8nCalls: 0
};

// Histórico de conversas (para manter contexto da IA)
const chatHistories = new Map();

// Caminhos locais
const settingsPath = path.join(app.getPath('userData'), 'settings.json');
const authFolder = path.join(app.getPath('userData'), 'baileys_auth');

// --- Logger para UI ---
function logToUI(type, message) {
  const time = new Date().toLocaleTimeString();
  const logLine = `[${time}] [${type}] ${message}\n`;
  console.log(`[${type}] ${message}`);
  try {
    fs.appendFileSync('c:\\Users\\Felipe Gondim\\HUB_Projetos\\Agente\\app_debug.log', logLine);
  } catch (err) {}
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('log-message', { time, type, message });
  }
}

function broadcastStats() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('stats-update', stats);
  }
}

// --- Carregar/Salvar Configurações ---
function loadSettings() {
  const defaultSettings = {
    geminiApiKey: '',
    geminiModel: 'gemini-2.0-flash',
    systemPrompt: 'Você é um assistente virtual inteligente e prestativo para atendimento ao cliente no WhatsApp. Responda de forma curta, objetiva, profissional e amigável. Para agendamentos, você possui ferramentas para ver os horários disponíveis (ver_horarios_disponiveis) e para confirmar a reserva (confirmar_agendamento) quando o cliente escolher. Sempre pergunte o nome do cliente antes de confirmar.',
    temperature: 0.7,
    n8nTools: [],
    expressPort: 3003,
    aiEnabled: true,
    scheduledMessages: [],
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    slotDuration: 60,
    appointments: []
  };

  try {
    if (fs.existsSync(settingsPath)) {
      const raw = fs.readFileSync(settingsPath, 'utf-8');
      settings = JSON.parse(raw);
      // Garantir chaves default caso estejam ausentes
      settings = { ...defaultSettings, ...settings };
    } else {
      settings = defaultSettings;
      fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    }
  } catch (err) {
    console.error('Erro ao ler configurações:', err);
    settings = defaultSettings;
  }
  return settings;
}

function saveSettings(newSettings) {
  try {
    settings = { ...settings, ...newSettings };
    fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
    logToUI('SYSTEM', 'Configurações salvas localmente.');
    
    // Reiniciar Express se a porta mudou
    if (newSettings.expressPort && newSettings.expressPort !== settings.expressPort) {
      startExpressServer(newSettings.expressPort);
    }
    return true;
  } catch (err) {
    logToUI('SYSTEM', `Erro ao salvar configurações: ${err.message}`);
    return false;
  }
}

// --- Servidor Express Local (N8N -> WhatsApp) ---
function startExpressServer(port) {
  if (expressServer) {
    expressServer.close(() => {
      logToUI('SYSTEM', 'Servidor Express anterior encerrado.');
    });
  }

  const appExpress = express();
  appExpress.use(cors());
  appExpress.use(express.json());

  // Rota para envio de mensagens
  appExpress.post('/send-message', async (req, res) => {
    const { phone, message } = req.body;
    if (!phone || !message) {
      return res.status(400).json({ error: 'Parâmetros "phone" e "message" são obrigatórios.' });
    }

    if (connectionStatus !== 'connected' || !sock) {
      return res.status(503).json({ error: 'O WhatsApp não está conectado no aplicativo.' });
    }

    try {
      // Limpar número
      let jid = phone;
      if (!jid.includes('@')) {
        const cleanPhone = jid.replace(/\D/g, '');
        jid = `${cleanPhone}@s.whatsapp.net`;
      }

      logToUI('N8N', `N8N solicitou envio de mensagem para ${jid}`);
      await sock.sendMessage(jid, { text: message });
      
      stats.totalSent++;
      broadcastStats();
      
      return res.json({ success: true, message: 'Mensagem enviada com sucesso!' });
    } catch (err) {
      logToUI('SYSTEM', `Erro ao processar envio do N8N: ${err.message}`);
      return res.status(500).json({ error: err.message });
    }
  });

  const targetPort = port || settings.expressPort || 3003;
  expressServer = appExpress.listen(targetPort, () => {
    logToUI('SYSTEM', `Servidor Express rodando com sucesso na porta ${targetPort}`);
  }).on('error', (err) => {
    logToUI('SYSTEM', `Falha ao iniciar Servidor Express na porta ${targetPort}: ${err.message}`);
  });
}

// --- Conexão WhatsApp (Baileys) ---
async function startWhatsAppConnection() {
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
  
  if (sock) {
    logToUI('WHATSAPP', 'WhatsApp já está inicializado.');
    return;
  }

  logToUI('WHATSAPP', 'Iniciando conexão...');
  setConnectionStatus('connecting');

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    sock = makeWASocket({
      auth: state,
      logger: pino({ level: 'silent' }),
      printQRInTerminal: false,
      browser: ['ZapFlow AI', 'Windows', '1.0.0']
    });

    // Atualizar Credenciais ao mudar
    sock.ev.on('creds.update', saveCreds);

    // Monitorar Conexão
    sock.ev.on('connection.update', async (update) => {
      const { connection, lastDisconnect, qr } = update;

      if (qr) {
        setConnectionStatus('qr');
        try {
          currentQR = await QRCode.toDataURL(qr);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('whatsapp-qr', currentQR);
          }
          logToUI('WHATSAPP', 'Novo QR Code gerado. Aguardando escaneamento...');
        } catch (err) {
          logToUI('SYSTEM', `Erro ao gerar QRCode Base64: ${err.message}`);
        }
      }

      if (connection === 'connecting') {
        setConnectionStatus('connecting');
        logToUI('WHATSAPP', 'Conectando...');
      }

      if (connection === 'open') {
        setConnectionStatus('connected');
        currentQR = '';
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('whatsapp-qr', '');
        }
        logToUI('WHATSAPP', `Conectado com sucesso! Usuário logado: ${sock.user.name || sock.user.id}`);
        checkScheduledMessages();
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut && statusCode !== DisconnectReason.connectionReplaced;

        logToUI('WHATSAPP', `Conexão fechada. Código: ${statusCode}. Tentando reconectar? ${shouldReconnect ? 'Sim' : 'Não'}`);

        sock = null;
        currentQR = '';

        if (shouldReconnect) {
          setConnectionStatus('connecting');
          // Reconectar após um pequeno atraso
          setTimeout(() => startWhatsAppConnection(), 5000);
        } else {
          setConnectionStatus('disconnected');
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('whatsapp-qr', '');
          }
          if (statusCode === DisconnectReason.loggedOut) {
            // Deletar pasta de credenciais apenas se deslogado explicitamente
            try {
              fs.rmSync(authFolder, { recursive: true, force: true });
              logToUI('WHATSAPP', 'Sessão encerrada e arquivos locais limpos.');
            } catch (err) {
              console.error('Erro ao deletar pasta auth:', err);
            }
          }
        }
      }
    });

    // Monitorar Mensagens Recebidas
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;

      for (const msg of m.messages) {
        const jid = msg.key.remoteJid;
        
        // Extrair texto da mensagem
        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text || 
                     msg.message?.imageMessage?.caption || 
                     '';

        if (!text) continue;

        // Logar todas as mensagens antes de filtrar por fromMe para que o usuário possa copiar IDs de grupos
        const origin = msg.key.fromMe ? 'Você' : jid;
        logToUI('WHATSAPP', `Mensagem de ${origin}: "${text}" (JID: ${jid})`);

        // Ignorar mensagens enviadas por nós mesmos para estatísticas e IA
        if (msg.key.fromMe) continue;

        stats.totalReceived++;
        broadcastStats();

        // Responder apenas a DMs (Ignorar Grupos e Listas de Transmissão por padrão)
        if (!jid.endsWith('@s.whatsapp.net')) continue;

        // Executar Inteligência Artificial se ativa
        if (settings.aiEnabled && settings.geminiApiKey) {
          try {
            await handleAIMessage(jid, text);
          } catch (err) {
            logToUI('GEMINI', `Erro no processamento da IA: ${err.message}`);
          }
        }
      }
    });

  } catch (err) {
    logToUI('SYSTEM', `Erro ao inicializar conexão Baileys: ${err.message}`);
    setConnectionStatus('disconnected');
  }
}

// --- Gerenciador de IA (Gemini + N8N Tools) ---
async function handleAIMessage(jid, userText) {
  logToUI('GEMINI', `Processando resposta com IA para ${jid}...`);

  // Carregar histórico ou criar
  let history = chatHistories.get(jid) || [];
  history.push({ role: 'user', parts: [{ text: userText }] });

  // Limitar histórico para poupar token e manter velocidade (últimas 20 mensagens)
  if (history.length > 20) {
    history.splice(0, history.length - 20);
  }

  const ai = new GoogleGenAI({ apiKey: settings.geminiApiKey });

  // Construir declaração de ferramentas
  const tools = [];
  const functionDeclarations = [];

  // Adicionar ferramentas nativas de agendamento automático da IA
  functionDeclarations.push({
    name: 'ver_horarios_disponiveis',
    description: 'Retorna uma lista de horários livres para agendamento em uma data específica no formato AAAA-MM-DD (ex: 2026-06-07). Chame sempre que o cliente perguntar se há horários livres ou demonstrar interesse em marcar um dia.',
    parameters: {
      type: 'OBJECT',
      properties: {
        date: {
          type: 'STRING',
          description: 'Data a ser consultada no formato AAAA-MM-DD.'
        }
      },
      required: ['date']
    }
  });

  functionDeclarations.push({
    name: 'confirmar_agendamento',
    description: 'Registra e confirma uma reserva para o cliente em um determinado dia (AAAA-MM-DD) e horário (HH:MM). Chame apenas depois que o cliente tiver escolhido o dia e horário e tiver informado seu nome completo ou primeiro nome. Requer nome, telefone, data e horário.',
    parameters: {
      type: 'OBJECT',
      properties: {
        name: {
          type: 'STRING',
          description: 'Nome completo ou primeiro nome do cliente.'
        },
        phone: {
          type: 'STRING',
          description: 'Telefone do cliente (geralmente extraído do JID do remetente ou informado pelo usuário).'
        },
        date: {
          type: 'STRING',
          description: 'Data do agendamento (AAAA-MM-DD).'
        },
        time: {
          type: 'STRING',
          description: 'Horário do agendamento (HH:MM).'
        }
      },
      required: ['name', 'phone', 'date', 'time']
    }
  });

  if (settings.n8nTools && settings.n8nTools.length > 0) {
    settings.n8nTools.forEach(tool => {
      const properties = {};
      const required = [];

      if (tool.parameters) {
        tool.parameters.split(',').map(p => p.trim()).filter(Boolean).forEach(param => {
          properties[param] = {
            type: 'STRING',
            description: `Valor para o campo ${param}`
          };
          required.push(param);
        });
      }

      functionDeclarations.push({
        name: tool.name,
        description: tool.description,
        parameters: {
          type: 'OBJECT',
          properties: properties,
          required: required
        }
      });
    });
  }

  if (functionDeclarations.length > 0) {
    tools.push({ functionDeclarations });
  }

  try {
    let response = await ai.models.generateContent({
      model: settings.geminiModel,
      contents: history,
      config: {
        systemInstruction: settings.systemPrompt,
        temperature: parseFloat(settings.temperature) || 0.7,
        tools: tools.length > 0 ? tools : undefined
      }
    });

    // Loop para processar múltiplos chamados de ferramentas sequenciais
    let functionCalls = response.functionCalls;
    while (functionCalls && functionCalls.length > 0) {
      const call = functionCalls[0];
      logToUI('GEMINI', `IA identificou necessidade de ação: ${call.name} com ${JSON.stringify(call.args)}`);
      stats.n8nCalls++;
      broadcastStats();

      let toolResult = '';

      if (call.name === 'ver_horarios_disponiveis') {
        try {
          const date = call.args.date;
          logToUI('SYSTEM', `IA consultando horários para a data: ${date}`);
          const availableSlots = getAvailableSlotsForDate(date);
          toolResult = JSON.stringify({ available_slots: availableSlots });
        } catch (err) {
          logToUI('SYSTEM', `Erro ao consultar horários: ${err.message}`);
          toolResult = JSON.stringify({ error: err.message });
        }
      } 
      else if (call.name === 'confirmar_agendamento') {
        try {
          logToUI('SYSTEM', `IA solicitando agendamento: ${JSON.stringify(call.args)}`);
          const booking = bookSlot(call.args.name, call.args.phone, call.args.date, call.args.time);
          toolResult = JSON.stringify({ success: true, appointment: booking });
        } catch (err) {
          logToUI('SYSTEM', `Erro ao confirmar agendamento: ${err.message}`);
          toolResult = JSON.stringify({ error: err.message });
        }
      }
      else {
        // Encontrar webhook correspondente do N8N
        const toolConfig = settings.n8nTools.find(t => t.name === call.name);
        if (toolConfig) {
          try {
            logToUI('N8N', `Chamando Webhook N8N (${toolConfig.method}): ${toolConfig.webhookUrl}`);
            const resN8N = await fetch(toolConfig.webhookUrl, {
              method: toolConfig.method || 'POST',
              headers: {
                'Content-Type': 'application/json'
              },
              body: toolConfig.method === 'GET' ? undefined : JSON.stringify(call.args)
            });
            const rawResponseText = await resN8N.text();
            logToUI('N8N', `Retorno N8N (Status ${resN8N.status}): ${rawResponseText.substring(0, 150)}`);
            toolResult = rawResponseText;
          } catch (err) {
            logToUI('N8N', `Erro ao conectar com N8N: ${err.message}`);
            toolResult = JSON.stringify({ error: err.message });
          }
        } else {
          logToUI('GEMINI', `Aviso: Ferramenta "${call.name}" não configurada no aplicativo.`);
          toolResult = JSON.stringify({ error: `Ferramenta ${call.name} não existe.` });
        }
      }

      // Adicionar resposta da ferramenta ao histórico e chamar novamente
      history.push({ role: 'model', parts: [{ functionCall: { name: call.name, args: call.args } }] });
      history.push({
        role: 'tool',
        parts: [{ functionResponse: { name: call.name, response: { result: toolResult } } }]
      });

      // Solicitar continuação para o Gemini
      response = await ai.models.generateContent({
        model: settings.geminiModel,
        contents: history,
        config: {
          systemInstruction: settings.systemPrompt,
          temperature: parseFloat(settings.temperature) || 0.7,
          tools: tools.length > 0 ? tools : undefined
        }
      });

      functionCalls = response.functionCalls;
    }

    // Enviar mensagem final gerada
    const finalReply = response.text;
    if (finalReply && sock) {
      await sock.sendMessage(jid, { text: finalReply });
      
      // Registrar no histórico local
      history.push({ role: 'model', parts: [{ text: finalReply }] });
      chatHistories.set(jid, history);

      stats.totalSent++;
      stats.aiResponses++;
      broadcastStats();

      logToUI('WHATSAPP', `Resposta da IA enviada para ${jid}: "${finalReply}"`);
    }

  } catch (err) {
    logToUI('GEMINI', `Falha ao gerar resposta ou chamar API: ${err.message}`);
  }
}

// --- Funções Auxiliares para o Agendador Automático da IA ---
function getAvailableSlotsForDate(dateStr) {
  const startHourStr = settings.workingHoursStart || '09:00';
  const endHourStr = settings.workingHoursEnd || '18:00';
  const duration = parseInt(settings.slotDuration, 10) || 60;

  const [startHour, startMin] = startHourStr.split(':').map(Number);
  const [endHour, endMin] = endHourStr.split(':').map(Number);

  const slots = [];
  const start = new Date(2000, 0, 1, startHour, startMin, 0, 0);
  const end = new Date(2000, 0, 1, endHour, endMin, 0, 0);

  let current = new Date(start);
  while (current.getTime() + duration * 60 * 1000 <= end.getTime()) {
    const hh = String(current.getHours()).padStart(2, '0');
    const mm = String(current.getMinutes()).padStart(2, '0');
    slots.push(`${hh}:${mm}`);
    current.setTime(current.getTime() + duration * 60 * 1000);
  }

  const booked = settings.appointments || [];
  const bookedTimes = booked
    .filter(app => app.date === dateStr && app.status !== 'cancelled')
    .map(app => app.time);

  return slots.filter(time => !bookedTimes.includes(time));
}

function bookSlot(name, phone, date, time) {
  if (!settings.appointments) settings.appointments = [];
  
  let cleanPhone = phone;
  if (!cleanPhone.includes('@')) {
    cleanPhone = `${cleanPhone.replace(/\D/g, '')}@s.whatsapp.net`;
  }

  const appointment = {
    id: `app-${Date.now()}`,
    name: name.trim(),
    phone: cleanPhone,
    date: date.trim(),
    time: time.trim(),
    status: 'confirmed'
  };

  settings.appointments.push(appointment);
  saveSettings({ appointments: settings.appointments });

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('appointments-update', settings.appointments);
  }

  return appointment;
}

// --- Motor de Agendamento Nativo ---
function calculateNextRun(schedule) {
  if (schedule.type === 'interval') {
    // Se a mensagem nunca rodou (criação recente), o primeiro disparo ocorre imediatamente
    if (!schedule.lastRun) {
      return Date.now();
    }
    let multiplier = 60 * 1000; // Padrão: minutos
    if (schedule.intervalUnit === 'hours') {
      multiplier = 60 * 60 * 1000;
    } else if (schedule.intervalUnit === 'days') {
      multiplier = 24 * 60 * 60 * 1000;
    }
    return Date.now() + (parseInt(schedule.intervalValue, 10) * multiplier);
  } else if (schedule.type === 'daily') {
    if (!schedule.dailyTime) return Date.now() + 24 * 60 * 60 * 1000;
    const [hours, minutes] = schedule.dailyTime.split(':').map(Number);
    const next = new Date();
    next.setHours(hours, minutes, 0, 0);
    if (next.getTime() <= Date.now()) {
      // Já passou hoje, programa para amanhã
      next.setDate(next.getDate() + 1);
    }
    return next.getTime();
  }
  return Date.now();
}

async function checkScheduledMessages() {
  if (!sock || connectionStatus !== 'connected') {
    return;
  }

  const now = Date.now();
  let updated = false;

  const list = settings.scheduledMessages || [];
  for (const schedule of list) {
    if (schedule.enabled && schedule.nextRun && now >= schedule.nextRun) {
      let targetJid = schedule.target;
      if (!targetJid.includes('@')) {
        targetJid = `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
      }
      logToUI('SYSTEM', `Disparando mensagem agendada (ID: ${schedule.id}) para ${targetJid}`);
      try {
        await sock.sendMessage(targetJid, { text: schedule.message });
        
        schedule.lastRun = now;
        schedule.nextRun = calculateNextRun(schedule);
        updated = true;
        
        stats.totalSent++;
        broadcastStats();
      } catch (err) {
        logToUI('SYSTEM', `Erro ao disparar mensagem agendada (ID: ${schedule.id}): ${err.message}`);
        // Proteção: avança 2 minutos se falhar para não travar o loop
        schedule.nextRun = now + 2 * 60 * 1000;
        updated = true;
      }
    }
  }

  if (updated) {
    saveSettings({ scheduledMessages: list });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('schedules-update', list);
    }
  }
}

// --- Criação da Janela do Electron ---
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 650,
    title: 'ZapFlow AI - WhatsApp Agent',
    icon: path.join(__dirname, 'icon.png'), // OPCIONAL
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    },
    titleBarStyle: 'default',
    autoHideMenuBar: true
  });

  mainWindow.loadFile('index.html');
  mainWindow.webContents.openDevTools();

  // Minimize to tray instead of closing
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Eventos da Janela e IPC ---
app.whenReady().then(() => {
  loadSettings();
  createWindow();
  createTray();

  // Iniciar Express
  startExpressServer(settings.expressPort);

  // Auto-conectar WhatsApp se a sessão já existe
  if (fs.existsSync(path.join(authFolder, 'creds.json'))) {
    logToUI('WHATSAPP', 'Sessão anterior detectada. Conectando automaticamente...');
    startWhatsAppConnection();
  } else {
    logToUI('WHATSAPP', 'Nenhuma sessão ativa encontrada. Escaneie o QR Code na aba WhatsApp.');
  }

  // Iniciar Loop do Agendador Nativo (Verifica a cada 30 segundos)
  setInterval(checkScheduledMessages, 30000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Encerrar Express
    if (expressServer) expressServer.close();
    app.quit();
  }
});

// --- IPC Handlers ---

// Salvar/Obter configurações
ipcMain.handle('save-settings', (event, newSettings) => {
  return saveSettings(newSettings);
});

ipcMain.handle('get-settings', () => {
  return settings;
});

// Ações manuais do WhatsApp
ipcMain.on('whatsapp-connect', () => {
  startWhatsAppConnection();
});

ipcMain.on('whatsapp-disconnect', async () => {
  if (sock) {
    logToUI('WHATSAPP', 'Solicitação de logout manual recebida.');
    try {
      await sock.logout();
    } catch (err) {
      logToUI('SYSTEM', `Erro no logout nativo do WhatsApp: ${err.message}`);
    }
    // Forçar limpeza dos arquivos de autenticação
    try {
      fs.rmSync(authFolder, { recursive: true, force: true });
      logToUI('WHATSAPP', 'Arquivos de sessão removidos com sucesso.');
    } catch (err) {
      console.error(err);
    }
    sock = null;
    currentQR = '';
    setConnectionStatus('disconnected');
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-qr', '');
    }
  }
});

ipcMain.handle('whatsapp-send-message', async (event, jid, text) => {
  if (connectionStatus !== 'connected' || !sock) {
    throw new Error('WhatsApp não está conectado.');
  }
  let targetJid = jid;
  if (!targetJid.includes('@')) {
    targetJid = `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
  }
  
  logToUI('WHATSAPP', `Enviando mensagem de teste para ${targetJid}...`);
  await sock.sendMessage(targetJid, { text });
  
  stats.totalSent++;
  broadcastStats();
  return true;
});

// Resposta de estado atual quando carregada a tela
ipcMain.on('request-whatsapp-status', (event) => {
  event.reply('whatsapp-status', connectionStatus);
  if (currentQR) {
    event.reply('whatsapp-qr', currentQR);
  }
});

ipcMain.on('request-stats', (event) => {
  event.reply('stats-update', stats);
});

// Agendador Nativo IPCs
ipcMain.handle('schedule-save', (event, scheduleData) => {
  if (!settings.scheduledMessages) settings.scheduledMessages = [];
  
  const existing = scheduleData.id ? settings.scheduledMessages.find(s => s.id === scheduleData.id) : null;
  
  const newSchedule = {
    id: scheduleData.id || Date.now().toString(),
    target: scheduleData.target.trim(),
    message: scheduleData.message.trim(),
    type: scheduleData.type,
    intervalValue: parseInt(scheduleData.intervalValue, 10) || 1,
    intervalUnit: scheduleData.intervalUnit || 'hours',
    dailyTime: scheduleData.dailyTime || '',
    enabled: scheduleData.enabled !== undefined ? scheduleData.enabled : true,
    lastRun: null // Reset lastRun so it fires immediately on save/configure
  };
  
  newSchedule.nextRun = calculateNextRun(newSchedule);
  
  if (scheduleData.id) {
    const idx = settings.scheduledMessages.findIndex(s => s.id === scheduleData.id);
    if (idx !== -1) {
      settings.scheduledMessages[idx] = newSchedule;
    } else {
      settings.scheduledMessages.push(newSchedule);
    }
  } else {
    settings.scheduledMessages.push(newSchedule);
  }
  
  saveSettings({ scheduledMessages: settings.scheduledMessages });
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('schedules-update', settings.scheduledMessages);
  }
  
  logToUI('SYSTEM', `Agendamento salvo com sucesso (ID: ${newSchedule.id})`);
  
  // Trigger check immediately so it sends the message right away if WhatsApp is connected
  checkScheduledMessages();
  
  return true;
});

ipcMain.handle('schedule-toggle', (event, id, enabled) => {
  const list = settings.scheduledMessages || [];
  const schedule = list.find(s => s.id === id);
  if (schedule) {
    schedule.enabled = enabled;
    if (enabled) {
      // If we enable it, let's reset lastRun so it fires immediately on resume
      schedule.lastRun = null;
      schedule.nextRun = calculateNextRun(schedule);
    }
    saveSettings({ scheduledMessages: list });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('schedules-update', list);
    }
    logToUI('SYSTEM', `Agendamento ${id} ${enabled ? 'ativado' : 'pausado'}`);
    
    if (enabled) {
      checkScheduledMessages();
    }
    return true;
  }
  return false;
});

ipcMain.handle('schedule-trigger-now', async (event, id) => {
  const list = settings.scheduledMessages || [];
  const schedule = list.find(s => s.id === id);
  if (schedule && sock && connectionStatus === 'connected') {
    logToUI('SYSTEM', `Gatilho manual disparado para agendamento ${id}`);
    try {
      let targetJid = schedule.target;
      if (!targetJid.includes('@')) {
        targetJid = `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
      }
      await sock.sendMessage(targetJid, { text: schedule.message });
      schedule.lastRun = Date.now();
      schedule.nextRun = calculateNextRun(schedule);
      saveSettings({ scheduledMessages: list });
      
      stats.totalSent++;
      broadcastStats();
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('schedules-update', list);
      }
      return true;
    } catch (err) {
      logToUI('SYSTEM', `Erro no disparo manual do agendamento ${id}: ${err.message}`);
      throw err;
    }
  }
  throw new Error('Agendamento não encontrado ou WhatsApp desconectado.');
});

ipcMain.handle('schedule-delete', (event, id) => {
  if (!settings.scheduledMessages) return false;
  settings.scheduledMessages = settings.scheduledMessages.filter(s => s.id !== id);
  saveSettings({ scheduledMessages: settings.scheduledMessages });
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('schedules-update', settings.scheduledMessages);
  }
  logToUI('SYSTEM', `Agendamento excluído (ID: ${id})`);
  return true;
});

// IPCs da Agenda de Consultas/Compromissos
ipcMain.handle('appointment-cancel', (event, id) => {
  const list = settings.appointments || [];
  const app = list.find(a => a.id === id);
  if (app) {
    app.status = 'cancelled';
    saveSettings({ appointments: list });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('appointments-update', list);
    }
    logToUI('SYSTEM', `Agendamento cancelado via UI (ID: ${id})`);
    return true;
  }
  return false;
});

ipcMain.handle('appointment-delete', (event, id) => {
  if (!settings.appointments) return false;
  settings.appointments = settings.appointments.filter(a => a.id !== id);
  saveSettings({ appointments: settings.appointments });
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('appointments-update', settings.appointments);
  }
  logToUI('SYSTEM', `Agendamento excluído da lista (ID: ${id})`);
  return true;
});

ipcMain.on('log-error-to-main', (event, err) => {
  try {
    fs.appendFileSync('c:\\Users\\Felipe Gondim\\HUB_Projetos\\Agente\\app_debug.log', `[${new Date().toLocaleTimeString()}] [RENDERER ERROR] ${JSON.stringify(err, null, 2)}\n`);
  } catch (e) {}
});
