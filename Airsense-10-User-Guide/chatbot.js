// Chatbot frontend functionality
class ChatBot {
  constructor() {
    this.messagesContainer = document.getElementById('chat-messages');
    this.inputField = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('chat-send-btn');
    this.loadingDiv = document.getElementById('chat-loading');
    this.isLoading = false;
    this.chatDisabled = false;

    this.checkChatAvailability();
    this.setupEventListeners();
  }

  async checkChatAvailability() {
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    if (isLocalHost) return; // Always available on localhost

    const apiUrl = 'https://chat.medtechguides.uk/api/health';
    
    try {
      const response = await fetch(apiUrl, { method: 'GET', signal: AbortSignal.timeout(5000) });
      if (!response.ok) throw new Error('Health check failed');
    } catch (error) {
      this.chatDisabled = true;
      this.disableChatWithMessage();
    }
  }

  disableChatWithMessage() {
    this.messagesContainer.innerHTML = '';
    this.addMessage(
      '<strong>Chat Assistant Unavailable</strong><br><br>' +
      'The chat assistant is currently unavailable on corporate networks with SSL inspection (such as Zscaler).<br><br>' +
      'You can still access all manual content through the navigation menu. For chat functionality, please access this site from a personal device or contact your IT department to whitelist <code>chat.medtechguides.uk</code>.',
      'assistant',
      true
    );
    this.inputField.disabled = true;
    this.sendBtn.disabled = true;
    this.inputField.placeholder = 'Chat unavailable on this network';
  }

  setupEventListeners() {
    this.sendBtn.addEventListener('click', () => this.sendMessage());
    this.inputField.addEventListener('keypress', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        this.sendMessage();
      }
    });
  }

  async sendMessage() {
    const userMessage = this.inputField.value.trim();
    if (!userMessage || this.isLoading || this.chatDisabled) return;

    const urlParams = new URLSearchParams(window.location.search);
    const guide = urlParams.get('guide') || 'airsense-10';

    // Add user message to chat
    this.addMessage(userMessage, 'user');
    this.inputField.value = '';
    this.inputField.focus();

    // Show loading state
    this.isLoading = true;
    this.sendBtn.disabled = true;
    this.loadingDiv.style.display = 'block';

    try {
      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const apiUrl = isLocalHost ? '/api/chat' : 'https://chat.medtechguides.uk/api/chat';
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage, guide })
      });

      if (!response.ok) {
        throw new Error('Failed to get response from assistant');
      }

      const data = await response.json();
      this.addMessage(data.response, 'assistant');
    } catch (error) {
      console.error('Chat error:', error);
      
      // Check if this is a network/SSL error
      if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
        this.chatDisabled = true;
        this.disableChatWithMessage();
      } else {
        this.addMessage(
          `Sorry, I encountered an error: ${error.message}. Please try again.`,
          'assistant'
        );
      }
    } finally {
      this.isLoading = false;
      this.sendBtn.disabled = this.chatDisabled;
      this.loadingDiv.style.display = 'none';
    }
  }

  addMessage(text, sender, isHtml = false) {
    const messageDiv = document.createElement('div');
    messageDiv.className = `chat-message ${sender}`;

    const bubble = document.createElement('div');
    bubble.className = 'chat-bubble';
    
    if (isHtml) {
      bubble.innerHTML = text;
    } else {
      bubble.textContent = text;
    }

    messageDiv.appendChild(bubble);
    this.messagesContainer.appendChild(messageDiv);

    // Auto-scroll to bottom
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}

// Initialize chatbot when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  new ChatBot();
});
