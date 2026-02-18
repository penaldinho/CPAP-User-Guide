// Chatbot frontend functionality
class ChatBot {
  constructor() {
    this.messagesContainer = document.getElementById('chat-messages');
    this.inputField = document.getElementById('chat-input');
    this.sendBtn = document.getElementById('chat-send-btn');
    this.loadingDiv = document.getElementById('chat-loading');
    this.initialMessage = document.getElementById('chat-initial-message');
    this.isLoading = false;
    this.guideNames = {
      'airsense-10': 'AirSense 10',
      'fp-vitera': 'F&P Vitera Full Face Mask',
      'climatelineair': 'ResMed ClimateLineAir'
    };

    this.applyGuideSpecificGreeting();

    this.setupEventListeners();
  }

  applyGuideSpecificGreeting() {
    if (!this.initialMessage) return;
    const urlParams = new URLSearchParams(window.location.search);
    const guide = (urlParams.get('guide') || 'airsense-10').toLowerCase();
    const guideName = this.guideNames[guide] || 'selected guide';

    this.initialMessage.textContent = `Hi! I'm your ${guideName} assistant. Ask any questions about setup, therapy, maintenance, or troubleshooting and I'll answer using this user guide.`;
  }

  escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  formatAssistantText(text) {
    let content = String(text || '').replace(/\r\n/g, '\n').trim();

    if (!content.includes('\n') && /\s\d+\.\s/.test(content)) {
      content = content.replace(/\s(\d+\.\s)/g, '\n$1');
    }

    const escaped = this.escapeHtml(content);
    const withBold = escaped.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');

    const lines = withBold.split('\n').map((line) => line.trimEnd());
    const parts = [];
    let i = 0;

    while (i < lines.length) {
      const line = lines[i].trim();
      if (!line) {
        i += 1;
        continue;
      }

      const headingMatch = line.match(/^#{1,3}\s+(.+)$/);
      if (headingMatch) {
        parts.push(`<h3 style="margin:8px 0 6px; font-size:14px;">${headingMatch[1]}</h3>`);
        i += 1;
        continue;
      }

      if (/^\d+\.\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^\d+\.\s+/, ''));
          i += 1;
        }
        parts.push(`<ol style="margin:6px 0 8px 18px; padding:0;">${items.map((item) => `<li style="margin:4px 0;">${item}</li>`).join('')}</ol>`);
        continue;
      }

      if (/^[-*]\s+/.test(line)) {
        const items = [];
        while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
          items.push(lines[i].trim().replace(/^[-*]\s+/, ''));
          i += 1;
        }
        parts.push(`<ul style="margin:6px 0 8px 18px; padding:0;">${items.map((item) => `<li style="margin:4px 0;">${item}</li>`).join('')}</ul>`);
        continue;
      }

      const paragraphLines = [];
      while (i < lines.length && lines[i].trim() && !/^#{1,3}\s+/.test(lines[i].trim()) && !/^\d+\.\s+/.test(lines[i].trim()) && !/^[-*]\s+/.test(lines[i].trim())) {
        paragraphLines.push(lines[i].trim());
        i += 1;
      }
      parts.push(`<p style="margin:6px 0;">${paragraphLines.join(' ')}</p>`);
    }

    return parts.join('');
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

    const urlParams = new URLSearchParams(window.location.search);
    const guide = urlParams.get('guide') || 'airsense-10';
    const family = (urlParams.get('family') || 'cpap').toLowerCase();
    const guidesParam = (urlParams.get('guides') || '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);
    const storedSetupGuides = (() => {
      try {
        const familyProfile = JSON.parse(localStorage.getItem(`setup-profile-${family}`) || '{}');
        if (Array.isArray(familyProfile.guides) && familyProfile.guides.length) {
          return familyProfile.guides
            .map((item) => String(item || '').trim().toLowerCase())
            .filter(Boolean);
        }
        const setup = JSON.parse(localStorage.getItem('cpap-my-setup-v1') || '{}');
        const legacyGuides = Array.isArray(setup.guides) && setup.guides.length
          ? setup.guides
          : [setup.device, setup.mask, setup.accessory];
        return legacyGuides
          .map((item) => String(item || '').trim().toLowerCase())
          .filter(Boolean);
      } catch {
        return [];
      }
    })();
    const guides = [...new Set(guidesParam.length ? guidesParam : storedSetupGuides)];

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
        body: JSON.stringify({ message: userMessage, guide, guides, family })
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
    } else if (sender === 'assistant') {
      bubble.innerHTML = this.formatAssistantText(text);
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
