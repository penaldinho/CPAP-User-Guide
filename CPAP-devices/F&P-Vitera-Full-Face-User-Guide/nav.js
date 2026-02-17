function injectNav(currentPageFile) {
  const normalizeSpeechText = (text) => {
    if (!text) return text;
    return text.replace(/\bCPAP\b/g, 'see pap');
  };

  const safeGetItem = (key) => {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  };

  const safeSetItem = (key, value) => {
    try {
      localStorage.setItem(key, value);
    } catch {
      // Ignore storage errors
    }
  };

  const textSize = safeGetItem('text-size') || 'medium';
  document.body.classList.add(`text-size-${textSize}`);

  const navItems = [
    { href: 'index.html', label: 'Contents', icon: '&#x1F4DA;' },
    { href: 'welcome.html', label: 'Welcome', number: 1 },
    { href: 'operating-instructions.html', label: 'Operating Instructions', number: 2 },
    { href: 'mask-parts.html', label: 'Mask Parts', number: 3 },
    { href: 'fitting-your-mask.html', label: 'Fitting Your Mask', number: 4 },
    { href: 'cleaning-your-mask-at-home.html', label: 'Cleaning Your Mask at Home', number: 5 },
    { href: 'mask-assembly.html', label: 'Mask Assembly', number: 6 },
    { href: 'symbol-definitions.html', label: 'Symbol Definitions', number: 7 },
    { href: 'technical-information.html', label: 'Technical Information', number: 8 },
    { href: 'further-information.html', label: 'Further Information', number: 9 },
    { href: 'warranty-statement.html', label: 'Warranty Statement', number: 10 }
  ];

  if (!window.highlightScriptLoaded) {
    const highlightScript = document.createElement('script');
    highlightScript.src = 'highlight.js';
    document.body.appendChild(highlightScript);
    window.highlightScriptLoaded = true;
  }

  const navContainer = document.querySelector('.nav');
  if (navContainer) {
    const urlParams = new URLSearchParams(window.location.search);
    const forceExpanded = urlParams.get('nav') === 'expanded';
    if (forceExpanded) {
      safeSetItem('nav-collapsed', 'false');
    }
    const persistedCollapsed = safeGetItem('nav-collapsed') === 'true';
    document.body.classList.toggle('nav-collapsed', persistedCollapsed);
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isHostedChat = window.location.hostname === 'chat.medtechguides.uk';
    const hostedChatSetupHref = 'https://chat.medtechguides.uk/chat-setup.html?guide=fp-vitera&family=cpap';
    const guideBaseHref = isHostedChat ? 'https://medtechguides.uk/CPAP-devices/F%26P-Vitera-Full-Face-User-Guide/' : '';
    const guideHref = (path) => guideBaseHref ? `${guideBaseHref}${path}` : path;
    const getLandingHref = () => {
      if (isHostedChat) return 'https://medtechguides.uk/';
      return '/index.html';
    };
    const getSetupGuides = () => {
      try {
        const familyProfile = JSON.parse(safeGetItem('setup-profile-cpap') || '{}');
        if (Array.isArray(familyProfile.guides) && familyProfile.guides.length) {
          return familyProfile.guides.filter(Boolean);
        }
        const setup = JSON.parse(safeGetItem('cpap-my-setup-v1') || '{}');
        const legacyGuides = Array.isArray(setup.guides) && setup.guides.length
          ? setup.guides
          : [setup.device, setup.mask, setup.accessory];
        return legacyGuides.filter(Boolean);
      } catch {
        return [];
      }
    };
    const landingHref = getLandingHref();
    const setupGuides = [...new Set(getSetupGuides())];
    const setupGuidesQuery = setupGuides.length
      ? `&guides=${encodeURIComponent(setupGuides.join(','))}`
      : '';
    const localChatHref = `http://localhost:3000/chat-setup.html?guide=fp-vitera&family=cpap${setupGuidesQuery}`;
    const hostedChatHrefWithSetup = `${hostedChatSetupHref}${setupGuidesQuery}`;
    const chatHref = isLocalHost && window.location.port !== '3000'
      ? localChatHref
      : hostedChatHrefWithSetup;
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
        <a class="nav-link-primary nav-link-home" href="${landingHref}"><span class="nav-link-icon" aria-hidden="true">&#x1F3E0;</span>MedTech Guides</a>
        <a class="nav-link-primary" href="${guideHref('index.html')}"><span class="nav-link-icon" aria-hidden="true">&#x1F4DA;</span>Contents</a>
        <a class="nav-link-primary" href="${chatHref}"${chatCurrent}><span class="nav-link-icon" aria-hidden="true">&#x1F4AC;</span>Chat Assistant</a>
        <a class="nav-link-primary" href="${guideHref('search.html')}"${searchCurrent}><span class="nav-link-icon" aria-hidden="true">&#x1F50D;</span>Search</a>
        ${navItems.map(item => {
          const isCurrent = item.href === currentPageFile + '.html';
          const ariaCurrent = isCurrent ? ' aria-current="page"' : '';
          const icon = item.icon ? `<span class="nav-link-icon" aria-hidden="true">${item.icon}</span>` : '';
          const number = item.number ? `<span class="nav-item-number">${item.number}.</span> ` : '';
          if (item.href === 'index.html') return '';
          return `<a href="${guideHref(item.href)}"${ariaCurrent}>${icon}${number}${item.label}</a>`;
        }).filter(Boolean).join('\n        ')}
      </div>
      <div class="nav-actions" aria-label="Quick actions">
        <a class="nav-action-btn nav-action-home" href="${landingHref}" aria-label="MedTech Guides">
          <span class="nav-action-icon" aria-hidden="true">&#x1F3E0;</span>
          <span class="tooltip" role="tooltip">MedTech Guides</span>
        </a>
        <a class="nav-action-btn nav-action-contents" href="${guideHref('index.html')}" aria-label="Contents">
          <span class="nav-action-icon" aria-hidden="true">&#x1F4DA;</span>
          <span class="tooltip" role="tooltip">Contents</span>
        </a>
        <a class="nav-action-btn nav-action-chat" href="${chatHref}" aria-label="Chat assistant">
          <span class="nav-action-icon" aria-hidden="true">&#x1F4AC;</span>
          <span class="tooltip" role="tooltip">Chat assistant</span>
        </a>
        <a class="nav-action-btn nav-action-search" href="${guideHref('search.html')}" aria-label="Search">
          <span class="nav-action-icon" aria-hidden="true">&#x1F50D;</span>
          <span class="tooltip" role="tooltip">Search</span>
        </a>
      </div>
    `;

    const navTextSizeBtns = navContainer.querySelectorAll('.nav-text-size-btn');
    navTextSizeBtns.forEach((btn) => {
      const size = btn.getAttribute('data-size');
      if (size === textSize) {
        btn.classList.add('active');
      }
      btn.addEventListener('click', () => {
        document.body.className = document.body.className.replace(/text-size-\w+/g, '');
        document.body.classList.add(`text-size-${size}`);
        safeSetItem('text-size', size);
        document.querySelectorAll('.nav-text-size-btn, .text-size-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
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
        safeSetItem('nav-collapsed', String(isCollapsed));
        desktopToggle.setAttribute('aria-expanded', String(!isCollapsed));
        const handleIcon = document.querySelector('.nav-handle-icon');
        if (handleIcon) {
          handleIcon.textContent = isCollapsed ? '\u276F' : '\u276E';
        }
      });
      navContainer.prepend(desktopToggle);
    }

    if (!navContainer.querySelector('.nav-handle')) {
      const handle = document.createElement('button');
      handle.className = 'nav-handle';
      handle.type = 'button';
      handle.setAttribute('aria-label', 'Toggle navigation');
      handle.innerHTML = '<span class="nav-handle-icon" aria-hidden="true">&#x276E;</span>';
      handle.addEventListener('click', () => {
        const isCollapsed = document.body.classList.toggle('nav-collapsed');
        safeSetItem('nav-collapsed', String(isCollapsed));
        handle.querySelector('.nav-handle-icon').textContent = isCollapsed ? '\u276F' : '\u276E';
      });
      navContainer.appendChild(handle);
    }

    const handleIcon = document.querySelector('.nav-handle-icon');
    if (handleIcon) {
      const isCollapsed = document.body.classList.contains('nav-collapsed');
      handleIcon.textContent = isCollapsed ? '\u276F' : '\u276E';
    }
  }

  const header = document.querySelector('.header');
  if (header) {
    const isChatPage = currentPageFile === 'chat';
    const brand = header.querySelector('.brand');
    if (brand) {
      brand.textContent = isChatPage ? 'Chat Assistant' : 'F&P Vitera Full Face';
    }

    const subbrand = header.querySelector('.subbrand');
    if (subbrand) {
      subbrand.textContent = isChatPage ? '' : 'Mask User Guide';
      subbrand.style.display = isChatPage ? 'none' : '';
    }

    const existingLogo = header.querySelector('.header-logo');
    if (isChatPage) {
      if (!existingLogo) {
        const logo = document.createElement('img');
        logo.className = 'header-logo';
        logo.src = '/images/chat.PNG';
        logo.alt = 'Chat Assistant logo';
        header.insertBefore(logo, header.firstChild);
      } else {
        existingLogo.src = '/images/chat.PNG';
        existingLogo.alt = 'Chat Assistant logo';
      }
    }

    if (!isChatPage && !header.querySelector('.header-logo')) {
      const logo = document.createElement('img');
      logo.className = 'header-logo';
      logo.src = '/CPAP-devices/images/FP.PNG';
      logo.alt = 'Fisher & Paykel logo';
      header.insertBefore(logo, header.firstChild);
    }

    if (!document.querySelector('.back-arrow')) {
      const backArrow = document.createElement('button');
      backArrow.type = 'button';
      backArrow.className = 'back-arrow';
      backArrow.setAttribute('aria-label', 'Go back');
      backArrow.innerHTML = '<span class="back-arrow-icon" aria-hidden="true">&#x2190;</span>';
      backArrow.addEventListener('click', () => {
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = '/CPAP-devices/index.html';
        }
      });
      document.body.appendChild(backArrow);
    }

    const isHostedChat = window.location.hostname === 'chat.medtechguides.uk';
    const getLandingHref = () => {
      if (isHostedChat) return 'https://medtechguides.uk/';
      return '/index.html';
    };

    const headerLogo = header.querySelector('.header-logo');
    const headerLinkTargets = [headerLogo, brand, subbrand].filter(Boolean);
    headerLinkTargets.forEach((target) => {
      target.setAttribute('role', 'link');
      target.setAttribute('tabindex', '0');
      target.addEventListener('click', () => {
        window.location.href = getLandingHref();
      });
      target.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          window.location.href = getLandingHref();
        }
      });
    });

    let searchForm = header.querySelector('#header-search-form');
    if (!searchForm) {
      searchForm = document.createElement('form');
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
          safeSetItem('text-size', size);
          document.querySelectorAll('.text-size-btn, .nav-text-size-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          const navBtn = document.querySelector(`.nav-text-size-btn[data-size="${size}"]`);
          if (navBtn) navBtn.classList.add('active');
        });
      });
    }

    if (!header.querySelector('.home-button')) {
      const homeButton = document.createElement('a');
      homeButton.className = 'home-button';
      homeButton.href = '/index.html';
      homeButton.setAttribute('aria-label', 'Back to MedTech Guides');
      homeButton.innerHTML = '<span class="home-icon" aria-hidden="true">&#x1F3E0;</span><span class="visually-hidden">Back to MedTech Guides</span><span class="tooltip" role="tooltip">Back to MedTech Guides</span>';
      header.appendChild(homeButton);
    }

    if (!header.querySelector('.chat-button')) {
      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const hostedChatSetupHref = 'https://chat.medtechguides.uk/chat-setup.html?guide=fp-vitera&family=cpap';
      const getSetupGuides = () => {
        try {
          const familyProfile = JSON.parse(safeGetItem('setup-profile-cpap') || '{}');
          if (Array.isArray(familyProfile.guides) && familyProfile.guides.length) {
            return familyProfile.guides.filter(Boolean);
          }
          const setup = JSON.parse(safeGetItem('cpap-my-setup-v1') || '{}');
          const legacyGuides = Array.isArray(setup.guides) && setup.guides.length
            ? setup.guides
            : [setup.device, setup.mask, setup.accessory];
          return legacyGuides.filter(Boolean);
        } catch {
          return [];
        }
      };
      const setupGuides = [...new Set(getSetupGuides())];
      const setupGuidesQuery = setupGuides.length
        ? `&guides=${encodeURIComponent(setupGuides.join(','))}`
        : '';
      const localChatHref = `http://localhost:3000/chat-setup.html?guide=fp-vitera&family=cpap${setupGuidesQuery}`;
      const hostedChatHrefWithSetup = `${hostedChatSetupHref}${setupGuidesQuery}`;
      const chatHref = isLocalHost && window.location.port !== '3000'
        ? localChatHref
        : hostedChatHrefWithSetup;
      const chatButton = document.createElement('a');
      chatButton.className = 'chat-button';
      chatButton.href = chatHref;
      chatButton.setAttribute('aria-label', 'Chat Assistant');
      chatButton.innerHTML = '<span class="chat-icon" aria-hidden="true">&#x1F4AC;</span><span class="visually-hidden">Chat Assistant</span><span class="tooltip" role="tooltip">Chat assistant</span>';
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
            handleIcon.textContent = isCollapsed ? '\u276F' : '\u276E';
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
        const isHostedChat = window.location.hostname === 'chat.medtechguides.uk';
        const searchHref = isHostedChat
          ? `https://medtechguides.uk/CPAP-devices/F%26P-Vitera-Full-Face-User-Guide/search.html?q=${encodeURIComponent(query)}`
          : `search.html?q=${encodeURIComponent(query)}`;
        window.location.href = searchHref;
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
      if (!text) return [];
      const matches = text.match(/[^.!?]+[.!?]*\s*/g) || [];
      return matches
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
      if (icon) icon.textContent = '\uD83D\uDD0A';
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
      if (icon) icon.textContent = '\u23F8';
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
      ttsBtn.innerHTML = '<span class="card-tts-icon" aria-hidden="true">&#x1F50A;</span>';
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
        ttsBtn.innerHTML = '<span class="card-tts-icon" aria-hidden="true">&#x1F50A;</span>';

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