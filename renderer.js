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

  // Formulário de envio de mensagem de teste
  const testForm = document.getElementById('test-message-form');
  testForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const phoneInput = document.getElementById('test-phone');
    const msgInput = document.getElementById('test-message');
    const btnSend = document.getElementById('btn-send-test');

    const phone = phoneInput.value.trim();
    const message = msgInput.value.trim();

    btnSend.disabled = true;
    btnSend.textContent = 'Enviando...';

    try {
      await window.api.sendManualMessage(phone, message);
      alert('Mensagem de teste enviada com sucesso!');
      msgInput.value = '';
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

    const success = await window.api.saveSettings({
      workingHoursStart: start,
      workingHoursEnd: end,
      slotDuration: duration
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

    const scheduleData = {
      id: id || undefined,
      target,
      message,
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

    tr.innerHTML = `
      <td><span style="font-size:11px;font-family:var(--font-mono);">${escapeHtml(item.target)}</span></td>
      <td title="${escapeHtml(item.message)}">${escapeHtml(truncatedMessage)}</td>
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
