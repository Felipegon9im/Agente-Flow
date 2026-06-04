# ZapFlow AI ⚡🤖

O **ZapFlow AI** é um aplicativo nativo para Windows desenvolvido em Electron que transforma seu WhatsApp em um atendente inteligente alimentado pela Inteligência Artificial do Google Gemini, integrado de forma bidirecional com fluxos de automação do **N8N**.

---

## 🚀 Como Executar o Projeto

Certifique-se de ter o **Node.js** (versão 18 ou superior) instalado em sua máquina Windows.

1. **Instalar Dependências**:
   Abra o prompt de comando (CMD ou PowerShell) na pasta do projeto e execute:
   ```bash
   npm install
   ```

2. **Iniciar o Aplicativo**:
   Para rodar o software em ambiente de desenvolvimento, execute:
   ```bash
   npm start
   ```

---

## ⚙️ Configuração das Integrações

### 1. Cérebro de IA (Google Gemini)
* Vá para a aba **Cérebro IA** no menu lateral.
* Insira sua chave API do Google Gemini. Se não possuir uma, você pode gerá-la gratuitamente no [Google AI Studio](https://aistudio.google.com/).
* Escolha o modelo desejado (recomendamos o `Gemini 2.0 Flash` pela velocidade de resposta).
* Escreva as instruções do seu agente (Prompt de Sistema). Exemplo:
  > *"Você é a Sofia, assistente virtual da Doceria Gourmet. Responda de forma simpática, use emojis moderadamente, fale sobre nossos doces e agende pedidos quando o cliente desejar."*
* Defina a porta do servidor Express (padrão: `3003`).

### 2. WhatsApp
* Vá para a aba **Conexão WhatsApp**.
* Se o WhatsApp não iniciar automaticamente, clique em **Conectar WhatsApp**.
* Um QR Code será gerado na tela. Abra o WhatsApp no seu celular, vá em *Aparelhos Conectados > Conectar um aparelho* e escaneie o código.
* Após a conexão ser estabelecida, o aplicativo exibirá a tela de sucesso. Suas credenciais são salvas localmente para que você não precise escanear o QR Code novamente ao reabrir o app.

### 3. Integração com N8N (Chamada de Ferramentas - Entrada)
Você pode cadastrar webhooks do N8N como "Ferramentas" que a IA pode acionar sozinha se notar que o cliente quer executar uma ação.

**Exemplo de Configuração:**
* **Nome**: `cadastrar_lead`
* **Descrição**: `Use essa ferramenta quando o cliente fornecer o nome, e-mail e telefone querendo saber mais sobre nossos serviços.`
* **URL do Webhook**: `https://seu-n8n.com/webhook/cadastrar-lead` (URL gerada pelo nó de Webhook do N8N)
* **Método**: `POST`
* **Campos/Parâmetros**: `nome, email, telefone`

**Como funciona no N8N:**
1. Crie um fluxo no N8N iniciado por um nó **Webhook** (configurado como POST).
2. O ZapFlow AI enviará os dados estruturados no formato JSON no corpo da requisição (`body`). Exemplo:
   ```json
   {
     "nome": "João Silva",
     "email": "joao@email.com",
     "telefone": "+5511999999999"
   }
   ```
3. O N8N processa a informação (adiciona no CRM, envia e-mail, insere em planilhas) e deve responder ao webhook (ex: com um JSON contendo `{"status": "sucesso"}`). A IA lê esse retorno para formular a resposta final ao cliente.

### 4. API Local Bidirecional (N8N -> WhatsApp - Saída)
O aplicativo executa um servidor web local. Qualquer sistema ou fluxo do N8N pode disparar mensagens ativamente no WhatsApp do usuário conectado fazendo uma requisição HTTP.

* **Método**: `POST`
* **Endpoint**: `http://localhost:3003/send-message`
* **Headers**: `Content-Type: application/json`
* **Corpo (JSON)**:
  ```json
  {
    "phone": "5511999999999",
    "message": "Olá! Seu pedido foi enviado e já está a caminho. 📦🚚"
  }
  ```

---

## 🛠️ Tecnologias Utilizadas

* **Electron**: Criação de aplicativo nativo desktop para Windows.
* **@whiskeysockets/baileys**: Motor do WhatsApp rápido, estável e puramente em JavaScript (sem Puppeteer).
* **@google/genai**: SDK oficial do Google Gemini para processamento de texto e Function Calling.
* **Express.js**: Servidor HTTP local para permitir disparos de mensagens do N8N para o app.
* **CSS Fluent Design / Glassmorphism**: Interface visual premium no estilo Windows 11 com modo escuro nativo e transições dinâmicas.
