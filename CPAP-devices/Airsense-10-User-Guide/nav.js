function injectNav(currentPageFile) {
  const normalizeSpeechText = (text) => {
    if (!text) return text;
    return text.replace(/\bCPAP\b/g, 'see pap');
  };

  // Load text size preference
  const textSize = localStorage.getItem('text-size') || 'medium';
  document.body.classList.add(`text-size-${textSize}`);

  if (!window.__mtgTelemetryClientInjected) {
    const isHostedChatHost = /(^|\.)chat\.medtechguides\.uk$/i.test(window.location.hostname);
    const telemetryScript = document.createElement('script');
    telemetryScript.src = isHostedChatHost
      ? 'https://medtechguides.uk/CPAP-devices/telemetry-client.js'
      : '/CPAP-devices/telemetry-client.js';
    telemetryScript.defer = true;
    document.head.appendChild(telemetryScript);
    window.__mtgTelemetryClientInjected = true;
  }

  const navItems = [
    { href: 'index.html', label: 'Contents', icon: '📚' },
    { href: 'welcome.html', label: 'Welcome', number: 1 },
    { href: 'about-device.html', label: 'About your device', number: 2 },
    { href: 'setup.html', label: 'Setup', number: 3 },
    { href: 'starting-therapy.html', label: 'Starting therapy', number: 4 },
    { href: 'stopping-therapy.html', label: 'Stopping therapy', number: 5 },
    { href: 'power-save-mode.html', label: 'Power save mode', number: 6 },
    { href: 'my-options.html', label: 'My Options', number: 7 },
    { href: 'caring-for-your-device.html', label: 'Caring for your device', number: 8 },
    { href: 'therapy-data.html', label: 'Therapy data', number: 9 },
    { href: 'travelling.html', label: 'Travelling', number: 10 },
    { href: 'troubleshooting.html', label: 'Troubleshooting', number: 11 },
    { href: 'reassembling-parts.html', label: 'Reassembling parts', number: 12 },
    { href: 'technical-specifications.html', label: 'Technical specifications', number: 13 },
    { href: 'symbols.html', label: 'Symbols', number: 14 },
    { href: 'environmental-information.html', label: 'Environmental information', number: 15 },
    { href: 'servicing.html', label: 'Servicing', number: 16 },
    { href: 'limited-warranty.html', label: 'Limited warranty', number: 17 },
    { href: 'further-information.html', label: 'Further information', number: 18 }
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
    const urlParams = new URLSearchParams(window.location.search);
    const forceExpanded = urlParams.get('nav') === 'expanded';
    if (forceExpanded) {
      localStorage.setItem('nav-collapsed', 'false');
    }
    const persistedCollapsed = localStorage.getItem('nav-collapsed') === 'true';
    document.body.classList.toggle('nav-collapsed', persistedCollapsed);
    const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    const isHostedChat = /(^|\.)chat\.medtechguides\.uk$/i.test(window.location.hostname);
    const hostedChatSetupHref = 'https://chat.medtechguides.uk/chat-setup.html?guide=airsense-10&family=cpap';
    const guideBaseHref = isHostedChat ? 'https://medtechguides.uk/CPAP-devices/Airsense-10-User-Guide/' : '';
    const guideHref = (path) => guideBaseHref ? `${guideBaseHref}${path}` : path;
    // Always link home button to the main landing page at the root
    const getLandingHref = () => 'https://medtechguides.uk/index.html';
    const getSetupGuides = () => {
      try {
        const familyProfile = JSON.parse(localStorage.getItem('setup-profile-cpap') || '{}');
        if (Array.isArray(familyProfile.guides) && familyProfile.guides.length) {
          return familyProfile.guides.filter(Boolean);
        }
        const setup = JSON.parse(localStorage.getItem('cpap-my-setup-v1') || '{}');
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
    const localChatHref = `http://localhost:3000/chat-setup.html?guide=airsense-10&family=cpap${setupGuidesQuery}`;
    const hostedChatHrefWithSetup = `${hostedChatSetupHref}${setupGuidesQuery}`;
    const chatHref = isLocalHost && window.location.port !== '3000'
      ? localChatHref
      : hostedChatHrefWithSetup;
    const isChatCalloutDismissed = (() => {
      try {
        return sessionStorage.getItem('chat-callout-dismissed') === 'true';
      } catch {
        return false;
      }
    })();
    const chatCurrent = currentPageFile === 'chat' ? ' aria-current="page"' : '';
    const searchCurrent = currentPageFile === 'search' ? ' aria-current="page"' : '';
    const videoLibraryCurrent = currentPageFile === 'video-library' ? ' aria-current="page"' : '';

    navContainer.innerHTML = `
      <div class="nav-text-size-controls">
        <span class="nav-settings-label">Text size:</span>
        <button class="nav-text-size-btn" data-size="small" aria-label="Small text">A</button>
        <button class="nav-text-size-btn" data-size="medium" aria-label="Medium text">A</button>
        <button class="nav-text-size-btn" data-size="large" aria-label="Large text">A</button>
      </div>
      <div class="nav-list">
        <a class="nav-link-primary nav-link-home" href="${landingHref}"><span class="nav-link-icon" aria-hidden="true">🏠</span>MedTech Guides</a>
        <a class="nav-link-primary" href="${guideHref('index.html')}"><span class="nav-link-icon" aria-hidden="true">📚</span>Contents</a>
        <a class="nav-link-primary" href="${chatHref}"${chatCurrent}><span class="nav-link-icon" aria-hidden="true">💬</span>Chat Assistant</a>
        <a class="nav-link-primary" href="${guideHref('search.html')}"${searchCurrent}><span class="nav-link-icon" aria-hidden="true">🔍</span>Search</a>
        <a class="nav-link-primary" href="${guideHref('video-library.html')}"${videoLibraryCurrent}><span class="nav-link-icon" aria-hidden="true">🎬</span>Video Library</a>
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
          <span class="nav-action-icon" aria-hidden="true">🏠</span>
          <span class="tooltip" role="tooltip">MedTech Guides</span>
        </a>
        <a class="nav-action-btn nav-action-contents" href="${guideHref('index.html')}" aria-label="Contents">
          <span class="nav-action-icon" aria-hidden="true">📚</span>
          <span class="tooltip" role="tooltip">Contents</span>
        </a>
        <a class="nav-action-btn nav-action-chat" href="${chatHref}" aria-label="Chat assistant">
          <span class="nav-action-icon" aria-hidden="true">💬</span>
          <span class="tooltip" role="tooltip">Chat assistant</span>
        </a>
        <a class="nav-action-btn nav-action-search" href="${guideHref('search.html')}" aria-label="Search">
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

    if (!document.getElementById('mobile-chat-fab-style')) {
      const styleEl = document.createElement('style');
      styleEl.id = 'mobile-chat-fab-style';
      styleEl.textContent = `
        .mobile-chat-dock {
          position: fixed;
          right: 14px;
          bottom: 10px;
          transform: none;
          z-index: 1600;
          display: flex;
          align-items: center;
          justify-content: center;
          width: 88px;
          height: 88px;
          border-radius: 999px;
          background: rgba(18, 24, 38, 0.92);
          box-shadow: 0 12px 28px rgba(18, 24, 38, 0.35);
        }

        .mobile-chat-fab {
          width: 72px;
          height: 72px;
          border-radius: 999px;
          border: 2px solid #ffffff;
          overflow: hidden;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          background: #ffffff;
        }

        .mobile-chat-fab img {
          width: 100%;
          height: 100%;
          object-fit: cover;
        }

        .mobile-chat-callout {
          position: absolute;
          right: 84px;
          bottom: 48px;
          width: 280px;
          max-width: 280px;
          padding: 6px 12px;
          border-radius: 12px;
          background: #ffffff;
          color: #121826;
          border: 1px solid #d9e1f2;
          box-shadow: 0 10px 24px rgba(18, 24, 38, 0.2);
          font-size: 12px;
          line-height: 1.2;
          padding-right: 28px;
        }

        .mobile-chat-callout-close {
          position: absolute;
          top: 4px;
          right: 6px;
          border: 0;
          background: transparent;
          color: #4a5568;
          font-size: 14px;
          line-height: 1;
          cursor: pointer;
        }
      `;
      document.head.appendChild(styleEl);
    }

    if (currentPageFile !== 'chat' && !document.querySelector('.mobile-chat-dock')) {
      const dock = document.createElement('div');
      dock.className = 'mobile-chat-dock';
      const launcher = document.createElement('a');
      launcher.className = 'mobile-chat-fab';
      launcher.href = chatHref;
      launcher.setAttribute('aria-label', 'Open Chat Assistant');
      launcher.innerHTML = '<img alt="Chat Assistant" />';

      const logo = launcher.querySelector('img');
      const candidates = ['/images/chatface.png', 'https://medtechguides.uk/images/chatface.png'];
      let index = 0;
      const applySource = () => {
        if (index >= candidates.length) return;
        logo.src = candidates[index++];
      };
      logo.onerror = applySource;
      applySource();

      if (!isChatCalloutDismissed) {
        const callout = document.createElement('div');
        callout.className = 'mobile-chat-callout';
        callout.innerHTML = '<button type="button" class="mobile-chat-callout-close" aria-label="Close chat message">×</button><span>I\'m your virtual chat assistant. Click here if you have any queries.</span>';
        const closeBtn = callout.querySelector('.mobile-chat-callout-close');
        if (closeBtn) {
          closeBtn.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            try {
              sessionStorage.setItem('chat-callout-dismissed', 'true');
            } catch {
              // Ignore storage errors
            }
            callout.remove();
          });
        }
        dock.appendChild(callout);
      }

      dock.appendChild(launcher);
      document.body.appendChild(dock);
    }
  }

  // Inject search box into header
  const header = document.querySelector('.header');
  if (header) {
    const isChatPage = currentPageFile === 'chat';
    const chatLogoCandidates = [
      'images/chat.PNG',
      '/images/chat.PNG',
      'https://medtechguides.uk/images/chat.PNG'
    ];
    const applyChatLogoSource = (logoEl) => {
      let index = 0;
      const tryNext = () => {
        if (index >= chatLogoCandidates.length) return;
        logoEl.src = chatLogoCandidates[index++];
      };
      logoEl.onerror = tryNext;
      tryNext();
    };
    const brand = header.querySelector('.brand');
    if (brand) {
      brand.textContent = isChatPage ? 'Chat Assistant' : 'AirSense 10';
    }

    const subbrand = header.querySelector('.subbrand');
    if (subbrand) {
      subbrand.textContent = isChatPage ? '' : 'User Guide';
      subbrand.style.display = isChatPage ? 'none' : '';
    }

    const existingLogo = header.querySelector('.header-logo');
    if (isChatPage) {
      if (!existingLogo) {
        const logo = document.createElement('img');
        logo.className = 'header-logo';
        logo.alt = 'Chat Assistant logo';
        applyChatLogoSource(logo);
        header.insertBefore(logo, header.firstChild);
      } else {
        existingLogo.alt = 'Chat Assistant logo';
        applyChatLogoSource(existingLogo);
      }
    }

    if (!isChatPage && !header.querySelector('.header-logo')) {
      const logo = document.createElement('img');
      logo.className = 'header-logo';
      logo.src = 'images/resmed.PNG';
      logo.alt = 'ResMed logo';
      header.insertBefore(logo, header.firstChild);
    }

    if (!document.querySelector('.back-arrow')) {
      const backArrow = document.createElement('button');
      backArrow.type = 'button';
      backArrow.className = 'back-arrow';
      backArrow.setAttribute('aria-label', 'Go back');
      backArrow.innerHTML = '<span class="back-arrow-icon" aria-hidden="true">←</span>';
      backArrow.addEventListener('click', () => {
        const isHostedChatBack = /(^|\.)chat\.medtechguides\.uk$/i.test(window.location.hostname);
        if (isHostedChatBack) {
          window.location.href = 'https://medtechguides.uk/index.html';
          return;
        }
        if (window.history.length > 1) {
          window.history.back();
        } else {
          window.location.href = '/CPAP-devices/index.html';
        }
      });
      document.body.appendChild(backArrow);
    }

    const headerLogo = header.querySelector('.header-logo');
    const headerLinkTargets = [headerLogo, brand, subbrand].filter(Boolean);
    headerLinkTargets.forEach((target) => {
      target.setAttribute('role', 'link');
      target.setAttribute('tabindex', '0');
      target.addEventListener('click', () => {
        const isHostedChat = window.location.hostname === 'chat.medtechguides.uk';
        window.location.href = getLandingHref();
      });
      target.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          const isHostedChat = window.location.hostname === 'chat.medtechguides.uk';
          window.location.href = getLandingHref();
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

    if (!header.querySelector('.home-button')) {
      const homeButton = document.createElement('a');
      homeButton.className = 'home-button';
      homeButton.href = 'https://medtechguides.uk/index.html';
      homeButton.setAttribute('aria-label', 'Back to MedTech Guides');
      homeButton.innerHTML = '<span class="home-icon" aria-hidden="true">🏠</span><span class="visually-hidden">Back to MedTech Guides</span><span class="tooltip" role="tooltip">Back to MedTech Guides</span>';
      header.appendChild(homeButton);
    }

    if (!header.querySelector('.chat-button')) {
      const isLocalHost = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
      const hostedChatSetupHref = 'https://chat.medtechguides.uk/chat-setup.html?guide=airsense-10&family=cpap';
      const getSetupGuides = () => {
        try {
          const familyProfile = JSON.parse(localStorage.getItem('setup-profile-cpap') || '{}');
          if (Array.isArray(familyProfile.guides) && familyProfile.guides.length) {
            return familyProfile.guides.filter(Boolean);
          }
          const setup = JSON.parse(localStorage.getItem('cpap-my-setup-v1') || '{}');
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
      const localChatHref = `http://localhost:3000/chat-setup.html?guide=airsense-10&family=cpap${setupGuidesQuery}`;
      const hostedChatHrefWithSetup = `${hostedChatSetupHref}${setupGuidesQuery}`;
      const chatHref = isLocalHost && window.location.port !== '3000'
        ? localChatHref
        : hostedChatHrefWithSetup;
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
        const isHostedChat = window.location.hostname === 'chat.medtechguides.uk';
        const searchHref = isHostedChat
          ? `https://medtechguides.uk/CPAP-devices/Airsense-10-User-Guide/search.html?q=${encodeURIComponent(query)}`
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
