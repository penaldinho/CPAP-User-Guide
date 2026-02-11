// Chatbot frontend functionality
class ChatBot {
  constructor() {
    this.messagesContainer = document.getElementById('chat-messages');
    this.inputField = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('chat-send-btn');
    this.loadingDiv = document.getElementById('chat-loading');
    this.isLoading = false;

    this.setupEventListeners();
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
    if (!userMessage || this.isLoading) return;

    // Add user message to chat
    this.addMessage(userMessage, 'user');
    this.inputField.value = '';
    this.inputField.focus();

    // Show loading state
    this.isLoading = true;
    this.sendBtn.disabled = true;
    this.loadingDiv.style.display = 'block';

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: userMessage })
      });

      if (!response.ok) {
        throw new Error('Failed to get response from assistant');
      }

      const data = await response.json();
      this.addMessage(data.response, 'assistant');
    } catch (error) {
      console.error('Chat error:', error);
      this.addMessage(
        `<div class="chat-error">Sorry, I encountered an error: ${error.message}. Please make sure the chat server is running.</div>`,
        'assistant',
        true
      );
    } finally {
      this.isLoading = false;
      this.sendBtn.disabled = false;
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
