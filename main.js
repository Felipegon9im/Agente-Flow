const { app, BrowserWindow, ipcMain, Tray, Menu, dialog } = require('electron');
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

// Estados do Robô de Vendas (JID -> { currentNodeId, mode })
const salesFlowStates = new Map();

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
    geminiModel: 'gemini-2.5-flash',
    systemPrompt: 'Você é um assistente virtual inteligente e prestativo para atendimento ao cliente no WhatsApp. Responda de forma curta, objetiva, profissional e amigável. Ao listar horários disponíveis, organize-os em tópicos com marcadores e emojis (ex: ⏰ 09:00). Ao confirmar um agendamento com sucesso, use sempre um formato altamente estruturado e visual com emojis e negritos (ex: ✅ *Agendamento Confirmado!*\\n📅 *Data:* ...\\n⏰ *Horário:* ...\\n👤 *Cliente:* ...). Para agendamentos, você possui as ferramentas "ver_horarios_disponiveis" e "confirmar_agendamento". Sempre pergunte o nome do cliente antes de reservar.',
    temperature: 0.7,
    n8nTools: [],
    expressPort: 3003,
    aiEnabled: true,
    scheduledMessages: [],
    workingHoursStart: '09:00',
    workingHoursEnd: '18:00',
    slotDuration: 60,
    appointments: [],
    billings: [],
    salesBotEnabled: false,
    salesFlow: {
      nodes: [
        {
          id: 'main',
          name: 'Menu Principal',
          text: 'Olá! Seja bem-vindo ao nosso atendimento.\nDigite o número correspondente à opção desejada:\n\n1 - Conhecer Planos de Internet 🌐\n2 - Suporte Técnico 🛠️\n3 - Falar com o Assistente IA 🤖\n4 - Falar com Atendente Humano 👤',
          action: 'none',
          options: [
            { trigger: '1', targetNodeId: 'planos' },
            { trigger: '2', targetNodeId: 'suporte' },
            { trigger: '3', targetNodeId: 'transfer_ai' },
            { trigger: '4', targetNodeId: 'transfer_human' }
          ]
        },
        {
          id: 'planos',
          name: 'Planos de Internet',
          text: 'Conheça nossos planos ultra-rápidos:\n\n11 - Plano Basic (100 Mega) - R$ 49/mês 📉\n12 - Plano Pro (500 Mega) - R$ 99/mês 🚀\n0 - Voltar ao Menu Principal ↩️',
          action: 'none',
          options: [
            { trigger: '11', targetNodeId: 'plan_basic' },
            { trigger: '12', targetNodeId: 'plan_pro' },
            { trigger: '0', targetNodeId: 'main' }
          ]
        },
        {
          id: 'plan_basic',
          name: 'Plano Basic',
          text: 'O Plano Basic oferece 100 Mega de velocidade via fibra óptica por apenas R$ 49/mês. Ideal para navegação básica e redes sociais.\n\nDigite 0 para voltar ao Menu Principal ↩️',
          action: 'none',
          options: [
            { trigger: '0', targetNodeId: 'main' }
          ]
        },
        {
          id: 'plan_pro',
          name: 'Plano Pro',
          text: 'O Plano Pro oferece 500 Mega de velocidade via fibra óptica por apenas R$ 99/mês. Excelente para streaming em 4K, jogos online e múltiplos dispositivos simultâneos.\n\nDigite 0 para voltar ao Menu Principal ↩️',
          action: 'none',
          options: [
            { trigger: '0', targetNodeId: 'main' }
          ]
        },
        {
          id: 'suporte',
          name: 'Suporte Técnico',
          text: 'Como podemos te ajudar hoje?\n\n21 - Internet Lenta 🐢\n22 - Sem Sinal de Internet ❌\n0 - Voltar ao Menu Principal ↩️',
          action: 'none',
          options: [
            { trigger: '21', targetNodeId: 'suporte_lenta' },
            { trigger: '22', targetNodeId: 'suporte_sem' },
            { trigger: '0', targetNodeId: 'main' }
          ]
        },
        {
          id: 'suporte_lenta',
          name: 'Internet Lenta',
          text: 'Para resolver lentidão, sugerimos retirar o modem da tomada de energia, aguardar 30 segundos e ligar novamente. Se o problema persistir, digite 4 para falar com suporte humano.\n\nDigite 0 para voltar ao Menu Principal ↩️',
          action: 'none',
          options: [
            { trigger: '0', targetNodeId: 'main' },
            { trigger: '4', targetNodeId: 'transfer_human' }
          ]
        },
        {
          id: 'suporte_sem',
          name: 'Sem Conexão',
          text: 'Verificamos que pode haver uma manutenção na sua região. Um técnico foi alertado e entrará em contato em até 2 horas.\n\nDigite 0 para voltar ao Menu Principal ↩️',
          action: 'none',
          options: [
            { trigger: '0', targetNodeId: 'main' }
          ]
        },
        {
          id: 'transfer_ai',
          name: 'Transferir para IA',
          text: 'Transferindo para o nosso Assistente Virtual Inteligente (IA) alimentado por Gemini. Como posso te ajudar hoje? (Você pode digitar #menu a qualquer momento para voltar ao menu de opções)',
          action: 'transfer_to_ai',
          options: []
        },
        {
          id: 'transfer_human',
          name: 'Transferir para Humano',
          text: 'Menu de robô pausado. Um atendente humano irá assumir esta conversa em instantes para te ajudar pessoalmente! Obrigado pela paciência.',
          action: 'transfer_to_human',
          options: []
        }
      ]
    }
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
  const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
  
  if (sock) {
    logToUI('WHATSAPP', 'WhatsApp já está inicializado.');
    return;
  }

  logToUI('WHATSAPP', 'Iniciando conexão...');
  setConnectionStatus('connecting');

  try {
    const { state, saveCreds } = await useMultiFileAuthState(authFolder);

    // Buscar versão mais recente do WhatsApp Web para evitar erros de conexão (ex: 405 ou falhas de protocolo)
    let version = [2, 3000, 1017506973]; // fallback padrão caso falhe a busca
    try {
      const fetched = await fetchLatestBaileysVersion();
      if (fetched && fetched.version) {
        version = fetched.version;
        logToUI('WHATSAPP', `Versão do WhatsApp Web obtida com sucesso: ${version.join('.')}`);
      }
    } catch (vErr) {
      logToUI('WHATSAPP', `Aviso: Falha ao obter versão recente do WA Web, usando fallback: ${version.join('.')}. Erro: ${vErr.message}`);
    }

    sock = makeWASocket({
      version,
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
        if (!jid.endsWith('@s.whatsapp.net') && !jid.endsWith('@lid')) continue;

        // Executar Robô de Vendas se ativo
        let processedBySalesBot = false;
        if (settings.salesBotEnabled) {
          try {
            processedBySalesBot = await handleSalesBotMessage(jid, text);
          } catch (err) {
            logToUI('SYSTEM', `Erro no Robô de Vendas: ${err.message}`);
          }
        }

        if (processedBySalesBot) continue;

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

// --- Robô de Vendas (Máquina de Estados conversacional) ---
async function handleSalesBotMessage(jid, text) {
  const cleanedText = text.trim();
  let state = salesFlowStates.get(jid);

  // Comando global para voltar ao menu
  if (cleanedText.toLowerCase() === '#menu' || cleanedText.toLowerCase() === '#sair') {
    salesFlowStates.set(jid, { currentNodeId: 'main', mode: 'sales' });
    const mainNode = settings.salesFlow.nodes.find(n => n.id === 'main');
    if (mainNode) {
      await sendWhatsAppMessageWithMedia(jid, mainNode.text, mainNode.filePath);
      stats.totalSent++;
      broadcastStats();
    }
    return true;
  }

  // Se o estado existe e o modo for human, ignoramos (nenhuma resposta automática)
  if (state && state.mode === 'human') {
    return true;
  }

  // Se o estado existe e o modo for ai, deixamos passar para a IA (retorna false)
  if (state && state.mode === 'ai') {
    return false;
  }

  // Se não tem estado cadastrado, inicializa no Menu Principal
  if (!state) {
    state = { currentNodeId: 'main', mode: 'sales' };
    salesFlowStates.set(jid, state);
    const mainNode = settings.salesFlow.nodes.find(n => n.id === 'main');
    if (mainNode) {
      await sendWhatsAppMessageWithMedia(jid, mainNode.text, mainNode.filePath);
      stats.totalSent++;
      broadcastStats();
    }
    return true;
  }

  // Processa opções no modo sales
  const currentNode = settings.salesFlow.nodes.find(n => n.id === state.currentNodeId);
  if (!currentNode) {
    // Se o nó atual sumiu/inválido, reseta para o principal
    state.currentNodeId = 'main';
    salesFlowStates.set(jid, state);
    const mainNode = settings.salesFlow.nodes.find(n => n.id === 'main');
    if (mainNode) {
      await sendWhatsAppMessageWithMedia(jid, mainNode.text, mainNode.filePath);
      stats.totalSent++;
      broadcastStats();
    }
    return true;
  }

  // Verifica se o texto coincide com alguma das opções
  const matchedOption = currentNode.options.find(opt => opt.trigger.trim().toLowerCase() === cleanedText.toLowerCase());

  if (matchedOption) {
    const targetNode = settings.salesFlow.nodes.find(n => n.id === matchedOption.targetNodeId);
    if (targetNode) {
      // Atualiza estado
      state.currentNodeId = targetNode.id;
      if (targetNode.action === 'transfer_to_ai') {
        state.mode = 'ai';
        logToUI('SYSTEM', `Cliente ${jid} transferido para Inteligência Artificial.`);
      } else if (targetNode.action === 'transfer_to_human') {
        state.mode = 'human';
        logToUI('SYSTEM', `Cliente ${jid} transferido para Atendimento Humano (Robô pausado).`);
      }
      salesFlowStates.set(jid, state);

      // Envia a mensagem do novo nó com suporte a mídia
      await sendWhatsAppMessageWithMedia(jid, targetNode.text, targetNode.filePath);
      stats.totalSent++;
      broadcastStats();
    } else {
      // Se o nó alvo não existe (link quebrado), avisa e reseta
      logToUI('SYSTEM', `Aviso: Link de fluxo quebrado para o nó ${matchedOption.targetNodeId}`);
      state.currentNodeId = 'main';
      salesFlowStates.set(jid, state);
      const mainNode = settings.salesFlow.nodes.find(n => n.id === 'main');
      if (mainNode) {
        await sendWhatsAppMessageWithMedia(jid, `Desculpe, ocorreu um erro na navegação do menu. Retornando ao menu principal.\n\n${mainNode.text}`, mainNode.filePath);
        stats.totalSent++;
        broadcastStats();
      }
    }
  } else {
    // Opção inválida digitada: envia aviso e repete o nó atual (sem mídia para não repetir anexo)
    await sock.sendMessage(jid, { text: `⚠️ *Opção inválida!* Por favor, digite uma das opções numéricas válidas.\n\n${currentNode.text}` });
    stats.totalSent++;
    broadcastStats();
  }

  return true;
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

function checkAppointmentReminders() {
  if (!settings.appointments || settings.appointments.length === 0) return;
  if (settings.appointmentsReminderEnabled === false) return;
  if (!sock || connectionStatus !== 'connected') return;

  const now = new Date();
  let updated = false;
  const reminderHours = parseInt(settings.appointmentsReminderHours, 10) || 2;
  const reminderWindowMs = reminderHours * 60 * 60 * 1000;

  settings.appointments.forEach(async (app) => {
    if (app.status !== 'confirmed' || app.reminderSent) return;

    try {
      const [year, month, day] = app.date.split('-').map(Number);
      const [hours, minutes] = app.time.split(':').map(Number);
      const appDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
      const diffMs = appDate.getTime() - now.getTime();

      // Se o compromisso for no futuro e faltar menos ou igual ao tempo de janela
      if (diffMs > 0 && diffMs <= reminderWindowMs) {
        app.reminderSent = true;
        updated = true;

        let displayDate = app.date;
        const parts = app.date.split('-');
        if (parts.length === 3) {
          displayDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }

        const reminderText = `⏰ *Lembrete de Compromisso*\n\nOlá, *${app.name}*!\nEste é um lembrete amigável sobre o seu horário reservado para hoje:\n\n📅 *Data:* ${displayDate}\n⏰ *Horário:* ${app.time} hrs\n👤 *Profissional:* Atendimento Geral\n\nContamos com a sua presença!\n_Caso precise remarcar ou cancelar, por favor nos avise._\n━━━━━━━━━━━━━━━━━━\n*ZapFlow AI* | Automação Inteligente`;

        await sock.sendMessage(app.phone, { text: reminderText });
        logToUI('WHATSAPP', `Lembrete automático enviado para ${app.phone} (Compromisso às ${app.time})`);
      }
    } catch (err) {
      console.error('Erro ao processar lembrete automático:', err);
    }
  });

  if (updated) {
    saveSettings({ appointments: settings.appointments });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('appointments-update', settings.appointments);
    }
  }
}

async function checkBillingReminders() {
  if (!settings.billings || settings.billings.length === 0) return;
  if (!sock || connectionStatus !== 'connected') return;

  const now = new Date();
  let updated = false;

  for (const bill of settings.billings) {
    if (bill.status !== 'pending') continue;

    try {
      const [year, month, day] = bill.dueDate.split('-').map(Number);
      const [hours, minutes] = (bill.dueTime || '09:00').split(':').map(Number);
      const triggerDate = new Date(year, month - 1, day, hours, minutes, 0, 0);

      // Se a data/hora atual é maior ou igual ao horário do gatilho
      if (now.getTime() >= triggerDate.getTime()) {
        logToUI('SYSTEM', `Disparando lembrete de cobrança automático (ID: ${bill.id}) para ${bill.clientName}`);
        
        let targetJid = bill.clientPhone.trim();
        if (!targetJid.includes('@')) {
          targetJid = `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
        }

        try {
          await sendWhatsAppMessageWithMedia(targetJid, bill.message, bill.filePath);
          bill.status = 'sent';
          bill.sentAt = Date.now();
          updated = true;
          stats.totalSent++;
          broadcastStats();
          logToUI('WHATSAPP', `Cobrança enviada com sucesso para ${bill.clientName} (${bill.clientPhone})`);
        } catch (sendErr) {
          logToUI('SYSTEM', `Erro ao enviar cobrança (ID: ${bill.id}): ${sendErr.message}`);
          bill.status = 'failed';
          updated = true;
        }
      }
    } catch (err) {
      console.error('Erro ao processar cobrança automática:', err);
    }
  }

  if (updated) {
    saveSettings({ billings: settings.billings });
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('billings-update', settings.billings);
    }
  }
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
        await sendWhatsAppMessageWithMedia(targetJid, schedule.message, schedule.filePath);
        
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

  // Iniciar Loop de Lembretes de Consulta (Verifica a cada 60 segundos)
  setInterval(checkAppointmentReminders, 60000);

  // Iniciar Loop de Lembretes de Cobrança (Verifica a cada 60 segundos)
  setInterval(checkBillingReminders, 60000);

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

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  switch (ext) {
    case '.pdf': return 'application/pdf';
    case '.doc':
    case '.docx': return 'application/msword';
    case '.xls':
    case '.xlsx': return 'application/vnd.ms-excel';
    case '.ppt':
    case '.pptx': return 'application/vnd.ms-powerpoint';
    case '.zip': return 'application/zip';
    case '.rar': return 'application/x-rar-compressed';
    case '.txt': return 'text/plain';
    case '.csv': return 'text/csv';
    case '.png': return 'image/png';
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.mp3': return 'audio/mpeg';
    case '.ogg': return 'audio/ogg';
    case '.wav': return 'audio/wav';
    case '.m4a': return 'audio/mp4';
    case '.mp4': return 'video/mp4';
    case '.mov': return 'video/quicktime';
    default: return 'application/octet-stream';
  }
}

async function sendWhatsAppMessageWithMedia(jid, text, filePath) {
  if (!sock) throw new Error('WhatsApp não está conectado.');

  // Se não foi fornecido arquivo ou o arquivo não existe, envia texto comum
  if (!filePath || !fs.existsSync(filePath)) {
    if (filePath) {
      logToUI('SYSTEM', `Aviso: Arquivo em '${filePath}' não encontrado. Enviando como texto comum.`);
    }
    await sock.sendMessage(jid, { text });
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const mimeType = getMimeType(filePath);
  const fileName = path.basename(filePath);

  let payload = {};

  if (['.png', '.jpg', '.jpeg', '.gif', '.webp'].includes(ext)) {
    payload = {
      image: { url: filePath },
      caption: text
    };
  } else if (['.mp4', '.mov', '.avi', '.mkv'].includes(ext)) {
    payload = {
      video: { url: filePath },
      caption: text
    };
  } else if (['.mp3', '.ogg', '.wav', '.m4a'].includes(ext)) {
    payload = {
      audio: { url: filePath },
      mimetype: mimeType,
      ptt: ext === '.ogg'
    };
  } else {
    payload = {
      document: { url: filePath },
      mimetype: mimeType,
      fileName: fileName,
      caption: text
    };
  }

  await sock.sendMessage(jid, payload);
}

ipcMain.handle('select-file', async () => {
  const result = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: 'Arquivos de Mídia/Documentos', extensions: ['jpg', 'jpeg', 'png', 'gif', 'webp', 'mp4', 'mov', 'avi', 'mkv', 'mp3', 'wav', 'ogg', 'm4a', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt', 'csv', 'zip', 'rar'] },
      { name: 'Todos os Arquivos', extensions: ['*'] }
    ]
  });
  if (!result.canceled && result.filePaths.length > 0) {
    return result.filePaths[0];
  }
  return null;
});

ipcMain.handle('whatsapp-send-message', async (event, jid, text, filePath) => {
  if (connectionStatus !== 'connected' || !sock) {
    throw new Error('WhatsApp não está conectado.');
  }
  let targetJid = jid;
  if (!targetJid.includes('@')) {
    targetJid = `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
  }
  
  logToUI('WHATSAPP', `Enviando mensagem para ${targetJid}${filePath ? ' com anexo' : ''}...`);
  await sendWhatsAppMessageWithMedia(targetJid, text, filePath);
  
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
    filePath: scheduleData.filePath || '',
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
      await sendWhatsAppMessageWithMedia(targetJid, schedule.message, schedule.filePath);
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

ipcMain.handle('appointment-create', async (event, { name, phone, date, time }) => {
  try {
    const booking = bookSlot(name, phone, date, time);
    logToUI('SYSTEM', `Novo agendamento manual criado via UI: ${name} (${phone}) em ${date} às ${time}`);
    
    // Disparar mensagem de confirmação no WhatsApp se estiver conectado
    if (sock && connectionStatus === 'connected') {
      try {
        let displayDate = date;
        const parts = date.split('-');
        if (parts.length === 3) {
          displayDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
        }
        
        const confirmText = `✅ *Agendamento Confirmado!*\n\nOlá, *${name.trim()}*!\nSeu compromisso foi agendado manualmente com sucesso.\n\n📅 *Data:* ${displayDate}\n⏰ *Horário:* ${time} hrs\n👤 *Profissional:* Atendimento Geral\n\n━━━━━━━━━━━━━━━━━━\n*ZapFlow AI* | Automação Inteligente`;
        await sock.sendMessage(booking.phone, { text: confirmText });
        logToUI('WHATSAPP', `Mensagem de confirmação manual enviada para ${booking.phone}`);
      } catch (sendErr) {
        logToUI('WHATSAPP', `Erro ao enviar mensagem de confirmação manual: ${sendErr.message}`);
      }
    } else {
      logToUI('SYSTEM', 'WhatsApp desconectado. Confirmação manual não enviada via WhatsApp.');
    }
    
    return { success: true, appointment: booking };
  } catch (err) {
    logToUI('SYSTEM', `Erro ao criar agendamento manual: ${err.message}`);
    return { success: false, error: err.message };
  }
});

// IPCs do Sistema de Cobrança
ipcMain.handle('billing-save', (event, billingData) => {
  if (!settings.billings) settings.billings = [];
  
  const existingIdx = billingData.id ? settings.billings.findIndex(b => b.id === billingData.id) : -1;
  
  const newBilling = {
    id: billingData.id || `bill-${Date.now()}`,
    clientName: billingData.clientName.trim(),
    clientPhone: billingData.clientPhone.trim(),
    amount: billingData.amount.trim(),
    dueDate: billingData.dueDate.trim(),
    dueTime: billingData.dueTime ? billingData.dueTime.trim() : '09:00',
    message: billingData.message.trim(),
    filePath: billingData.filePath || '',
    status: billingData.status || 'pending',
    sentAt: billingData.sentAt || null
  };
  
  if (existingIdx !== -1) {
    settings.billings[existingIdx] = newBilling;
  } else {
    settings.billings.push(newBilling);
  }
  
  saveSettings({ billings: settings.billings });
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('billings-update', settings.billings);
  }
  
  logToUI('SYSTEM', `Cobrança salva com sucesso (ID: ${newBilling.id})`);
  return true;
});

ipcMain.handle('billing-delete', (event, id) => {
  if (!settings.billings) return false;
  settings.billings = settings.billings.filter(b => b.id !== id);
  saveSettings({ billings: settings.billings });
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('billings-update', settings.billings);
  }
  logToUI('SYSTEM', `Cobrança excluída (ID: ${id})`);
  return true;
});

ipcMain.handle('billing-trigger-now', async (event, id) => {
  const list = settings.billings || [];
  const bill = list.find(b => b.id === id);
  if (bill && sock && connectionStatus === 'connected') {
    logToUI('SYSTEM', `Gatilho manual disparado para cobrança (ID: ${id})`);
    try {
      let targetJid = bill.clientPhone.trim();
      if (!targetJid.includes('@')) {
        targetJid = `${targetJid.replace(/\D/g, '')}@s.whatsapp.net`;
      }
      
      await sendWhatsAppMessageWithMedia(targetJid, bill.message, bill.filePath);
      bill.status = 'sent';
      bill.sentAt = Date.now();
      saveSettings({ billings: list });
      
      stats.totalSent++;
      broadcastStats();
      
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('billings-update', list);
      }
      return true;
    } catch (err) {
      logToUI('SYSTEM', `Erro no disparo manual da cobrança ${id}: ${err.message}`);
      bill.status = 'failed';
      saveSettings({ billings: list });
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('billings-update', list);
      }
      throw err;
    }
  }
  throw new Error('Cobrança não encontrada ou WhatsApp desconectado.');
});

// IPCs do Robô de Vendas
ipcMain.handle('sales-node-save', (event, nodeData) => {
  if (!settings.salesFlow) settings.salesFlow = { nodes: [] };
  if (!settings.salesFlow.nodes) settings.salesFlow.nodes = [];
  
  const existingIdx = nodeData.id ? settings.salesFlow.nodes.findIndex(n => n.id === nodeData.id) : -1;
  
  const newNode = {
    id: nodeData.id || `node-${Date.now()}`,
    name: nodeData.name.trim(),
    text: nodeData.text.trim(),
    action: nodeData.action || 'none',
    filePath: nodeData.filePath || '',
    options: nodeData.options || []
  };
  
  if (existingIdx !== -1) {
    settings.salesFlow.nodes[existingIdx] = newNode;
  } else {
    settings.salesFlow.nodes.push(newNode);
  }
  
  saveSettings({ salesFlow: settings.salesFlow });
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sales-flow-update', settings.salesFlow);
  }
  
  logToUI('SYSTEM', `Nó do fluxo de vendas salvo com sucesso: ${newNode.name} (ID: ${newNode.id})`);
  return true;
});

ipcMain.handle('sales-node-delete', (event, id) => {
  if (!settings.salesFlow || !settings.salesFlow.nodes) return false;
  
  // Impedir a exclusão do nó principal 'main' por segurança
  if (id === 'main') {
    throw new Error('O menu principal (main) não pode ser excluído.');
  }

  settings.salesFlow.nodes = settings.salesFlow.nodes.filter(n => n.id !== id);
  saveSettings({ salesFlow: settings.salesFlow });
  
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('sales-flow-update', settings.salesFlow);
  }
  logToUI('SYSTEM', `Nó de menu excluído (ID: ${id})`);
  return true;
});

ipcMain.on('log-error-to-main', (event, err) => {
  try {
    fs.appendFileSync('c:\\Users\\Felipe Gondim\\HUB_Projetos\\Agente\\app_debug.log', `[${new Date().toLocaleTimeString()}] [RENDERER ERROR] ${JSON.stringify(err, null, 2)}\n`);
  } catch (e) {}
});
