// --- Capturar erros no Renderer e mandar para o Main (para fins de debug remoto) ---
window.addEventListener('error', (event) => {
  if (window.api && window.api.logError) {
    window.api.logError({
      type: 'error',
      message: event.message,
      source: event.filename,
      lineno: event.lineno,
      colno: event.colno,
      stack: event.error ? event.error.stack : ''
    });
  }
});

window.addEventListener('unhandledrejection', (event) => {
  if (window.api && window.api.logError) {
    window.api.logError({
      type: 'unhandledrejection',
      message: event.reason ? event.reason.toString() : 'Unhandled promise rejection',
      stack: event.reason && event.reason.stack ? event.reason.stack : ''
    });
  }
});

// --- Estado Global do Renderer ---
let currentSettings = null;

// --- Inicialização ---
document.addEventListener('DOMContentLoaded', async () => {
  // Inicializar Abas
  initTabs();

  // Carregar Configurações
  await loadAndDisplaySettings();

  // Inicializar WhatsApp UI
  initWhatsAppUI();

  // Inicializar Ferramentas N8N
  initN8NToolsUI();
  renderToolsTable();

  // Inicializar Agendador UI
  initSchedulerUI();
  renderSchedulesTable();

  // Inicializar Agenda IA UI
  initAgendaUI();
  renderAppointmentsTable();

  // Inicializar Sistema de Cobrança UI
  initBillingUI();
  renderBillingsTable();

  // Inicializar Robô de Vendas UI
  initSalesBotUI();
  renderNodesTable();

  // Inicializar Console de Logs
  initConsoleUI();

  // Solicitar estado inicial
  window.api.requestStatus();
  window.api.requestStats();

  // Iniciar simulador de pulso do gráfico da Dashboard
  initDashboardChartSimulation();
});

// --- Controle de Abas ---
function initTabs() {
  const navItems = document.querySelectorAll('.nav-item');
  const panels = document.querySelectorAll('.tab-panel');
  const titleEl = document.getElementById('current-view-title');

  navItems.forEach(item => {
    item.addEventListener('click', () => {
      const targetTab = item.getAttribute('data-tab');

      // Atualizar classe ativa na navegação
      navItems.forEach(btn => btn.classList.remove('active'));
      item.classList.add('active');

      // Mostrar painel correspondente
      panels.forEach(panel => {
        panel.classList.remove('active');
        if (panel.id === `${targetTab}-panel`) {
          panel.classList.add('active');
        }
      });

      // Atualizar título no Header
      titleEl.textContent = item.textContent.trim();
    });
  });
}

// --- Carregar e Exibir Configurações ---
async function loadAndDisplaySettings() {
  currentSettings = await window.api.getSettings();

  // Preencher formulário de IA
  document.getElementById('ai-active-toggle').checked = currentSettings.aiEnabled;
  document.getElementById('sales-bot-active-toggle').checked = currentSettings.salesBotEnabled || false;
  document.getElementById('gemini-key').value = currentSettings.geminiApiKey || '';
  document.getElementById('gemini-model').value = currentSettings.geminiModel || 'gemini-2.0-flash';
  document.getElementById('system-prompt').value = currentSettings.systemPrompt || '';
  document.getElementById('temperature').value = currentSettings.temperature || 0.7;
  document.getElementById('temp-val').textContent = currentSettings.temperature || 0.7;
  document.getElementById('express-port').value = currentSettings.expressPort || 3003;

  // Preencher formulário de Agenda
  document.getElementById('working-hours-start').value = currentSettings.workingHoursStart || '09:00';
  document.getElementById('working-hours-end').value = currentSettings.workingHoursEnd || '18:00';
  document.getElementById('slot-duration').value = currentSettings.slotDuration || 60;

  // Configurações de Lembrete
  const reminderCheckbox = document.getElementById('agenda-reminder-enabled');
  const reminderHoursGroup = document.getElementById('group-reminder-hours');
  if (reminderCheckbox && reminderHoursGroup) {
    const updateReminderVisibility = () => {
      reminderHoursGroup.style.display = reminderCheckbox.checked ? 'block' : 'none';
    };
    reminderCheckbox.addEventListener('change', updateReminderVisibility);
    reminderCheckbox.checked = currentSettings.appointmentsReminderEnabled !== false;
    document.getElementById('agenda-reminder-hours').value = currentSettings.appointmentsReminderHours || 2;
    updateReminderVisibility();
  }

  // Atualizar porta Express na Dashboard
  document.getElementById('dash-express-port').textContent = currentSettings.expressPort || 3003;

  // Slider de temperatura
  const tempSlider = document.getElementById('temperature');
  tempSlider.addEventListener('input', (e) => {
    document.getElementById('temp-val').textContent = e.target.value;
  });

  // Mostrar/ocultar senha da API Key
  const btnToggleKey = document.getElementById('btn-toggle-key');
  const geminiKeyInput = document.getElementById('gemini-key');
  btnToggleKey.addEventListener('click', () => {
    if (geminiKeyInput.type === 'password') {
      geminiKeyInput.type = 'text';
      btnToggleKey.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>`;
    } else {
      geminiKeyInput.type = 'password';
      btnToggleKey.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>`;
    }
  });

  // Salvar configurações
  const aiForm = document.getElementById('ai-config-form');
  aiForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    const updatedSettings = {
      aiEnabled: document.getElementById('ai-active-toggle').checked,
      geminiApiKey: document.getElementById('gemini-key').value.trim(),
      geminiModel: document.getElementById('gemini-model').value,
      systemPrompt: document.getElementById('system-prompt').value,
      temperature: parseFloat(document.getElementById('temperature').value),
      expressPort: parseInt(document.getElementById('express-port').value, 10)
    };

    const success = await window.api.saveSettings(updatedSettings);
    if (success) {
      currentSettings = { ...currentSettings, ...updatedSettings };
      document.getElementById('dash-express-port').textContent = currentSettings.expressPort;
      alert('Configurações salvas com sucesso!');
    } else {
      alert('Erro ao salvar as configurações. Verifique os logs.');
    }
  });
}

// --- WhatsApp UI ---
function initWhatsAppUI() {
  const qrContainer = document.getElementById('qr-container-view');
  const qrSpinner = document.getElementById('qr-spinner');
  const qrImage = document.getElementById('qr-image');
  const qrSuccess = document.getElementById('qr-success-view');

  const btnConnect = document.getElementById('btn-wa-connect');
  const btnDisconnect = document.getElementById('btn-wa-disconnect');
  const waStateText = document.getElementById('wa-connection-state');

  const waBadge = document.getElementById('wa-badge');
  const waBadgeText = document.getElementById('wa-badge-text');

  // Monitoramento do estado de conexão
  window.api.onWhatsAppStatus((status) => {
    waStateText.textContent = translateWhatsAppStatus(status);
    
    // Atualizar os badges de status superiores
    const badgeDot = waBadge.querySelector('.badge-dot');
    badgeDot.className = 'badge-dot'; // Limpar classes

    if (status === 'connected') {
      waBadgeText.textContent = 'Conectado';
      badgeDot.classList.add('dot-green');
      
      // Mostrar tela de sucesso
      qrSpinner.style.display = 'none';
      qrImage.style.display = 'none';
      qrSuccess.style.display = 'block';

      btnConnect.style.display = 'none';
      btnDisconnect.style.display = 'inline-flex';

      // Atualizar Dashboard
      document.getElementById('dash-wa-status').textContent = 'Conectado';
      document.getElementById('dash-wa-status').style.color = 'var(--success)';
      document.getElementById('dash-wa-desc').textContent = 'Agente de IA ativo e respondendo clientes.';
    } 
    else if (status === 'connecting') {
      waBadgeText.textContent = 'Conectando';
      badgeDot.classList.add('dot-yellow');

      qrSpinner.style.display = 'flex';
      qrSpinner.querySelector('p').textContent = 'Conectando ao WhatsApp...';
      qrImage.style.display = 'none';
      qrSuccess.style.display = 'none';

      btnConnect.style.display = 'none';
      btnDisconnect.style.display = 'none';

      document.getElementById('dash-wa-status').textContent = 'Conectando...';
      document.getElementById('dash-wa-status').style.color = 'var(--warning)';
      document.getElementById('dash-wa-desc').textContent = 'Tentando estabelecer conexão com servidores.';
    } 
    else if (status === 'qr') {
      waBadgeText.textContent = 'Aguardando Login';
      badgeDot.classList.add('dot-yellow');

      qrSpinner.style.display = 'none';
      qrImage.style.display = 'block';
      qrSuccess.style.display = 'none';

      btnConnect.style.display = 'none';
      btnDisconnect.style.display = 'none';

      document.getElementById('dash-wa-status').textContent = 'Aguardando QR Code';
      document.getElementById('dash-wa-status').style.color = 'var(--warning)';
      document.getElementById('dash-wa-desc').textContent = 'Escaneie o QR Code na aba do WhatsApp.';
    } 
    else {
      waBadgeText.textContent = 'Desconectado';
      badgeDot.classList.add('dot-red');

      qrSpinner.style.display = 'flex';
      qrSpinner.querySelector('p').textContent = 'WhatsApp Desconectado. Clique para Conectar.';
      qrImage.style.display = 'none';
      qrSuccess.style.display = 'none';

      btnConnect.style.display = 'inline-flex';
      btnDisconnect.style.display = 'none';

      document.getElementById('dash-wa-status').textContent = 'Desconectado';
      document.getElementById('dash-wa-status').style.color = 'var(--danger)';
      document.getElementById('dash-wa-desc').textContent = 'Sem conexão ativa. Escaneie o QR Code.';
    }
  });

  // Recebimento do QR Code
  window.api.onWhatsAppQR((qrBase64) => {
    qrImage.src = qrBase64;
    qrImage.style.display = 'block';
    qrSpinner.style.display = 'none';
  });

  // Clique para conectar
  btnConnect.addEventListener('click', () => {
    window.api.connectWhatsApp();
  });

  // Clique para desconectar
  btnDisconnect.addEventListener('click', () => {
    if (confirm('Tem certeza que deseja desconectar sua conta do WhatsApp e limpar a sessão local?')) {
      window.api.disconnectWhatsApp();
    }
  });

  // Lógica de arquivo para teste de envio
  const btnSelectTestFile = document.getElementById('btn-select-test-file');
  const spanTestFileName = document.getElementById('test-file-name');
  const btnRemoveTestFile = document.getElementById('btn-remove-test-file');
  const inputTestFilePath = document.getElementById('test-file-path');

  btnSelectTestFile.addEventListener('click', async () => {
    const filePath = await window.api.selectFile();
    if (filePath) {
      inputTestFilePath.value = filePath;
      const name = filePath.split(/[\\/]/).pop();
      spanTestFileName.textContent = name;
      btnRemoveTestFile.style.display = 'inline-block';
    }
  });

  btnRemoveTestFile.addEventListener('click', () => {
    inputTestFilePath.value = '';
    spanTestFileName.textContent = 'Nenhum arquivo';
    btnRemoveTestFile.style.display = 'none';
  });

  // Formulário de envio de mensagem de teste
  const testForm = document.getElementById('test-message-form');
  testForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phoneInput = document.getElementById('test-phone');
    const msgInput = document.getElementById('test-message');
    const btnSend = document.getElementById('btn-send-test');

    const phone = phoneInput.value.trim();
    const message = msgInput.value.trim();
    const filePath = inputTestFilePath.value;

    if (!message && !filePath) {
      alert('Escreva uma mensagem ou selecione um arquivo para enviar.');
      return;
    }

    btnSend.disabled = true;
    btnSend.textContent = 'Enviando...';

    try {
      await window.api.sendManualMessage(phone, message, filePath);
      alert('Mensagem enviada com sucesso!');
      msgInput.value = '';
      inputTestFilePath.value = '';
      spanTestFileName.textContent = 'Nenhum arquivo';
      btnRemoveTestFile.style.display = 'none';
    } catch (err) {
      alert(`Falha ao enviar: ${err.message}`);
    } finally {
      btnSend.disabled = false;
      btnSend.textContent = 'Enviar Mensagem';
    }
  });
}

function translateWhatsAppStatus(status) {
  switch (status) {
    case 'connected': return 'Conectado';
    case 'connecting': return 'Conectando...';
    case 'qr': return 'Aguardando Escaneamento (QR)';
    case 'disconnected': return 'Desconectado';
    default: return status;
  }
}

// --- Ferramentas N8N UI ---
function initN8NToolsUI() {
  const toolForm = document.getElementById('n8n-tool-form');
  const btnCancelEdit = document.getElementById('btn-cancel-edit');
  const btnSaveTool = document.getElementById('btn-save-tool');

  // Evento Submit para Adicionar/Editar
  toolForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const toolId = document.getElementById('tool-edit-id').value;
    const name = document.getElementById('tool-name').value.trim();
    const description = document.getElementById('tool-desc').value.trim();
    const webhookUrl = document.getElementById('tool-url').value.trim();
    const method = document.getElementById('tool-method').value;
    const parameters = document.getElementById('tool-params').value.trim();

    if (!currentSettings.n8nTools) {
      currentSettings.n8nTools = [];
    }

    if (toolId) {
      // Editar ferramenta existente
      const index = currentSettings.n8nTools.findIndex(t => t.id === toolId);
      if (index !== -1) {
        currentSettings.n8nTools[index] = { id: toolId, name, description, webhookUrl, method, parameters };
      }
    } else {
      // Adicionar nova ferramenta
      const newTool = {
        id: Date.now().toString(),
        name,
        description,
        webhookUrl,
        method,
        parameters
      };
      currentSettings.n8nTools.push(newTool);
    }

    // Salvar configurações gerais
    const success = await window.api.saveSettings({ n8nTools: currentSettings.n8nTools });
    if (success) {
      renderToolsTable();
      resetToolForm();
    } else {
      alert('Erro ao salvar ferramenta. Verifique os logs.');
    }
  });

  // Cancelar Edição
  btnCancelEdit.addEventListener('click', resetToolForm);
}

function renderToolsTable() {
  const tbody = document.getElementById('tools-table-body');
  tbody.innerHTML = '';

  const tools = currentSettings?.n8nTools || [];

  if (tools.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table">Nenhuma ferramenta N8N cadastrada ainda.</td></tr>`;
    return;
  }

  tools.forEach(tool => {
    const tr = document.createElement('tr');

    const paramsHtml = tool.parameters 
      ? tool.parameters.split(',').map(p => `<code>${p.trim()}</code>`).join(' ') 
      : '<span style="color:var(--text-muted);">Nenhum</span>';

    tr.innerHTML = `
      <td><strong>${escapeHtml(tool.name)}</strong></td>
      <td>${escapeHtml(tool.description)}</td>
      <td><span style="font-size:11px;color:var(--text-muted);word-break:break-all;">${escapeHtml(tool.webhookUrl)}</span></td>
      <td>${paramsHtml}</td>
      <td style="text-align: center;">
        <button class="btn btn-secondary btn-sm btn-edit" data-id="${tool.id}" style="margin-right: 6px;">Editar</button>
        <button class="btn btn-danger btn-sm btn-delete" data-id="${tool.id}">Excluir</button>
      </td>
    `;

    // Ações de Botões
    tr.querySelector('.btn-edit').addEventListener('click', () => editTool(tool.id));
    tr.querySelector('.btn-delete').addEventListener('click', () => deleteTool(tool.id));

    tbody.appendChild(tr);
  });
}

function editTool(id) {
  const tool = currentSettings.n8nTools.find(t => t.id === id);
  if (!tool) return;

  document.getElementById('tool-edit-id').value = tool.id;
  document.getElementById('tool-name').value = tool.name;
  document.getElementById('tool-desc').value = tool.description;
  document.getElementById('tool-url').value = tool.webhookUrl;
  document.getElementById('tool-method').value = tool.method || 'POST';
  document.getElementById('tool-params').value = tool.parameters || '';

  document.getElementById('btn-save-tool').textContent = 'Salvar Alterações';
  document.getElementById('btn-cancel-edit').style.display = 'inline-flex';
}

async function deleteTool(id) {
  if (!confirm('Deseja realmente remover esta ferramenta do N8N?')) return;

  currentSettings.n8nTools = currentSettings.n8nTools.filter(t => t.id !== id);
  const success = await window.api.saveSettings({ n8nTools: currentSettings.n8nTools });
  if (success) {
    renderToolsTable();
    resetToolForm();
  }
}

function resetToolForm() {
  document.getElementById('tool-edit-id').value = '';
  document.getElementById('n8n-tool-form').reset();
  document.getElementById('btn-save-tool').textContent = 'Adicionar Ferramenta';
  document.getElementById('btn-cancel-edit').style.display = 'none';
}

function escapeHtml(str) {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
}

// --- Console UI ---
function initConsoleUI() {
  const consoleOutput = document.getElementById('console-output');
  const autoscrollCb = document.getElementById('console-autoscroll');
  const btnClear = document.getElementById('btn-clear-console');

  // Monitor de Logs recebidos
  window.api.onLog(({ time, type, message }) => {
    const line = document.createElement('div');
    line.className = 'console-line';

    let tagClass = 'tag-system';
    if (type === 'WHATSAPP') tagClass = 'tag-whatsapp';
    else if (type === 'GEMINI') tagClass = 'tag-gemini';
    else if (type === 'N8N') tagClass = 'tag-n8n';

    line.innerHTML = `
      <span class="log-time">[${time}]</span>
      <span class="log-tag ${tagClass}">${type}</span>
      <span class="log-message">${escapeHtml(message)}</span>
    `;

    consoleOutput.appendChild(line);

    // Limite de 500 linhas no console
    if (consoleOutput.children.length > 500) {
      consoleOutput.removeChild(consoleOutput.firstChild);
    }

    if (autoscrollCb.checked) {
      consoleOutput.scrollTop = consoleOutput.scrollHeight;
    }
  });

  // Limpar logs da tela
  btnClear.addEventListener('click', () => {
    consoleOutput.innerHTML = `<div class="console-line"><span class="log-time">[${new Date().toLocaleTimeString()}]</span> <span class="log-tag tag-system">SYSTEM</span> Console limpo. Aguardando eventos...</div>`;
  });
}

// --- Monitor de Estatísticas ---
window.api.onStats((stats) => {
  document.getElementById('dash-received').textContent = stats.totalReceived;
  document.getElementById('dash-sent').textContent = stats.totalSent;
  
  // Calcular taxa de resposta IA
  const total = stats.totalReceived;
  const ai = stats.aiResponses;
  let pct = '0%';
  if (total > 0) {
    pct = `${Math.round((ai / total) * 100)}%`;
  }
  document.getElementById('dash-ai').textContent = `${ai} (${pct})`;

  // Atualizar N8N Calls na Dashboard
  document.getElementById('dash-n8n-calls').textContent = stats.n8nCalls;

  // Adicionar um efeito de escala temporário para indicar mudança (micro-animação)
  animateStatChange('dash-received');
  animateStatChange('dash-sent');
  animateStatChange('dash-ai');
  animateStatChange('dash-n8n-calls');
});

function animateStatChange(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.style.transform = 'scale(1.1)';
  el.style.transition = 'transform 0.1s ease-out';
  setTimeout(() => {
    el.style.transform = 'scale(1)';
  }, 100);
}

// A tabela de ferramentas é renderizada diretamente na inicialização do DOMContentLoaded.

// --- Agenda IA UI ---
function initAgendaUI() {
  const agendaSettingsForm = document.getElementById('agenda-settings-form');

  // Salvar configurações de funcionamento
  agendaSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const start = document.getElementById('working-hours-start').value;
    const end = document.getElementById('working-hours-end').value;
    const duration = parseInt(document.getElementById('slot-duration').value, 10);

    const reminderEnabled = document.getElementById('agenda-reminder-enabled').checked;
    const reminderHours = parseInt(document.getElementById('agenda-reminder-hours').value, 10);

    const success = await window.api.saveSettings({
      workingHoursStart: start,
      workingHoursEnd: end,
      slotDuration: duration,
      appointmentsReminderEnabled: reminderEnabled,
      appointmentsReminderHours: reminderHours
    });

    if (success) {
      currentSettings = await window.api.getSettings();
      alert('Configurações de funcionamento da agenda salvas com sucesso!');
    } else {
      alert('Erro ao salvar configurações da agenda.');
    }
  });

  // Salvar agendamento manual
  const manualForm = document.getElementById('manual-appointment-form');
  if (manualForm) {
    manualForm.addEventListener('submit', async (e) => {
      e.preventDefault();

      const name = document.getElementById('manual-client-name').value;
      const phone = document.getElementById('manual-client-phone').value;
      const date = document.getElementById('manual-date').value;
      const time = document.getElementById('manual-time').value;

      const result = await window.api.createAppointment({ name, phone, date, time });

      if (result.success) {
        alert('Compromisso agendado com sucesso!');
        manualForm.reset();
      } else {
        alert(`Erro ao criar agendamento: ${result.error}`);
      }
    });
  }

  // Ouvir atualizações de agendamentos realizados pela IA
  window.api.onAppointmentsUpdate((list) => {
    currentSettings.appointments = list;
    renderAppointmentsTable();
  });
}

function renderAppointmentsTable() {
  const tbody = document.getElementById('appointments-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const list = currentSettings?.appointments || [];

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table">Nenhum agendamento realizado pela IA ainda.</td></tr>`;
    return;
  }

  // Ordenar agendamentos por data e hora (mais próximos primeiro)
  list.sort((a, b) => {
    const dateCompare = a.date.localeCompare(b.date);
    if (dateCompare !== 0) return dateCompare;
    return a.time.localeCompare(b.time);
  });

  list.forEach(item => {
    const tr = document.createElement('tr');

    // Formatar data em PT-BR (DD/MM/AAAA)
    let formattedDate = item.date;
    try {
      const parts = item.date.split('-');
      if (parts.length === 3) {
        formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    } catch (e) {}

    // Badge de status
    let statusBadge = '';
    if (item.status === 'confirmed') {
      statusBadge = '<span class="status-badge" style="background:rgba(16,185,129,0.12); color:var(--success); border:1px solid rgba(16,185,129,0.25);">Confirmado</span>';
    } else {
      statusBadge = '<span class="status-badge" style="background:rgba(239,68,68,0.12); color:var(--danger); border:1px solid rgba(239,68,68,0.25);">Cancelado</span>';
    }

    const cleanPhone = item.phone.split('@')[0];

    tr.innerHTML = `
      <td><strong>${escapeHtml(item.name)}</strong></td>
      <td><span style="font-family:var(--font-mono); font-size:11px;">${cleanPhone}</span></td>
      <td>${formattedDate}</td>
      <td><strong>${item.time}</strong></td>
      <td>${statusBadge}</td>
      <td style="text-align: center;">
        ${item.status === 'confirmed' 
          ? `<button class="btn btn-secondary btn-sm btn-cancel-app" data-id="${item.id}" style="margin-right: 6px;">Cancelar</button>`
          : ''
        }
        <button class="btn btn-danger btn-sm btn-delete-app" data-id="${item.id}">Excluir</button>
      </td>
    `;

    // Binds
    if (item.status === 'confirmed') {
      tr.querySelector('.btn-cancel-app').addEventListener('click', () => cancelAppointment(item.id));
    }
    tr.querySelector('.btn-delete-app').addEventListener('click', () => deleteAppointment(item.id));

    tbody.appendChild(tr);
  });
}

async function cancelAppointment(id) {
  if (!confirm('Deseja realmente cancelar este agendamento? O horário será liberado para novos clientes.')) return;
  const success = await window.api.cancelAppointment(id);
  if (success) {
    currentSettings = await window.api.getSettings();
    renderAppointmentsTable();
  }
}

async function deleteAppointment(id) {
  if (!confirm('Tem certeza que deseja excluir este agendamento do histórico?')) return;
  const success = await window.api.deleteAppointment(id);
  if (success) {
    currentSettings = await window.api.getSettings();
    renderAppointmentsTable();
  }
}

// --- Agendador Nativo UI ---
function initSchedulerUI() {
  const typeSelect = document.getElementById('sched-type');
  const intervalValGroup = document.getElementById('sched-interval-val-group');
  const intervalUnitGroup = document.getElementById('sched-interval-unit-group');
  const dailyTimeGroup = document.getElementById('sched-daily-time-group');
  const schedForm = document.getElementById('scheduler-form');
  const btnCancel = document.getElementById('btn-cancel-sched-edit');

  // Alternar campos conforme tipo
  typeSelect.addEventListener('change', () => {
    if (typeSelect.value === 'interval') {
      intervalValGroup.style.display = 'flex';
      intervalUnitGroup.style.display = 'flex';
      dailyTimeGroup.style.display = 'none';
    } else {
      intervalValGroup.style.display = 'none';
      intervalUnitGroup.style.display = 'none';
      dailyTimeGroup.style.display = 'flex';
    }
  });

  // Salvar/Editar agendamento
  schedForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('sched-edit-id').value;
    const target = document.getElementById('sched-target').value.trim();
    const message = document.getElementById('sched-message').value;
    const type = document.getElementById('sched-type').value;
    const intervalValue = document.getElementById('sched-interval-val').value;
    const intervalUnit = document.getElementById('sched-interval-unit').value;
    const dailyTime = document.getElementById('sched-daily-time').value;
    const filePath = document.getElementById('sched-file-path').value;

    const scheduleData = {
      id: id || undefined,
      target,
      message,
      filePath,
      type,
      intervalValue,
      intervalUnit,
      dailyTime
    };

    const success = await window.api.saveSchedule(scheduleData);
    if (success) {
      currentSettings = await window.api.getSettings();
      renderSchedulesTable();
      resetSchedulerForm();
    } else {
      alert('Erro ao salvar agendamento.');
    }
  });

  // Lógica de arquivo para agendador
  const btnSelectSchedFile = document.getElementById('btn-select-sched-file');
  const spanSchedFileName = document.getElementById('sched-file-name');
  const btnRemoveSchedFile = document.getElementById('btn-remove-sched-file');
  const inputSchedFilePath = document.getElementById('sched-file-path');

  btnSelectSchedFile.addEventListener('click', async () => {
    const filePath = await window.api.selectFile();
    if (filePath) {
      inputSchedFilePath.value = filePath;
      const name = filePath.split(/[\\/]/).pop();
      spanSchedFileName.textContent = name;
      btnRemoveSchedFile.style.display = 'inline-block';
    }
  });

  btnRemoveSchedFile.addEventListener('click', () => {
    inputSchedFilePath.value = '';
    spanSchedFileName.textContent = 'Nenhum arquivo';
    btnRemoveSchedFile.style.display = 'none';
  });

  // Cancelar Edição
  btnCancel.addEventListener('click', resetSchedulerForm);

  // Ouvir atualizações de disparos em background
  window.api.onSchedulesUpdate((list) => {
    currentSettings.scheduledMessages = list;
    renderSchedulesTable();
  });
}

function renderSchedulesTable() {
  const tbody = document.getElementById('schedules-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const list = currentSettings?.scheduledMessages || [];

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table">Nenhum disparo agendado cadastrado ainda.</td></tr>`;
    return;
  }

  list.forEach(item => {
    const tr = document.createElement('tr');
    
    // Regra Text
    let ruleText = '';
    if (item.type === 'interval') {
      const unitLabel = item.intervalUnit === 'minutes' ? 'minuto(s)' : item.intervalUnit === 'hours' ? 'hora(s)' : 'dia(s)';
      ruleText = `A cada ${item.intervalValue} ${unitLabel}`;
    } else {
      ruleText = `Diário às ${item.dailyTime}`;
    }

    const lastRunText = item.lastRun ? new Date(item.lastRun).toLocaleTimeString() + ' ' + new Date(item.lastRun).toLocaleDateString() : 'Nunca';
    const nextRunText = item.enabled 
      ? (item.nextRun ? new Date(item.nextRun).toLocaleTimeString() + ' ' + new Date(item.nextRun).toLocaleDateString() : 'Pendente') 
      : '<span style="color:var(--text-muted);">Pausado</span>';

    const truncatedMessage = item.message.length > 50 ? item.message.substring(0, 47) + '...' : item.message;

    let messageDisplay = escapeHtml(truncatedMessage);
    if (item.filePath) {
      const fileName = item.filePath.split(/[\\/]/).pop();
      messageDisplay = `<div style="display:flex; align-items:center; gap:4px; margin-bottom: 2px;">
        <span style="font-size:14px; line-height: 1;">📎</span>
        <span style="font-size:11px; color:var(--primary-color); font-weight:600; text-decoration:underline;" title="${escapeHtml(item.filePath)}">${escapeHtml(fileName)}</span>
      </div>${messageDisplay ? '<div style="font-size:12px;">' + messageDisplay + '</div>' : ''}`;
    }

    tr.innerHTML = `
      <td><span style="font-size:11px;font-family:var(--font-mono);">${escapeHtml(item.target)}</span></td>
      <td title="${escapeHtml(item.message)}">${messageDisplay}</td>
      <td><strong>${ruleText}</strong></td>
      <td><span style="font-size:11px;color:var(--text-muted);">${lastRunText}</span></td>
      <td><span style="font-size:11px;font-weight:600;color:var(--primary-color);">${nextRunText}</span></td>
      <td style="text-align: center;">
        <button class="btn ${item.enabled ? 'btn-secondary' : 'btn-primary'} btn-sm btn-toggle" data-id="${item.id}" style="margin-right: 6px;">
          ${item.enabled ? 'Pausar' : 'Ativar'}
        </button>
        <button class="btn btn-secondary btn-sm btn-run" data-id="${item.id}" style="margin-right: 6px;">Testar</button>
        <button class="btn btn-secondary btn-sm btn-edit" data-id="${item.id}" style="margin-right: 6px;">Editar</button>
        <button class="btn btn-danger btn-sm btn-delete" data-id="${item.id}">Excluir</button>
      </td>
    `;

    // Ações
    tr.querySelector('.btn-toggle').addEventListener('click', () => toggleSchedule(item.id, !item.enabled));
    tr.querySelector('.btn-run').addEventListener('click', () => triggerScheduleNow(item.id));
    tr.querySelector('.btn-edit').addEventListener('click', () => editSchedule(item.id));
    tr.querySelector('.btn-delete').addEventListener('click', () => deleteSchedule(item.id));

    tbody.appendChild(tr);
  });
}

function resetSchedulerForm() {
  document.getElementById('sched-edit-id').value = '';
  document.getElementById('scheduler-form').reset();
  
  // Resetar visual do select
  document.getElementById('sched-type').value = 'interval';
  document.getElementById('sched-interval-val-group').style.display = 'flex';
  document.getElementById('sched-interval-unit-group').style.display = 'flex';
  document.getElementById('sched-daily-time-group').style.display = 'none';

  document.getElementById('sched-file-path').value = '';
  document.getElementById('sched-file-name').textContent = 'Nenhum arquivo';
  document.getElementById('btn-remove-sched-file').style.display = 'none';

  document.getElementById('btn-save-sched').textContent = 'Salvar Programação';
  document.getElementById('btn-cancel-sched-edit').style.display = 'none';
}

async function toggleSchedule(id, enabled) {
  const success = await window.api.toggleSchedule(id, enabled);
  if (success) {
    currentSettings = await window.api.getSettings();
    renderSchedulesTable();
  }
}

async function triggerScheduleNow(id) {
  try {
    const success = await window.api.triggerScheduleNow(id);
    if (success) {
      alert('Mensagem enviada com sucesso para teste!');
      currentSettings = await window.api.getSettings();
      renderSchedulesTable();
    }
  } catch (err) {
    alert(`Erro ao testar envio: ${err.message}`);
  }
}

function editSchedule(id) {
  const item = currentSettings.scheduledMessages.find(s => s.id === id);
  if (!item) return;

  document.getElementById('sched-edit-id').value = item.id;
  document.getElementById('sched-target').value = item.target;
  document.getElementById('sched-message').value = item.message;
  document.getElementById('sched-type').value = item.type;
  document.getElementById('sched-interval-val').value = item.intervalValue || 1;
  document.getElementById('sched-interval-unit').value = item.intervalUnit || 'hours';
  document.getElementById('sched-daily-time').value = item.dailyTime || '';

  if (item.filePath) {
    document.getElementById('sched-file-path').value = item.filePath;
    const name = item.filePath.split(/[\\/]/).pop();
    document.getElementById('sched-file-name').textContent = name;
    document.getElementById('btn-remove-sched-file').style.display = 'inline-block';
  } else {
    document.getElementById('sched-file-path').value = '';
    document.getElementById('sched-file-name').textContent = 'Nenhum arquivo';
    document.getElementById('btn-remove-sched-file').style.display = 'none';
  }

  // Forçar visibilidade dos campos
  const typeSelect = document.getElementById('sched-type');
  const intervalValGroup = document.getElementById('sched-interval-val-group');
  const intervalUnitGroup = document.getElementById('sched-interval-unit-group');
  const dailyTimeGroup = document.getElementById('sched-daily-time-group');

  if (item.type === 'interval') {
    intervalValGroup.style.display = 'flex';
    intervalUnitGroup.style.display = 'flex';
    dailyTimeGroup.style.display = 'none';
  } else {
    intervalValGroup.style.display = 'none';
    intervalUnitGroup.style.display = 'none';
    dailyTimeGroup.style.display = 'flex';
  }

  document.getElementById('btn-save-sched').textContent = 'Salvar Alterações';
  document.getElementById('btn-cancel-sched-edit').style.display = 'inline-flex';
}

async function deleteSchedule(id) {
  if (!confirm('Deseja realmente remover esta programação de disparo?')) return;

  const success = await window.api.deleteSchedule(id);
  if (success) {
    currentSettings = await window.api.getSettings();
    renderSchedulesTable();
    resetSchedulerForm();
  }
}

// --- Sistema de Cobrança UI ---
function initBillingUI() {
  const billForm = document.getElementById('billing-form');
  const btnCancel = document.getElementById('btn-cancel-bill-edit');
  const btnSave = document.getElementById('btn-save-bill');
  const btnSelectBillFile = document.getElementById('btn-select-bill-file');
  const btnRemoveBillFile = document.getElementById('btn-remove-bill-file');
  const spanBillFileName = document.getElementById('bill-file-name');
  const inputBillFilePath = document.getElementById('bill-file-path');

  const clientNameInput = document.getElementById('bill-client-name');
  const amountInput = document.getElementById('bill-amount');
  const dueDateInput = document.getElementById('bill-due-date');
  const templateSelect = document.getElementById('bill-template-select');
  const messageTextarea = document.getElementById('bill-message');

  // Lógica para aplicar template dinamicamente
  function applyBillingTemplate() {
    const templateType = templateSelect.value;
    if (templateType === 'custom') return;

    const name = clientNameInput.value.trim() || '[Nome do Cliente]';
    const amount = amountInput.value.trim() || '[Valor]';
    const rawDate = dueDateInput.value;
    
    let formattedDate = '[Data de Vencimento]';
    if (rawDate) {
      const parts = rawDate.split('-');
      if (parts.length === 3) {
        formattedDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }

    let templateText = '';
    if (templateType === 'reminder') {
      templateText = `Olá, *${name}*! 🔔\n\nEste é um lembrete amigável de que a sua fatura no valor de *${amount}* tem vencimento em *${formattedDate}*.\n\nCaso precise da segunda via ou do código de barras/PIX, por favor nos avise.\n\nAgradecemos a parceria! 🤝`;
    } else if (templateType === 'due_today') {
      templateText = `Olá, *${name}*! Hoje é o dia do vencimento da sua fatura no valor de *${amount}* (Vence em *${formattedDate}*).\n\nPara facilitar o pagamento, você pode utilizar o PIX ou o arquivo anexo.\n\nQualquer dúvida, estamos à disposição! 💳`;
    } else if (templateType === 'overdue') {
      templateText = `Atenção, *${name}*! ⚠️\n\nNotamos que a fatura no valor de *${amount}*, que venceu em *${formattedDate}*, ainda não consta como paga no nosso sistema.\n\nPedimos a gentileza de verificar. Caso já tenha realizado o pagamento, por favor desconsidere esta mensagem.\n\nFicamos no aguardo! 💼`;
    }

    messageTextarea.value = templateText;
  }

  // Ouvintes para atualização automática do template
  clientNameInput.addEventListener('input', applyBillingTemplate);
  amountInput.addEventListener('input', applyBillingTemplate);
  dueDateInput.addEventListener('change', applyBillingTemplate);
  templateSelect.addEventListener('change', applyBillingTemplate);

  // Se o usuário editar a mensagem manualmente, muda para "customizado" para não sobrescrever
  messageTextarea.addEventListener('input', () => {
    templateSelect.value = 'custom';
  });

  // Selecionar arquivo fatura/comprovante
  btnSelectBillFile.addEventListener('click', async () => {
    const filePath = await window.api.selectFile();
    if (filePath) {
      inputBillFilePath.value = filePath;
      const name = filePath.split(/[\\/]/).pop();
      spanBillFileName.textContent = name;
      btnRemoveBillFile.style.display = 'inline-block';
    }
  });

  // Remover arquivo fatura/comprovante
  btnRemoveBillFile.addEventListener('click', () => {
    inputBillFilePath.value = '';
    spanBillFileName.textContent = 'Nenhum arquivo';
    btnRemoveBillFile.style.display = 'none';
  });

  // Submeter formulário de salvamento/edição
  billForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const id = document.getElementById('bill-edit-id').value;
    const clientName = clientNameInput.value.trim();
    const clientPhone = document.getElementById('bill-client-phone').value.trim();
    const amount = amountInput.value.trim();
    const dueDate = dueDateInput.value;
    const dueTime = document.getElementById('bill-due-time').value;
    const message = messageTextarea.value;
    const filePath = inputBillFilePath.value;

    const billingData = {
      id: id || undefined,
      clientName,
      clientPhone,
      amount,
      dueDate,
      dueTime,
      message,
      filePath
    };

    const success = await window.api.saveBilling(billingData);
    if (success) {
      currentSettings = await window.api.getSettings();
      renderBillingsTable();
      resetBillingForm();
    } else {
      alert('Erro ao salvar fatura de cobrança.');
    }
  });

  // Cancelar Edição
  btnCancel.addEventListener('click', resetBillingForm);

  // Escutar atualizações de cobranças vindas do processo principal
  window.api.onBillingsUpdate((list) => {
    currentSettings.billings = list;
    renderBillingsTable();
  });
}

function renderBillingsTable() {
  const tbody = document.getElementById('billings-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const list = currentSettings?.billings || [];

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="empty-table">Nenhuma fatura de cobrança cadastrada ainda.</td></tr>`;
    return;
  }

  list.forEach(item => {
    const tr = document.createElement('tr');

    // Formatar data para exibição brasileira
    let displayDate = item.dueDate;
    if (item.dueDate) {
      const parts = item.dueDate.split('-');
      if (parts.length === 3) {
        displayDate = `${parts[2]}/${parts[1]}/${parts[0]}`;
      }
    }

    const dueText = `${displayDate} às ${item.dueTime || '09:00'}`;

    // Construção da tag de status
    let statusBadge = '';
    if (item.status === 'sent') {
      const sentTime = item.sentAt ? new Date(item.sentAt).toLocaleTimeString() + ' ' + new Date(item.sentAt).toLocaleDateString() : '';
      statusBadge = `<span class="badge" style="background-color: rgba(16, 185, 129, 0.15); color: var(--success); padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;" title="Enviado às ${sentTime}">Enviado</span>`;
    } else if (item.status === 'failed') {
      statusBadge = `<span class="badge" style="background-color: rgba(239, 68, 68, 0.15); color: var(--danger); padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;">Falhou</span>`;
    } else {
      statusBadge = `<span class="badge" style="background-color: rgba(245, 158, 11, 0.15); color: var(--warning); padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;">Pendente</span>`;
    }

    // Arquivo anexo se houver
    let fileDisplay = '';
    if (item.filePath) {
      const fileName = item.filePath.split(/[\\/]/).pop();
      fileDisplay = `<div style="display:flex; align-items:center; gap:4px; margin-bottom: 4px;" title="${escapeHtml(item.filePath)}">
        <span style="font-size:14px; line-height: 1;">📎</span>
        <span style="font-size:11px; color:var(--primary-color); font-weight:600; text-decoration:underline; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:100px;">${escapeHtml(fileName)}</span>
      </div>`;
    }

    tr.innerHTML = `
      <td><strong>${escapeHtml(item.clientName)}</strong></td>
      <td><span style="font-size:11px; font-family:var(--font-mono);">${escapeHtml(item.clientPhone)}</span></td>
      <td><strong style="color: var(--success);">${escapeHtml(item.amount)}</strong></td>
      <td><span style="font-size:11px; font-weight:500;">${dueText}</span></td>
      <td>
        <div style="display:flex; flex-direction:column; align-items:flex-start;">
          ${fileDisplay}
          ${statusBadge}
        </div>
      </td>
      <td style="text-align: center;">
        <button class="btn ${item.status === 'sent' ? 'btn-secondary' : 'btn-primary'} btn-sm btn-run-bill" data-id="${item.id}" style="margin-right: 6px;">
          ${item.status === 'sent' ? 'Reenviar' : 'Disparar Agora'}
        </button>
        <button class="btn btn-secondary btn-sm btn-edit-bill" data-id="${item.id}" style="margin-right: 6px;">Editar</button>
        <button class="btn btn-danger btn-sm btn-delete-bill" data-id="${item.id}">Excluir</button>
      </td>
    `;

    // Associar ouvintes
    tr.querySelector('.btn-run-bill').addEventListener('click', () => triggerBillingNow(item.id));
    tr.querySelector('.btn-edit-bill').addEventListener('click', () => editBilling(item.id));
    tr.querySelector('.btn-delete-bill').addEventListener('click', () => deleteBilling(item.id));

    tbody.appendChild(tr);
  });
}

function resetBillingForm() {
  document.getElementById('bill-edit-id').value = '';
  document.getElementById('billing-form').reset();
  document.getElementById('bill-due-time').value = '09:00';
  document.getElementById('bill-template-select').value = 'custom';

  document.getElementById('bill-file-path').value = '';
  document.getElementById('bill-file-name').textContent = 'Nenhum arquivo';
  document.getElementById('btn-remove-bill-file').style.display = 'none';

  document.getElementById('billing-form-title').textContent = 'Cadastrar Nova Cobrança';
  document.getElementById('btn-save-bill').textContent = 'Salvar Cobrança';
  document.getElementById('btn-cancel-bill-edit').style.display = 'none';
}

async function triggerBillingNow(id) {
  try {
    const success = await window.api.triggerBillingNow(id);
    if (success) {
      alert('Aviso de cobrança enviado com sucesso!');
      currentSettings = await window.api.getSettings();
      renderBillingsTable();
    }
  } catch (err) {
    alert(`Erro ao disparar cobrança: ${err.message}`);
  }
}

function editBilling(id) {
  const item = currentSettings.billings.find(b => b.id === id);
  if (!item) return;

  document.getElementById('bill-edit-id').value = item.id;
  document.getElementById('bill-client-name').value = item.clientName;
  document.getElementById('bill-client-phone').value = item.clientPhone;
  document.getElementById('bill-amount').value = item.amount;
  document.getElementById('bill-due-date').value = item.dueDate;
  document.getElementById('bill-due-time').value = item.dueTime || '09:00';
  document.getElementById('bill-message').value = item.message;
  document.getElementById('bill-template-select').value = 'custom'; // Deixar customizado para não sobrescrever os dados carregados

  if (item.filePath) {
    document.getElementById('bill-file-path').value = item.filePath;
    const name = item.filePath.split(/[\\/]/).pop();
    document.getElementById('bill-file-name').textContent = name;
    document.getElementById('btn-remove-bill-file').style.display = 'inline-block';
  } else {
    document.getElementById('bill-file-path').value = '';
    document.getElementById('bill-file-name').textContent = 'Nenhum arquivo';
    document.getElementById('btn-remove-bill-file').style.display = 'none';
  }

  document.getElementById('billing-form-title').textContent = 'Editar Cobrança';
  document.getElementById('btn-save-bill').textContent = 'Salvar Alterações';
  document.getElementById('btn-cancel-bill-edit').style.display = 'inline-flex';
}

async function deleteBilling(id) {
  if (!confirm('Deseja realmente remover esta cobrança?')) return;

  const success = await window.api.deleteBilling(id);
  if (success) {
    currentSettings = await window.api.getSettings();
    renderBillingsTable();
    resetBillingForm();
  }
}

// --- Robô de Vendas UI ---
function initSalesBotUI() {
  const toggle = document.getElementById('sales-bot-active-toggle');
  const nodeForm = document.getElementById('sales-node-form');
  const btnCancelNode = document.getElementById('btn-cancel-node-edit');
  const btnAddOption = document.getElementById('btn-add-node-option');
  const optionsList = document.getElementById('node-options-list');

  const clientNameInput = document.getElementById('node-name');
  const idValInput = document.getElementById('node-id-val');
  const textInput = document.getElementById('node-text');
  const actionSelect = document.getElementById('node-action');

  const btnSelectNodeFile = document.getElementById('btn-select-node-file');
  const btnRemoveNodeFile = document.getElementById('btn-remove-node-file');
  const spanNodeFileName = document.getElementById('node-file-name');
  const inputNodeFilePath = document.getElementById('node-file-path');

  // Selecionar arquivo
  btnSelectNodeFile.addEventListener('click', async () => {
    const filePath = await window.api.selectFile();
    if (filePath) {
      inputNodeFilePath.value = filePath;
      const name = filePath.split(/[\\/]/).pop();
      spanNodeFileName.textContent = name;
      btnRemoveNodeFile.style.display = 'inline-block';
    }
  });

  // Remover arquivo
  btnRemoveNodeFile.addEventListener('click', () => {
    inputNodeFilePath.value = '';
    spanNodeFileName.textContent = 'Nenhum arquivo';
    btnRemoveNodeFile.style.display = 'none';
  });

  // Toggle ativação do Robô
  toggle.addEventListener('change', async () => {
    const success = await window.api.saveSettings({ salesBotEnabled: toggle.checked });
    if (success) {
      currentSettings.salesBotEnabled = toggle.checked;
    } else {
      alert('Erro ao atualizar estado do Robô.');
      toggle.checked = !toggle.checked;
    }
  });

  // Botão Adicionar Dígito
  btnAddOption.addEventListener('click', () => {
    addOptionRow();
  });

  // Botão Cancelar Edição
  btnCancelNode.addEventListener('click', resetSalesNodeForm);

  // Envio do formulário
  nodeForm.addEventListener('submit', async (e) => {
    e.preventDefault();

    const editId = document.getElementById('node-edit-id').value;
    const name = clientNameInput.value.trim();
    const idVal = idValInput.value.trim().toLowerCase().replace(/\s+/g, '-');
    const text = textInput.value;
    const action = actionSelect.value;

    // Extrair opções do teclado do robô
    const options = [];
    const rows = optionsList.querySelectorAll('.option-row');
    rows.forEach(row => {
      const trigger = row.querySelector('.option-trigger').value.trim();
      const targetNodeId = row.querySelector('.option-target').value;
      if (trigger && targetNodeId) {
        options.push({ trigger, targetNodeId });
      }
    });

    const nodeData = {
      id: editId || idVal, // Se for edição usa o id original, senão usa o valor digitado
      name,
      text,
      action,
      filePath: inputNodeFilePath.value,
      options
    };

    // Validar se o ID não possui caracteres especiais inválidos
    if (!/^[a-z0-9_-]+$/.test(nodeData.id)) {
      alert('O ID do menu deve conter apenas letras minúsculas, números, hífens (-) ou subtrassos (_).');
      return;
    }

    try {
      const success = await window.api.saveSalesNode(nodeData);
      if (success) {
        currentSettings = await window.api.getSettings();
        renderNodesTable();
        resetSalesNodeForm();
      }
    } catch (err) {
      alert(`Erro ao salvar menu: ${err.message}`);
    }
  });

  // Ouvinte IPC para atualizações em tempo real
  window.api.onSalesFlowUpdate((salesFlow) => {
    currentSettings.salesFlow = salesFlow;
    renderNodesTable();
  });
}

function addOptionRow(triggerVal = '', targetVal = '') {
  const container = document.getElementById('node-options-list');
  const row = document.createElement('div');
  row.className = 'option-row';
  row.style = 'display: flex; gap: 8px; align-items: center;';

  // Opções dinâmicas para o dropdown
  let targetOptionsHTML = '<option value="" disabled selected>Ir para...</option>';
  const nodes = currentSettings?.salesFlow?.nodes || [];
  nodes.forEach(n => {
    targetOptionsHTML += `<option value="${escapeHtml(n.id)}">${escapeHtml(n.name)} (${escapeHtml(n.id)})</option>`;
  });

  row.innerHTML = `
    <input type="text" placeholder="Dígito" class="option-trigger" value="${escapeHtml(triggerVal)}" required style="width: 80px; padding: 6px; font-size: 13px;">
    <select class="option-target" required style="flex: 1; padding: 6px; font-size: 13px; color: var(--text-dark);">
      ${targetOptionsHTML}
    </select>
    <button type="button" class="btn btn-danger btn-sm btn-delete-option" style="padding: 4px 6px; margin: 0; line-height: 1;">✖</button>
  `;

  if (targetVal) {
    row.querySelector('.option-target').value = targetVal;
  }

  row.querySelector('.btn-delete-option').addEventListener('click', () => {
    row.remove();
  });

  container.appendChild(row);
}

function renderNodesTable() {
  const tbody = document.getElementById('nodes-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  const list = currentSettings?.salesFlow?.nodes || [];

  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="5" class="empty-table">Nenhum nó de menu cadastrado ainda.</td></tr>`;
    return;
  }

  list.forEach(item => {
    const tr = document.createElement('tr');

    // Formatar texto da ação
    let actionBadge = '';
    if (item.action === 'transfer_to_ai') {
      actionBadge = `<span class="badge" style="background-color: rgba(6, 182, 212, 0.15); color: var(--info); padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;">Transferir IA 🤖</span>`;
    } else if (item.action === 'transfer_to_human') {
      actionBadge = `<span class="badge" style="background-color: rgba(139, 92, 246, 0.15); color: #c084fc; padding: 4px 8px; border-radius: 4px; font-weight: 600; font-size: 11px;">Transferir Humano 👤</span>`;
    } else {
      actionBadge = `<span class="badge" style="background-color: rgba(255, 255, 255, 0.05); color: var(--text-muted); padding: 4px 8px; border-radius: 4px; font-weight: 500; font-size: 11px;">Apenas Mensagem</span>`;
    }

    // Formatar teclas associadas
    let optionsBadges = '';
    if (item.options && item.options.length > 0) {
      item.options.forEach(opt => {
        optionsBadges += `<span class="badge" style="background: rgba(255, 255, 255, 0.06); padding: 3px 6px; border-radius: 4px; font-size:10px; margin-right:4px; display:inline-block; margin-bottom: 2px;" title="Ir para nó ${opt.targetNodeId}"><strong>${escapeHtml(opt.trigger)}</strong> ➡️ ${escapeHtml(opt.targetNodeId)}</span>`;
      });
    } else {
      optionsBadges = `<span style="font-size:11px; color:var(--text-muted);">Sem opções</span>`;
    }

    const truncatedText = item.text.length > 80 ? item.text.substring(0, 77) + '...' : item.text;

    let messageDisplay = escapeHtml(truncatedText);
    if (item.filePath) {
      const fileName = item.filePath.split(/[\\/]/).pop();
      messageDisplay = `<div style="display:flex; align-items:center; gap:4px; margin-bottom: 2px;">
        <span style="font-size:14px; line-height: 1;">📎</span>
        <span style="font-size:11px; color:var(--primary-color); font-weight:600; text-decoration:underline;" title="${escapeHtml(item.filePath)}">${escapeHtml(fileName)}</span>
      </div><div style="font-size:12px;">${messageDisplay}</div>`;
    }

    tr.innerHTML = `
      <td>
        <div style="display:flex; flex-direction:column;">
          <span style="font-size:13px; font-weight:600; color:#fff;">${escapeHtml(item.name)}</span>
          <span style="font-size:10px; font-family:var(--font-mono); color:var(--text-muted); margin-top:2px;">ID: ${escapeHtml(item.id)}</span>
        </div>
      </td>
      <td title="${escapeHtml(item.text)}">${messageDisplay}</td>
      <td>${actionBadge}</td>
      <td>${optionsBadges}</td>
      <td style="text-align: center;">
        <button class="btn btn-secondary btn-sm btn-edit-node" data-id="${item.id}" style="margin-right: 6px;">Editar</button>
        <button class="btn btn-danger btn-sm btn-delete-node" data-id="${item.id}" ${item.id === 'main' ? 'disabled title="O menu principal não pode ser excluído"' : ''}>Excluir</button>
      </td>
    `;

    // Ouvintes
    tr.querySelector('.btn-edit-node').addEventListener('click', () => editSalesNode(item.id));
    tr.querySelector('.btn-delete-node').addEventListener('click', () => deleteSalesNode(item.id));

    tbody.appendChild(tr);
  });
}

function resetSalesNodeForm() {
  document.getElementById('node-edit-id').value = '';
  document.getElementById('sales-node-form').reset();
  
  // Re-habilitar o input ID
  const idInput = document.getElementById('node-id-val');
  idInput.disabled = false;
  idInput.style.opacity = '1';

  document.getElementById('node-file-path').value = '';
  document.getElementById('node-file-name').textContent = 'Nenhum arquivo';
  document.getElementById('btn-remove-node-file').style.display = 'none';

  document.getElementById('node-options-list').innerHTML = '';
  
  document.getElementById('sales-node-form-title').textContent = 'Cadastrar Novo Menu';
  document.getElementById('btn-save-node').textContent = 'Salvar Menu';
  document.getElementById('btn-cancel-node-edit').style.display = 'none';
}

function editSalesNode(id) {
  const item = currentSettings.salesFlow.nodes.find(n => n.id === id);
  if (!item) return;

  document.getElementById('node-edit-id').value = item.id;
  document.getElementById('node-name').value = item.name;
  
  const idInput = document.getElementById('node-id-val');
  idInput.value = item.id;
  
  // Impedir renomeação do nó principal 'main'
  if (item.id === 'main') {
    idInput.disabled = true;
    idInput.style.opacity = '0.5';
  } else {
    idInput.disabled = false;
    idInput.style.opacity = '1';
  }

  document.getElementById('node-text').value = item.text;
  document.getElementById('node-action').value = item.action || 'none';

  if (item.filePath) {
    document.getElementById('node-file-path').value = item.filePath;
    const name = item.filePath.split(/[\\/]/).pop();
    document.getElementById('node-file-name').textContent = name;
    document.getElementById('btn-remove-node-file').style.display = 'inline-block';
  } else {
    document.getElementById('node-file-path').value = '';
    document.getElementById('node-file-name').textContent = 'Nenhum arquivo';
    document.getElementById('btn-remove-node-file').style.display = 'none';
  }

  // Popular opções do teclado
  const optionsList = document.getElementById('node-options-list');
  optionsList.innerHTML = '';

  if (item.options && item.options.length > 0) {
    item.options.forEach(opt => {
      addOptionRow(opt.trigger, opt.targetNodeId);
    });
  }

  document.getElementById('sales-node-form-title').textContent = 'Editar Menu';
  document.getElementById('btn-save-node').textContent = 'Salvar Alterações';
  document.getElementById('btn-cancel-node-edit').style.display = 'inline-flex';
}

async function deleteSalesNode(id) {
  if (id === 'main') {
    alert('O menu principal (main) não pode ser excluído.');
    return;
  }
  if (!confirm('Tem certeza que deseja excluir este nó de menu? Links associados a ele em outros nós podem falhar.')) return;

  try {
    const success = await window.api.deleteSalesNode(id);
    if (success) {
      currentSettings = await window.api.getSettings();
      renderNodesTable();
      resetSalesNodeForm();
    }
  } catch (err) {
    alert(`Erro ao excluir nó: ${err.message}`);
  }
}

// --- Simulação Gráfica na Dashboard (Visual Premium) ---
function initDashboardChartSimulation() {
  const chartContainer = document.getElementById('activity-chart');
  
  // Atualizar aleatoriamente as barras do gráfico de atividade a cada 4 segundos para simular fluxo vivo
  setInterval(() => {
    if (chartContainer && document.getElementById('dashboard-panel').classList.contains('active')) {
      const bars = chartContainer.querySelectorAll('.bar');
      bars.forEach(bar => {
        const currentHeight = parseInt(bar.style.height || '20%', 10);
        // Modificar levemente a altura atual
        let nextHeight = currentHeight + (Math.random() > 0.5 ? 10 : -10);
        if (nextHeight < 10) nextHeight = 15;
        if (nextHeight > 95) nextHeight = 90;
        
        bar.style.height = `${nextHeight}%`;
      });
    }
  }, 4000);
}
