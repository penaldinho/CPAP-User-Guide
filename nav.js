function injectNav(currentPageFile) {
  const normalizeSpeechText = (text) => {
    if (!text) return text;
    return text.replace(/\bCPAP\b/g, 'see pap');
  };

  // Load text size preference
  const textSize = localStorage.getItem('text-size') || 'medium';
  document.body.classList.add(`text-size-${textSize}`);

  const navItems = [
    { href: 'welcome.html', label: 'Welcome' },
    { href: 'index.html', label: 'Contents' },
    { href: 'about-device.html', label: 'About your device' },
    { href: 'setup.html', label: 'Setup' },
    { href: 'starting-therapy.html', label: 'Starting therapy' },
    { href: 'stopping-therapy.html', label: 'Stopping therapy' },
    { href: 'power-save-mode.html', label: 'Power save mode' },
    { href: 'my-options.html', label: 'My Options' },
    { href: 'caring-for-your-device.html', label: 'Caring for your device' },
    { href: 'therapy-data.html', label: 'Therapy data' },
    { href: 'travelling.html', label: 'Travelling' },
    { href: 'troubleshooting.html', label: 'Troubleshooting' },
    { href: 'reassembling-parts.html', label: 'Reassembling parts' },
    { href: 'technical-specifications.html', label: 'Technical specifications' },
    { href: 'symbols.html', label: 'Symbols' },
    { href: 'environmental-information.html', label: 'Environmental information' },
    { href: 'servicing.html', label: 'Servicing' },
    { href: 'limited-warranty.html', label: 'Limited warranty' },
    { href: 'further-information.html', label: 'Further information' }
  ];

  // Load highlight script if not already loaded
  if (!window.highlightScriptLoaded) {
    const highlightScript = document.createElement('script');
    highlightScript.src = 'highlight.js';
    document.body.appendChild(highlightScript);
    window.highlightScriptLoaded = true;
  }

  const navContainer = document.querySelector('.nav');
  if (navContainer) {
    const persistedCollapsed = localStorage.getItem('nav-collapsed') === 'true';
    document.body.classList.toggle('nav-collapsed', persistedCollapsed);
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const chatHref = isLocalHost && window.location.port !== '3000'
      ? 'http://localhost:3000/chat.html'
      : 'chat.html';
    const chatCurrent = currentPageFile === 'chat' ? ' aria-current="page"' : '';
    const searchCurrent = currentPageFile === 'search' ? ' aria-current="page"' : '';

    navContainer.innerHTML = `
      <div class="nav-text-size-controls">
        <span class="nav-settings-label">Text size:</span>
        <button class="nav-text-size-btn" data-size="small" aria-label="Small text">A</button>
        <button class="nav-text-size-btn" data-size="medium" aria-label="Medium text">A</button>
        <button class="nav-text-size-btn" data-size="large" aria-label="Large text">A</button>
      </div>
      <div class="nav-list">
        <a class="nav-link-primary" href="${chatHref}"${chatCurrent}><span class="nav-link-icon" aria-hidden="true">💬</span>Chat Assistant</a>
        <a class="nav-link-primary" href="search.html"${searchCurrent}><span class="nav-link-icon" aria-hidden="true">🔍</span>Search</a>
        ${navItems.map(item => {
          const isCurrent = item.href === currentPageFile + '.html';
          const ariaCurrent = isCurrent ? ' aria-current="page"' : '';
          return `<a href="${item.href}"${ariaCurrent}>${item.label}</a>`;
        }).join('\n        ')}
      </div>
      <div class="nav-actions" aria-label="Quick actions">
        <a class="nav-action-btn nav-action-chat" href="${chatHref}" aria-label="Chat assistant">
          <span class="nav-action-icon" aria-hidden="true">💬</span>
          <span class="tooltip" role="tooltip">Chat assistant</span>
        </a>
        <a class="nav-action-btn nav-action-search" href="search.html" aria-label="Search">
          <span class="nav-action-icon" aria-hidden="true">🔍</span>
          <span class="tooltip" role="tooltip">Search</span>
        </a>
      </div>
    `;
    
    // Initialize nav text size controls
    const navTextSizeBtns = navContainer.querySelectorAll('.nav-text-size-btn');
    navTextSizeBtns.forEach((btn) => {
      const size = btn.getAttribute('data-size');
      if (size === textSize) {
        btn.classList.add('active');
      }
      btn.addEventListener('click', () => {
        document.body.className = document.body.className.replace(/text-size-\w+/g, '');
        document.body.classList.add(`text-size-${size}`);
        localStorage.setItem('text-size', size);
        document.querySelectorAll('.nav-text-size-btn, .text-size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // Sync header controls if they exist
        const headerBtn = document.querySelector(`.text-size-btn[data-size="${size}"]`);
        if (headerBtn) headerBtn.classList.add('active');
      });
    });

    if (!navContainer.querySelector('.nav-toggle-desktop')) {
      const desktopToggle = document.createElement('button');
      desktopToggle.className = 'nav-toggle nav-toggle-desktop';
      desktopToggle.type = 'button';
      desktopToggle.setAttribute('aria-expanded', String(!persistedCollapsed));
      desktopToggle.innerHTML = '<span class="nav-toggle-icon" aria-hidden="true"></span><span class="nav-toggle-label">Menu</span><span class="tooltip" role="tooltip">Menu</span>';
      desktopToggle.addEventListener('click', () => {
        const isCollapsed = document.body.classList.toggle('nav-collapsed');
        localStorage.setItem('nav-collapsed', String(isCollapsed));
        desktopToggle.setAttribute('aria-expanded', String(!isCollapsed));
        const handleIcon = document.querySelector('.nav-handle-icon');
        if (handleIcon) {
          handleIcon.textContent = isCollapsed ? '❯' : '❮';
        }
      });
      navContainer.prepend(desktopToggle);
    }

    if (!navContainer.querySelector('.nav-handle')) {
      const handle = document.createElement('button');
      handle.className = 'nav-handle';
      handle.type = 'button';
      handle.setAttribute('aria-label', 'Toggle navigation');
      handle.innerHTML = '<span class="nav-handle-icon" aria-hidden="true">❮</span>';
      handle.addEventListener('click', () => {
        const isCollapsed = document.body.classList.toggle('nav-collapsed');
        localStorage.setItem('nav-collapsed', String(isCollapsed));
        handle.querySelector('.nav-handle-icon').textContent = isCollapsed ? '❯' : '❮';
      });
      navContainer.appendChild(handle);
    }

    const handleIcon = document.querySelector('.nav-handle-icon');
    if (handleIcon) {
      const isCollapsed = document.body.classList.contains('nav-collapsed');
      handleIcon.textContent = isCollapsed ? '❯' : '❮';
    }
  }

  // Inject search box into header
  const header = document.querySelector('.header');
  if (header) {
    const brand = header.querySelector('.brand');
    if (brand) {
      brand.textContent = 'AirSense 10';
    }

    const subbrand = header.querySelector('.subbrand');
    if (subbrand) {
      subbrand.textContent = 'User Guide';
    }

    if (!header.querySelector('.header-logo')) {
      const logo = document.createElement('img');
      logo.className = 'header-logo';
      logo.src = 'images/resmed.png';
      logo.alt = 'ResMed logo';
      header.insertBefore(logo, header.firstChild);
    }

    const headerLogo = header.querySelector('.header-logo');
    const headerLinkTargets = [headerLogo, brand, subbrand].filter(Boolean);
    headerLinkTargets.forEach((target) => {
      target.setAttribute('role', 'link');
      target.setAttribute('tabindex', '0');
      target.addEventListener('click', () => {
        window.location.href = 'welcome.html';
      });
      target.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          window.location.href = 'welcome.html';
        }
      });
    });
    // Add mobile nav toggle
    const searchForm = document.createElement('form');
    searchForm.id = 'header-search-form';
    searchForm.className = 'header-search';
    searchForm.innerHTML = `
      <button type="button" class="search-toggle" aria-label="Open search">
        <span class="search-icon" aria-hidden="true">&#128269;</span>
        <span class="visually-hidden">Open search</span>
      </button>
      <div class="search-drawer" role="dialog" aria-label="Search">
        <input 
          type="text" 
          id="header-search-input" 
          class="search-input"
          placeholder="Search for..." 
          autocomplete="off"
        />
        <button type="submit" class="search-submit" aria-label="Search">
          <span class="search-icon" aria-hidden="true">&#128269;</span>
        </button>
        <button type="button" class="search-close" aria-label="Close search">&times;</button>
      </div>
    `;

    // Only add if not already present
    if (!header.querySelector('#header-search-form')) {
      header.appendChild(searchForm);
    }

    if (!header.querySelector('.text-size-controls')) {
      const textSizeControls = document.createElement('div');
      textSizeControls.className = 'text-size-controls';
      textSizeControls.innerHTML = `
        <button class="text-size-btn" data-size="small" aria-label="Small text">A</button>
        <button class="text-size-btn" data-size="medium" aria-label="Medium text">A</button>
        <button class="text-size-btn" data-size="large" aria-label="Large text">A</button>
      `;
      header.appendChild(textSizeControls);

      textSizeControls.querySelectorAll('.text-size-btn').forEach((btn) => {
        const size = btn.getAttribute('data-size');
        if (size === textSize) {
          btn.classList.add('active');
        }
        btn.addEventListener('click', () => {
          document.body.className = document.body.className.replace(/text-size-\w+/g, '');
          document.body.classList.add(`text-size-${size}`);
          localStorage.setItem('text-size', size);
          document.querySelectorAll('.text-size-btn, .nav-text-size-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          // Sync nav controls if they exist
          const navBtn = document.querySelector(`.nav-text-size-btn[data-size="${size}"]`);
          if (navBtn) navBtn.classList.add('active');
        });
      });
    }

    if (!header.querySelector('.chat-button')) {
      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const chatHref = isLocalHost && window.location.port !== '3000'
        ? 'http://localhost:3000/chat.html'
        : 'chat.html';
      const chatButton = document.createElement('a');
      chatButton.className = 'chat-button';
      chatButton.href = chatHref;
      chatButton.setAttribute('aria-label', 'Chat Assistant');
      chatButton.innerHTML = '<span class="chat-icon" aria-hidden="true">💬</span><span class="visually-hidden">Chat Assistant</span><span class="tooltip" role="tooltip">Chat assistant</span>';
      header.appendChild(chatButton);
    }

    if (!header.querySelector('.nav-toggle')) {
      const toggle = document.createElement('button');
      toggle.className = 'nav-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.innerHTML = '<span class="nav-toggle-icon" aria-hidden="true"></span><span class="nav-toggle-label">Menu</span><span class="tooltip" role="tooltip">Menu</span>';
      toggle.addEventListener('click', () => {
        const isDesktop = window.matchMedia('(min-width: 900px)').matches;
        if (isDesktop) {
          const isCollapsed = document.body.classList.toggle('nav-collapsed');
          toggle.setAttribute('aria-expanded', String(!isCollapsed));
          const handleIcon = document.querySelector('.nav-handle-icon');
          if (handleIcon) {
            handleIcon.textContent = isCollapsed ? '❯' : '❮';
          }
        } else {
          const isOpen = document.body.classList.toggle('nav-open');
          toggle.setAttribute('aria-expanded', String(isOpen));
          if (isOpen) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
        }
      });
      header.appendChild(toggle);
    }

    // Add search form handler
    const toggleButton = searchForm.querySelector('.search-toggle');
    if (toggleButton) {
      toggleButton.addEventListener('click', () => {
        const isOpen = searchForm.classList.toggle('search-open');
        if (isOpen) {
          const input = searchForm.querySelector('#header-search-input');
          input && input.focus();
        }
      });
    }

    const closeButton = searchForm.querySelector('.search-close');
    if (closeButton) {
      closeButton.addEventListener('click', () => {
        searchForm.classList.remove('search-open');
      });
    }

    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const query = document.getElementById('header-search-input').value;
      if (query.trim()) {
        window.location.href = `search.html?q=${encodeURIComponent(query)}`;
      }
    });
  }

  const initCardTts = () => {
    const synth = window.speechSynthesis;
    const cards = document.querySelectorAll('details.card');
    let activeButton = null;
    let activeHighlightEl = null;
    let speechToken = 0;

    const getCleanText = (element) => {
      if (!element) return '';
      const clone = element.cloneNode(true);
      clone.querySelectorAll('.card-tts-btn, .card-tts-icon').forEach(node => node.remove());
      return clone.textContent.trim();
    };

    const splitIntoSentences = (text) => {
      return text
        .split(/(?<=[.!?])\s+/)
        .map(sentence => sentence.trim())
        .filter(Boolean);
    };

    const clearHighlight = () => {
      if (activeHighlightEl) {
        activeHighlightEl.classList.remove('tts-highlight');
        activeHighlightEl = null;
      }
    };

    const resetButtonState = (button) => {
      if (!button) return;
      button.classList.remove('active');
      const icon = button.querySelector('.card-tts-icon');
      if (icon) icon.textContent = '🔊';
      button.dataset.speaking = 'false';
    };

    const stopAllTts = () => {
      speechToken += 1;
      synth.cancel();
      clearHighlight();
      if (activeButton) {
        resetButtonState(activeButton);
        activeButton = null;
      }
    };

    window.__stopAllTts = stopAllTts;

    const speakSegments = (segments, button) => {
      if (!segments || segments.length === 0) return;

      stopAllTts();
      const token = speechToken;

      button.classList.add('active');
      const icon = button.querySelector('.card-tts-icon');
      if (icon) icon.textContent = '⏸';
      button.dataset.speaking = 'true';
      activeButton = button;

      let index = 0;

      const speakNext = () => {
        if (token !== speechToken) return;
        if (index >= segments.length) {
          resetButtonState(button);
          clearHighlight();
          if (activeButton === button) {
            activeButton = null;
          }
          return;
        }

        const segment = segments[index++];
        if (activeHighlightEl && activeHighlightEl !== segment.element) {
          activeHighlightEl.classList.remove('tts-highlight');
        }
        activeHighlightEl = segment.element || null;
        if (activeHighlightEl) {
          activeHighlightEl.classList.add('tts-highlight');
        }

        const utterance = new SpeechSynthesisUtterance(normalizeSpeechText(segment.text));
        utterance.rate = 0.9;
        utterance.pitch = 1;
        utterance.volume = 1;
        utterance.lang = 'en-GB';

        const voices = synth.getVoices();
        const preferredVoice = voices.find(v => v.name === 'Google UK English Female' && v.lang === 'en-GB');
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }

        utterance.onend = () => {
          speakNext();
        };

        utterance.onerror = () => {
          speakNext();
        };

        synth.speak(utterance);
      };

      speakNext();
    };

    cards.forEach((card) => {
      const summary = card.querySelector('summary');
      if (!summary || summary.querySelector('.card-tts-btn')) return;

      const ttsBtn = document.createElement('button');
      ttsBtn.type = 'button';
      ttsBtn.className = 'card-tts-btn';
      ttsBtn.setAttribute('aria-label', 'Read this section');
      ttsBtn.innerHTML = '<span class="card-tts-icon" aria-hidden="true">🔊</span>';
      summary.appendChild(ttsBtn);

      ttsBtn.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();

        if (ttsBtn.dataset.speaking === 'true') {
          stopAllTts();
          return;
        }

        const title = summary.querySelector('h1, h2, h3, h4, h5, h6');
        const body = card.querySelector('.card-body');
        const textParts = [];

        if (title) {
          const titleText = getCleanText(title);
          if (titleText) textParts.push(titleText);
        }

        if (body) {
          const bodyText = Array.from(body.querySelectorAll('p, li, h3, h4, h5, h6'))
            .map(el => getCleanText(el))
            .filter(Boolean)
            .join('. ');
          if (bodyText) {
            textParts.push(bodyText);
          }
        }

        const segments = [];
        if (title) {
          const titleText = getCleanText(title);
          splitIntoSentences(titleText).forEach(sentence => {
            segments.push({ text: sentence, element: title });
          });
        }

        if (body) {
          Array.from(body.querySelectorAll('p, li, h3, h4, h5, h6, th, td')).forEach((el) => {
            const cleaned = getCleanText(el);
            splitIntoSentences(cleaned).forEach(sentence => {
              segments.push({ text: sentence, element: el });
            });
          });
        }

        speakSegments(segments, ttsBtn);
      });
    });

    if (currentPageFile !== 'index' && currentPageFile !== 'contents') {
      const staticCards = document.querySelectorAll('.card:not(details.card)');
      staticCards.forEach((card) => {
        const parentCard = card.parentElement && card.parentElement.closest('.card');
        if (parentCard && parentCard !== card) return;

        if (card.querySelector('.card-tts-btn')) return;
        if (!card.querySelector('p, li, ol, ul')) return;

        const ttsBtn = document.createElement('button');
        ttsBtn.type = 'button';
        ttsBtn.className = 'card-tts-btn card-tts-btn-inline';
        ttsBtn.setAttribute('aria-label', 'Read this section');
        ttsBtn.innerHTML = '<span class="card-tts-icon" aria-hidden="true">🔊</span>';

        const heading = card.querySelector('h2, h3, h4, h5, h6');
        if (heading) {
          heading.classList.add('card-tts-title');
          heading.appendChild(ttsBtn);
        } else {
          ttsBtn.classList.add('card-tts-btn-floating');
          card.prepend(ttsBtn);
        }

        ttsBtn.addEventListener('click', (event) => {
          event.preventDefault();
          event.stopPropagation();

          if (ttsBtn.dataset.speaking === 'true') {
            stopAllTts();
            return;
          }

          const segments = [];
          Array.from(card.querySelectorAll('h2, h3, h4, h5, h6, p, li, th, td')).forEach((el) => {
            const cleaned = getCleanText(el);
            splitIntoSentences(cleaned).forEach(sentence => {
              segments.push({ text: sentence, element: el });
            });
          });

          speakSegments(segments, ttsBtn);
        });
      });
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initCardTts, { once: true });
  } else {
    initCardTts();
  }

  const stopTtsOnLeave = () => {
    if (typeof window.__stopAllTts === 'function') {
      window.__stopAllTts();
    } else if (window.speechSynthesis && window.speechSynthesis.speaking) {
      window.speechSynthesis.cancel();
    }
  };

  window.addEventListener('pagehide', stopTtsOnLeave);
  window.addEventListener('beforeunload', stopTtsOnLeave);
}
