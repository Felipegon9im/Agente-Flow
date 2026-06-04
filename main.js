const { app, BrowserWindow, ipcMain } = require('electron');
const path = require('path');
const fs = require('fs');
const express = require('express');
const cors = require('cors');
const pino = require('pino');
const QRCode = require('qrcode');
const { GoogleGenAI } = require('@google/genai');

// --- Globais ---
let mainWindow = null;
let sock = null;
let connectionStatus = 'disconnected'; // 'disconnected', 'connecting', 'connected', 'qr'
let currentQR = '';
let settings = null;
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
  console.log(`[${type}] ${message}`);
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
    systemPrompt: 'Você é um assistente virtual inteligente e prestativo para atendimento ao cliente no WhatsApp. Responda de forma curta, objetiva, profissional e amigável.',
    temperature: 0.7,
    n8nTools: [],
    expressPort: 3003,
    aiEnabled: true
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
  connectionStatus = 'connecting';
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('whatsapp-status', connectionStatus);
  }

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
        connectionStatus = 'qr';
        try {
          currentQR = await QRCode.toDataURL(qr);
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('whatsapp-qr', currentQR);
            mainWindow.webContents.send('whatsapp-status', 'qr');
          }
          logToUI('WHATSAPP', 'Novo QR Code gerado. Aguardando escaneamento...');
        } catch (err) {
          logToUI('SYSTEM', `Erro ao gerar QRCode Base64: ${err.message}`);
        }
      }

      if (connection === 'connecting') {
        connectionStatus = 'connecting';
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('whatsapp-status', 'connecting');
        }
        logToUI('WHATSAPP', 'Conectando...');
      }

      if (connection === 'open') {
        connectionStatus = 'connected';
        currentQR = '';
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('whatsapp-status', 'connected');
          mainWindow.webContents.send('whatsapp-qr', '');
        }
        logToUI('WHATSAPP', `Conectado com sucesso! Usuário logado: ${sock.user.name || sock.user.id}`);
      }

      if (connection === 'close') {
        const statusCode = lastDisconnect?.error?.output?.statusCode;
        const shouldReconnect = statusCode !== DisconnectReason.loggedOut;

        logToUI('WHATSAPP', `Conexão fechada. Código: ${statusCode}. Tentando reconectar? ${shouldReconnect ? 'Sim' : 'Não'}`);

        sock = null;
        currentQR = '';

        if (shouldReconnect) {
          connectionStatus = 'connecting';
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('whatsapp-status', 'connecting');
          }
          // Reconectar após um pequeno atraso
          setTimeout(() => startWhatsAppConnection(), 5000);
        } else {
          connectionStatus = 'disconnected';
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('whatsapp-status', 'disconnected');
            mainWindow.webContents.send('whatsapp-qr', '');
          }
          // Deletar pasta de credenciais se deslogado
          try {
            fs.rmSync(authFolder, { recursive: true, force: true });
            logToUI('WHATSAPP', 'Sessão encerrada e arquivos locais limpos.');
          } catch (err) {
            console.error('Erro ao deletar pasta auth:', err);
          }
        }
      }
    });

    // Monitorar Mensagens Recebidas
    sock.ev.on('messages.upsert', async (m) => {
      if (m.type !== 'notify') return;

      for (const msg of m.messages) {
        // Ignorar mensagens enviadas por nós mesmos
        if (msg.key.fromMe) continue;

        const jid = msg.key.remoteJid;
        
        // Responder apenas a DMs (Ignorar Grupos e Listas de Transmissão por padrão)
        if (!jid.endsWith('@s.whatsapp.net')) continue;

        // Extrair texto da mensagem
        const text = msg.message?.conversation || 
                     msg.message?.extendedTextMessage?.text || 
                     msg.message?.imageMessage?.caption || 
                     '';

        if (!text) continue;

        stats.totalReceived++;
        broadcastStats();
        logToUI('WHATSAPP', `Mensagem recebida de ${jid}: "${text}"`);

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
    connectionStatus = 'disconnected';
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-status', 'disconnected');
    }
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

  // Construir declaração de ferramentas do N8N
  const tools = [];
  const functionDeclarations = [];

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

    if (functionDeclarations.length > 0) {
      tools.push({ functionDeclarations });
    }
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

      // Encontrar webhook correspondente
      const toolConfig = settings.n8nTools.find(t => t.name === call.name);
      let webhookResult = '';

      if (toolConfig) {
        try {
          logToUI('N8N', `Chamando Webhook N8N (${toolConfig.method}): ${toolConfig.webhookUrl}`);
          
          // Requisição para N8N usando native fetch (Node 18+)
          const resN8N = await fetch(toolConfig.webhookUrl, {
            method: toolConfig.method || 'POST',
            headers: {
              'Content-Type': 'application/json'
            },
            body: toolConfig.method === 'GET' ? undefined : JSON.stringify(call.args)
          });

          const rawResponseText = await resN8N.text();
          logToUI('N8N', `Retorno N8N (Status ${resN8N.status}): ${rawResponseText.substring(0, 150)}`);
          webhookResult = rawResponseText;
        } catch (err) {
          logToUI('N8N', `Erro ao conectar com N8N: ${err.message}`);
          webhookResult = JSON.stringify({ error: err.message });
        }
      } else {
        logToUI('GEMINI', `Aviso: Ferramenta "${call.name}" não configurada no aplicativo.`);
        webhookResult = JSON.stringify({ error: `Ferramenta ${call.name} não existe.` });
      }

      // Adicionar resposta da ferramenta ao histórico e chamar novamente
      history.push({ role: 'model', parts: [{ functionCall: { name: call.name, args: call.args } }] });
      history.push({
        role: 'tool',
        parts: [{ functionResponse: { name: call.name, response: { result: webhookResult } } }]
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

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// --- Eventos da Janela e IPC ---
app.whenReady().then(() => {
  loadSettings();
  createWindow();

  // Iniciar Express
  startExpressServer(settings.expressPort);

  // Auto-conectar WhatsApp se a sessão já existe
  if (fs.existsSync(path.join(authFolder, 'creds.json'))) {
    logToUI('WHATSAPP', 'Sessão anterior detectada. Conectando automaticamente...');
    startWhatsAppConnection();
  } else {
    logToUI('WHATSAPP', 'Nenhuma sessão ativa encontrada. Escaneie o QR Code na aba WhatsApp.');
  }

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
    connectionStatus = 'disconnected';
    currentQR = '';
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('whatsapp-status', 'disconnected');
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
