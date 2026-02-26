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
    this.chatPaths = {
      'airsense-10': '/CPAP-devices/Airsense-10-User-Guide/chat.html',
      'fp-vitera': '/CPAP-devices/F&P-Vitera-Full-Face-User-Guide/chat.html',
      'climatelineair': '/CPAP-devices/Resmed-ClimateLineAir-User-Guide/chat.html'
    };

    this.applyGuideSpecificGreeting();
    this.renderDisclaimerCard();
    this.renderChatbotSwitcher();

    this.setupEventListeners();
  }

  getCurrentGuide() {
    const urlParams = new URLSearchParams(window.location.search);
    return (urlParams.get('guide') || 'airsense-10').toLowerCase();
  }

  buildChatUrl(guideKey) {
    const targetPath = this.chatPaths[guideKey] || this.chatPaths['airsense-10'];
    const url = new URL(targetPath, window.location.origin);

    const currentParams = new URLSearchParams(window.location.search);
    const family = (currentParams.get('family') || 'cpap').toLowerCase();

    url.searchParams.set('family', family);
    url.searchParams.set('guide', guideKey);
    url.searchParams.set('guides', guideKey);

    return `${url.pathname}${url.search}`;
  }

  renderChatbotSwitcher() {
    const container = document.querySelector('.container');
    const tipsSection = document.getElementById('chat-tips-title')?.closest('.card') || null;
    const footer = container ? container.querySelector('.footer') : null;
    const anchor = tipsSection || footer;
    if (!container || !anchor) return;

    const currentGuide = this.getCurrentGuide();
    const currentGuideName = this.guideNames[currentGuide] || 'selected device';

    const switcherCard = document.createElement('div');
    switcherCard.className = 'card';
    switcherCard.id = 'chatbot-switcher';
    switcherCard.style.backgroundColor = '#e8f5e9';
    switcherCard.style.border = '1px solid #a5d6a7';

    switcherCard.innerHTML = `
      <p style="margin: 0 0 10px;">
        This is the <strong>${currentGuideName}</strong> chatbot. Not the device you are looking for?
      </p>
      <div style="display:flex; gap:8px; flex-wrap:wrap; align-items:center;">
        <select id="chatbot-switch-select" style="padding: 8px 10px; border: 1px solid #ddd; border-radius: 6px; min-width: 240px; font-size: calc(14px * var(--text-scale));"></select>
        <a id="chatbot-switch-link" href="#" style="display:inline-block; padding: 9px 12px; background:#0066cc; color:#fff; text-decoration:none; border-radius:6px; font-size: calc(14px * var(--text-scale));">Open chatbot</a>
      </div>
    `;

    container.insertBefore(switcherCard, anchor);

    const select = document.getElementById('chatbot-switch-select');
    const link = document.getElementById('chatbot-switch-link');
    if (!select || !link) return;

    Object.entries(this.guideNames).forEach(([guideKey, label]) => {
      const option = document.createElement('option');
      option.value = guideKey;
      option.textContent = label;
      if (guideKey === currentGuide) {
        option.selected = true;
      }
      select.appendChild(option);
    });

    const updateLink = () => {
      link.href = this.buildChatUrl(select.value);
    };

    updateLink();
    select.addEventListener('change', updateLink);
  }

  renderDisclaimerCard() {
    const container = document.querySelector('.container');
    const heading = container ? container.querySelector('h1') : null;
    if (!container || !heading || document.getElementById('chatbot-disclaimer')) return;

    const disclaimerCard = document.createElement('div');
    disclaimerCard.className = 'card';
    disclaimerCard.id = 'chatbot-disclaimer';
    disclaimerCard.style.backgroundColor = '#fff8e1';
    disclaimerCard.style.border = '1px solid #ffecb3';

    disclaimerCard.innerHTML = `
      <p style="margin:0;">
        <strong>Disclaimer:</strong> This is a chatbot and the information provided may not always be accurate. Please consult the user guide or speak with a health professional for accurate advice.
      </p>
    `;

    heading.insertAdjacentElement('afterend', disclaimerCard);
  }

  applyGuideSpecificGreeting() {
    if (!this.initialMessage) return;
    const guide = this.getCurrentGuide();
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

    if (window.MTGTelemetry) {
      window.MTGTelemetry.track('chat_submit', {
        chat_message: userMessage.slice(0, 500)
      });
    }

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

      if (window.MTGTelemetry) {
        window.MTGTelemetry.track('chat_response', {
          response_length: String(data.response || '').length,
          response_message: String(data.response || '').slice(0, 4000)
        });
      }
    } catch (error) {
      console.error('Chat error:', error);
      if (window.MTGTelemetry) {
        window.MTGTelemetry.track('chat_error', {
          error_message: String(error.message || 'unknown error').slice(0, 200)
        });
      }
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
