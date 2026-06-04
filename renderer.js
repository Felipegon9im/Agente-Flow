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
