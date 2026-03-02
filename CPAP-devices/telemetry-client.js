(function () {
  if (window.MTGTelemetry) return;

  const sessionKey = 'mtg-telemetry-session-id';
  const participantKey = 'mtg-telemetry-participant-id';
  const taskStateKey = 'mtg-telemetry-task-state';
  const lastTaskResultKey = 'mtg-telemetry-last-task-result';
  const tabTaskSubscribedKey = 'mtg-telemetry-tab-task-subscribed';
  let shortFormAutoFocusTaskId = '';
  let shortFormRenderedTaskId = '';
  let isShortFormCardExpanded = false;
  let isTaskPromptExpanded = false;
  let baseBodyPaddingBottomPx = null;

  const getApiUrl = () => {
    const host = window.location.hostname;
    const isLocalHost = host === 'localhost' || host === '127.0.0.1';
    const isHostedChat = /(^|\.)chat\.medtechguides\.uk$/i.test(host);
    if (isLocalHost || isHostedChat) return '/api/telemetry';
    return 'https://chat.medtechguides.uk/api/telemetry';
  };

  const isHostedChatHost = (host) => /(^|\.)chat\.medtechguides\.uk$/i.test(String(host || ''));

  const isFirstPartyNavigationHost = (host) => {
    const value = String(host || '').toLowerCase();
    if (!value) return false;
    if (value === 'localhost' || value === '127.0.0.1') return true;
    return value === 'medtechguides.uk'
      || value.endsWith('.medtechguides.uk');
  };

  const buildNavigationContextParams = (includeTaskClear) => {
    const currentUrl = new URL(window.location.href);
    const params = new URLSearchParams();

    const participantId = getParticipantId();
    if (participantId) {
      params.set('mtg_participant_id', participantId);
    }

    const taskState = getTaskState();
    if (taskState.task_id) {
      params.set('mtg_task_id', String(taskState.task_id));
      if (taskState.task_label) {
        params.set('mtg_task_label', String(taskState.task_label));
      }
      if (taskState.started_at) {
        params.set('mtg_task_started_at', String(taskState.started_at));
      }
    } else if (includeTaskClear) {
      params.set('mtg_task_clear', '1');
    }

    const lastTaskParams = buildLastTaskParams();
    lastTaskParams.forEach((value, key) => {
      params.set(key, value);
    });

    const research = String(currentUrl.searchParams.get('research') || '').trim();
    if (research) {
      params.set('research', research);
    }

    return params;
  };

  const decorateNavigationHref = (rawHref) => {
    if (!rawHref) return rawHref;
    const href = String(rawHref || '').trim();
    if (!href || href.startsWith('#') || /^javascript:/i.test(href)) return rawHref;

    const currentUrl = new URL(window.location.href);
    if (!isFirstPartyNavigationHost(currentUrl.hostname)) return rawHref;

    const hasActiveTask = Boolean(getTaskState().task_id);
    const hasUrlContext = Array.from(currentUrl.searchParams.keys())
      .some((key) => key === 'research' || key.startsWith('mtg_'));
    if (!hasActiveTask && !hasUrlContext) {
      return rawHref;
    }

    let targetUrl;
    try {
      targetUrl = new URL(href, currentUrl.href);
    } catch {
      return rawHref;
    }

    if (!isFirstPartyNavigationHost(targetUrl.hostname)) {
      return rawHref;
    }

    const targetIsChatHost = isHostedChatHost(targetUrl.hostname);
    const targetPath = String(targetUrl.pathname || '').toLowerCase();
    const targetIsChatPage = targetPath.endsWith('/chat.html') || targetPath.endsWith('/chat-setup.html');

    const includeTaskClear = !targetIsChatHost && !targetIsChatPage;

    [
      'mtg_task_id',
      'mtg_task_label',
      'mtg_task_started_at',
      'mtg_task_clear',
      'mtg_last_task_id',
      'mtg_last_task_label',
      'mtg_last_task_status',
      'mtg_last_task_duration_ms',
      'mtg_last_task_ended_at'
    ].forEach((key) => {
      targetUrl.searchParams.delete(key);
    });

    const contextParams = buildNavigationContextParams(includeTaskClear);
    contextParams.forEach((value, key) => {
      targetUrl.searchParams.set(key, value);
    });

    return targetUrl.toString();
  };

  const getExportUrl = () => {
    const apiUrl = getApiUrl();
    const participantId = getParticipantId();
    if (participantId) {
      return `${apiUrl.replace(/\/api\/telemetry$/, '/api/telemetry/export.csv')}?participant_id=${encodeURIComponent(participantId)}`;
    }
    return apiUrl.replace(/\/api\/telemetry$/, '/api/telemetry/export.csv');
  };

  const safeJsonParse = (value, fallback) => {
    try {
      return JSON.parse(value);
    } catch {
      return fallback;
    }
  };

  const escapeHtml = (value) => String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

  const ensureBaseBodyPaddingBottom = () => {
    if (baseBodyPaddingBottomPx !== null) return;
    if (!document.body) {
      baseBodyPaddingBottomPx = 0;
      return;
    }

    const computed = window.getComputedStyle(document.body);
    const parsed = Number.parseFloat(String(computed.paddingBottom || '0'));
    baseBodyPaddingBottomPx = Number.isFinite(parsed) ? parsed : 0;
  };

  const isElementVisibleForLayout = (element) => {
    if (!element) return false;
    const style = window.getComputedStyle(element);
    if (style.display === 'none' || style.visibility === 'hidden') {
      return false;
    }

    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  };

  const updateTaskCardSafeArea = () => {
    if (!document.body) return;
    ensureBaseBodyPaddingBottom();

    const candidates = [
      document.getElementById('mtg-task-prompt-card'),
      document.getElementById('mtg-participant-end-task-wrap')
    ];

    let coveredHeight = 0;
    candidates.forEach((element) => {
      if (!isElementVisibleForLayout(element)) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const overlapFromBottom = window.innerHeight - rect.top;
      if (overlapFromBottom > coveredHeight) {
        coveredHeight = overlapFromBottom;
      }
    });

    const additionalGap = coveredHeight > 0 ? 12 : 0;
    const safeAreaPx = Math.max(0, Math.ceil(coveredHeight + additionalGap));
    const nextPaddingBottom = Math.max(0, Math.ceil((baseBodyPaddingBottomPx || 0) + safeAreaPx));
    document.body.style.paddingBottom = `${nextPaddingBottom}px`;
  };

  const randomId = () => {
    const stamp = Date.now().toString(36);
    const rand = Math.random().toString(36).slice(2, 10);
    return `s_${stamp}_${rand}`;
  };

  const getOrCreateSessionId = () => {
    const existing = sessionStorage.getItem(sessionKey);
    if (existing) return existing;
    const created = randomId();
    sessionStorage.setItem(sessionKey, created);
    return created;
  };

  const getParticipantId = () => localStorage.getItem(participantKey) || '';

  const setParticipantIdRaw = (participantId) => {
    const value = String(participantId || '').trim();
    if (!value) {
      localStorage.removeItem(participantKey);
      return '';
    }
    localStorage.setItem(participantKey, value);
    return value;
  };

  const isTaskSubscribedInTab = () => sessionStorage.getItem(tabTaskSubscribedKey) === '1';

  const setTaskSubscribedInTab = (subscribed) => {
    if (subscribed) {
      sessionStorage.setItem(tabTaskSubscribedKey, '1');
      return;
    }
    sessionStorage.removeItem(tabTaskSubscribedKey);
  };

  const getSharedTaskState = () => safeJsonParse(localStorage.getItem(taskStateKey) || '{}', {});

  const getTaskState = () => {
    if (!isTaskSubscribedInTab()) {
      return {};
    }
    return getSharedTaskState();
  };

  const setTaskState = (state) => {
    localStorage.setItem(taskStateKey, JSON.stringify(state || {}));
  };

  const getLastTaskResult = () => safeJsonParse(localStorage.getItem(lastTaskResultKey) || '{}', {});

  const setLastTaskResult = (result) => {
    localStorage.setItem(lastTaskResultKey, JSON.stringify(result || {}));
  };

  const buildLastTaskParams = () => {
    const params = new URLSearchParams();
    const lastTask = getLastTaskResult();
    if (!lastTask || !lastTask.task_id) {
      return params;
    }

    params.set('mtg_last_task_id', String(lastTask.task_id));
    if (lastTask.task_label) {
      params.set('mtg_last_task_label', String(lastTask.task_label));
    }
    if (lastTask.task_status) {
      params.set('mtg_last_task_status', String(lastTask.task_status));
    }
    if (Number.isFinite(lastTask.duration_ms)) {
      params.set('mtg_last_task_duration_ms', String(lastTask.duration_ms));
    }
    if (lastTask.ended_at) {
      params.set('mtg_last_task_ended_at', String(lastTask.ended_at));
    }

    return params;
  };

  const hydrateLastTaskResultFromUrl = () => {
    const url = new URL(window.location.href);
    const taskId = String(url.searchParams.get('mtg_last_task_id') || '').trim();
    if (!taskId) {
      return;
    }

    const taskLabel = String(url.searchParams.get('mtg_last_task_label') || '').trim();
    const taskStatus = String(url.searchParams.get('mtg_last_task_status') || '').trim();
    const durationRaw = String(url.searchParams.get('mtg_last_task_duration_ms') || '').trim();
    const durationMs = /^-?\d+$/.test(durationRaw) ? Number(durationRaw) : null;
    const endedAt = String(url.searchParams.get('mtg_last_task_ended_at') || '').trim();

    const incoming = {
      task_id: taskId,
      task_label: taskLabel,
      task_status: taskStatus,
      duration_ms: Number.isFinite(durationMs) ? durationMs : null,
      ended_at: endedAt || ''
    };

    const existing = getLastTaskResult();
    const existingEndedAt = Date.parse(existing.ended_at || '');
    const incomingEndedAt = Date.parse(incoming.ended_at || '');
    const hasExisting = Boolean(existing && existing.task_id);
    const incomingIsNewer = Number.isFinite(incomingEndedAt) && (!Number.isFinite(existingEndedAt) || incomingEndedAt >= existingEndedAt);

    if (!hasExisting || incomingIsNewer) {
      setLastTaskResult(incoming);
    }
  };

  const hydrateTaskStateFromUrl = () => {
    const url = new URL(window.location.href);
    const shouldClearTask = String(url.searchParams.get('mtg_task_clear') || '').trim() === '1';
    if (shouldClearTask) {
      const sharedState = getSharedTaskState();
      if (sharedState && sharedState.task_id) {
        setTaskSubscribedInTab(true);
        markTaskActiveInUrl(sharedState);
        enableResearchModeInUrl();
      } else {
        setTaskState({});
        setTaskSubscribedInTab(false);
      }
      return;
    }

    const taskId = String(url.searchParams.get('mtg_task_id') || '').trim();
    if (!taskId) {
      const sharedState = getSharedTaskState();
      if (sharedState && sharedState.task_id) {
        setTaskSubscribedInTab(true);
        markTaskActiveInUrl(sharedState);
        enableResearchModeInUrl();
      } else {
        setTaskSubscribedInTab(false);
      }
      return;
    }

    const taskLabel = String(url.searchParams.get('mtg_task_label') || '').trim();
    const taskStartedAt = String(url.searchParams.get('mtg_task_started_at') || '').trim();
    const startedAt = taskStartedAt || new Date().toISOString();

    setTaskState({
      task_id: taskId,
      task_label: taskLabel,
      started_at: startedAt
    });
    setTaskSubscribedInTab(true);
  };

  const hydrateParticipantFromUrl = () => {
    const url = new URL(window.location.href);
    const participantId = String(url.searchParams.get('mtg_participant_id') || '').trim();
    if (!participantId) return;

    const existing = getParticipantId();
    if (existing === participantId) return;
    setParticipantIdRaw(participantId);
  };

  const isResearchMode = () => {
    const url = new URL(window.location.href);
    const flag = String(url.searchParams.get('research') || '').toLowerCase();
    return flag === '1' || flag === 'true' || flag === 'yes';
  };

  const enableResearchModeInUrl = () => {
    const url = new URL(window.location.href);
    const current = String(url.searchParams.get('research') || '').toLowerCase();
    if (current === '1') return;
    url.searchParams.set('research', '1');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const disableResearchModeInUrl = () => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has('research')) return;
    url.searchParams.delete('research');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const markTaskClearedInUrl = () => {
    const url = new URL(window.location.href);
    url.searchParams.delete('mtg_task_id');
    url.searchParams.delete('mtg_task_label');
    url.searchParams.delete('mtg_task_started_at');
    url.searchParams.set('mtg_task_clear', '1');

    const lastTaskParams = buildLastTaskParams();
    lastTaskParams.forEach((value, key) => {
      url.searchParams.set(key, value);
    });

    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const markTaskActiveInUrl = (taskState) => {
    const url = new URL(window.location.href);
    const taskId = String(taskState && taskState.task_id || '').trim();
    if (!taskId) {
      return;
    }

    url.searchParams.set('mtg_task_id', taskId);
    if (taskState.task_label) {
      url.searchParams.set('mtg_task_label', String(taskState.task_label));
    } else {
      url.searchParams.delete('mtg_task_label');
    }
    if (taskState.started_at) {
      url.searchParams.set('mtg_task_started_at', String(taskState.started_at));
    }
    url.searchParams.delete('mtg_task_clear');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  const reconcileSharedTaskState = () => {
    const url = new URL(window.location.href);
    const shouldClearTask = String(url.searchParams.get('mtg_task_clear') || '').trim() === '1';
    const sharedState = getSharedTaskState();

    if (shouldClearTask && sharedState && sharedState.task_id) {
      if (!isTaskSubscribedInTab()) {
        setTaskSubscribedInTab(true);
      }
      markTaskActiveInUrl(sharedState);
      enableResearchModeInUrl();
      renderResearchPanel();
      syncParticipantEndButton();
      syncTaskPromptCard();
      return;
    }

    if (shouldClearTask) {
      const wasSubscribed = isTaskSubscribedInTab();
      if (wasSubscribed) {
        setTaskSubscribedInTab(false);
        renderResearchPanel(true);
      }
      syncParticipantEndButton();
      syncTaskPromptCard();
      return;
    }

    if (sharedState && sharedState.task_id) {
      if (!isTaskSubscribedInTab()) {
        setTaskSubscribedInTab(true);
      }
      markTaskActiveInUrl(sharedState);
      enableResearchModeInUrl();
      renderResearchPanel();
      syncParticipantEndButton();
      syncTaskPromptCard();
      return;
    }

    if (isTaskSubscribedInTab()) {
      setTaskSubscribedInTab(false);
      markTaskClearedInUrl();
      renderResearchPanel(true);
    }
    syncParticipantEndButton();
    syncTaskPromptCard();
  };

  const buildBasePayload = () => {
    const url = new URL(window.location.href);
    return {
      session_id: getOrCreateSessionId(),
      participant_id: getParticipantId(),
      timestamp: new Date().toISOString(),
      page_path: `${url.pathname}${url.search}`,
      page_title: document.title || '',
      guide: (url.searchParams.get('guide') || '').toLowerCase(),
      family: (url.searchParams.get('family') || '').toLowerCase()
    };
  };

  const postEvent = (event) => {
    const body = JSON.stringify(event);
    const apiUrl = getApiUrl();

    fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true
    }).catch(() => {
      // fail silently; telemetry must not break UX
    });
  };

  const track = (eventType, payload) => {
    if (!eventType) return;
    const taskState = getTaskState();

    const alwaysAllowedWithoutTask = new Set([
      'participant_set',
      'task_start',
      'task_end',
      'task_end_clicked_by_participant'
    ]);

    if (!taskState.task_id && !alwaysAllowedWithoutTask.has(eventType)) {
      return;
    }

    const event = {
      ...buildBasePayload(),
      event_type: eventType,
      task_id: taskState.task_id || '',
      ...payload
    };
    postEvent(event);
  };

  const setParticipantId = (participantId) => {
    const value = setParticipantIdRaw(participantId);
    if (!value) return;
    track('participant_set', { participant_id: value });
  };

  const youtubeTrackerState = {
    apiPromise: null,
    playersByIframeId: new Map(),
    milestonesByIframeId: new Map(),
    progressTimerByIframeId: new Map(),
    scanned: false
  };

  const taskStateSyncState = {
    inFlight: false,
    lastPolledAt: 0,
    intervalId: null
  };

  const getTaskStateApiUrl = () => getApiUrl().replace(/\/api\/telemetry$/, '/api/telemetry/task-state');

  const reconcileTaskStateFromServer = async (reason) => {
    const participantId = String(getParticipantId() || '').trim();
    if (!participantId || taskStateSyncState.inFlight) {
      return;
    }

    const now = Date.now();
    if (reason === 'interval' && now - taskStateSyncState.lastPolledAt < 2500) {
      return;
    }

    taskStateSyncState.inFlight = true;
    taskStateSyncState.lastPolledAt = now;

    try {
      const endpoint = `${getTaskStateApiUrl()}?participant_id=${encodeURIComponent(participantId)}`;
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        cache: 'no-store',
        credentials: 'omit'
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      const active = payload && payload.active_task && String(payload.active_task.task_id || '').trim()
        ? payload.active_task
        : null;
      const lastTask = payload && payload.last_task ? payload.last_task : null;

      if (lastTask && String(lastTask.task_id || '').trim()) {
        const incomingEndedAtMs = Date.parse(String(lastTask.ended_at || ''));
        const existingLastTask = getLastTaskResult();
        const existingEndedAtMs = Date.parse(String(existingLastTask.ended_at || ''));
        const shouldReplaceLastTask = !existingLastTask.task_id
          || (Number.isFinite(incomingEndedAtMs) && (!Number.isFinite(existingEndedAtMs) || incomingEndedAtMs >= existingEndedAtMs));

        if (shouldReplaceLastTask) {
          setLastTaskResult({
            task_id: String(lastTask.task_id || '').trim(),
            task_label: String(lastTask.task_label || '').trim(),
            task_status: String(lastTask.task_status || '').trim(),
            duration_ms: Number.isFinite(Number(lastTask.duration_ms)) ? Number(lastTask.duration_ms) : null,
            ended_at: String(lastTask.ended_at || '').trim()
          });
        }
      }

      if (active) {
        const serverTask = {
          task_id: String(active.task_id || '').trim(),
          task_label: String(active.task_label || '').trim(),
          started_at: String(active.started_at || '').trim() || new Date().toISOString()
        };

        const localTask = getSharedTaskState();
        const localTaskId = String(localTask.task_id || '').trim();
        const localStartedAt = String(localTask.started_at || '').trim();

        if (localTaskId !== serverTask.task_id || localStartedAt !== serverTask.started_at) {
          setTaskState(serverTask);
        }

        if (!isTaskSubscribedInTab()) {
          setTaskSubscribedInTab(true);
        }

        markTaskActiveInUrl(serverTask);
        enableResearchModeInUrl();
        syncParticipantEndButton();
        syncTaskPromptCard();
        return;
      }

      const sharedTask = getSharedTaskState();
      if (String(sharedTask.task_id || '').trim()) {
        setTaskState({});
      }

      if (isTaskSubscribedInTab()) {
        setTaskSubscribedInTab(false);
        markTaskClearedInUrl();
        renderResearchPanel(true);
      }
      syncParticipantEndButton();
      syncTaskPromptCard();
    } catch {
      // ignore sync failures
    } finally {
      taskStateSyncState.inFlight = false;
    }
  };

  const parseYouTubeVideoId = (value) => {
    const text = String(value || '').trim();
    if (!text) return '';
    try {
      const url = new URL(text, window.location.href);
      const host = String(url.hostname || '').toLowerCase();
      if (host.endsWith('youtube.com')) {
        if (url.pathname.startsWith('/embed/')) {
          return url.pathname.split('/').filter(Boolean)[1] || '';
        }
        return String(url.searchParams.get('v') || '').trim();
      }
      if (host === 'youtu.be') {
        return url.pathname.split('/').filter(Boolean)[0] || '';
      }
    } catch {
      return '';
    }
    return '';
  };

  const readYouTubeMeta = (iframe, player) => {
    const src = String(iframe.getAttribute('src') || iframe.src || '').trim();
    const videoId = parseYouTubeVideoId(src || iframe.dataset.mtgVideoId || '');
    const durationSeconds = Number(player && player.getDuration ? player.getDuration() : 0);
    const currentSeconds = Number(player && player.getCurrentTime ? player.getCurrentTime() : 0);
    const safeDuration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
    const safeCurrent = Number.isFinite(currentSeconds) && currentSeconds >= 0 ? currentSeconds : 0;
    const percent = safeDuration > 0 ? Math.min(100, Math.max(0, Math.floor((safeCurrent / safeDuration) * 100))) : null;

    return {
      video_provider: 'youtube',
      video_id: videoId,
      video_title: String((player && player.getVideoData && player.getVideoData().title) || iframe.getAttribute('title') || '').trim(),
      video_url: src,
      video_current_time_ms: Math.round(safeCurrent * 1000),
      video_duration_ms: safeDuration > 0 ? Math.round(safeDuration * 1000) : null,
      video_percent: percent
    };
  };

  const clearProgressTimer = (iframeId) => {
    const existing = youtubeTrackerState.progressTimerByIframeId.get(iframeId);
    if (existing) {
      window.clearInterval(existing);
      youtubeTrackerState.progressTimerByIframeId.delete(iframeId);
    }
  };

  const emitYouTubeMilestones = (iframe, player) => {
    const iframeId = iframe.id;
    const meta = readYouTubeMeta(iframe, player);
    const currentPercent = Number.isFinite(meta.video_percent) ? meta.video_percent : null;
    if (currentPercent === null) return;

    let milestones = youtubeTrackerState.milestonesByIframeId.get(iframeId);
    if (!milestones) {
      milestones = new Set();
      youtubeTrackerState.milestonesByIframeId.set(iframeId, milestones);
    }

    [25, 50, 75, 95].forEach((threshold) => {
      if (currentPercent >= threshold && !milestones.has(threshold)) {
        milestones.add(threshold);
        track('video_progress', {
          ...meta,
          video_action: `progress_${threshold}`
        });
      }
    });
  };

  const setProgressTimer = (iframe, player) => {
    const iframeId = iframe.id;
    clearProgressTimer(iframeId);
    const timer = window.setInterval(() => {
      emitYouTubeMilestones(iframe, player);
    }, 2000);
    youtubeTrackerState.progressTimerByIframeId.set(iframeId, timer);
  };

  const ensureYouTubeApi = () => {
    if (window.YT && window.YT.Player) {
      return Promise.resolve(window.YT);
    }

    if (youtubeTrackerState.apiPromise) {
      return youtubeTrackerState.apiPromise;
    }

    youtubeTrackerState.apiPromise = new Promise((resolve) => {
      const previous = window.onYouTubeIframeAPIReady;
      window.onYouTubeIframeAPIReady = () => {
        if (typeof previous === 'function') {
          try {
            previous();
          } catch {
            // ignore upstream callback failures
          }
        }
        resolve(window.YT);
      };

      const existingScript = document.querySelector('script[data-mtg-youtube-api="1"]');
      if (existingScript) {
        return;
      }

      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.async = true;
      script.setAttribute('data-mtg-youtube-api', '1');
      document.head.appendChild(script);
    });

    return youtubeTrackerState.apiPromise;
  };

  const instrumentYouTubeEmbeds = () => {
    const iframes = Array.from(document.querySelectorAll('iframe[src*="youtube.com/embed/"]'));
    if (!iframes.length) return;

    ensureYouTubeApi().then((YT) => {
      if (!YT || !YT.Player) {
        return;
      }

      iframes.forEach((iframe, index) => {
        if (!(iframe instanceof HTMLIFrameElement)) return;

        let iframeId = String(iframe.id || '').trim();
        if (!iframeId) {
          iframeId = `mtg-yt-${index + 1}`;
          iframe.id = iframeId;
        }

        if (youtubeTrackerState.playersByIframeId.has(iframeId)) {
          return;
        }

        const rawSrc = String(iframe.getAttribute('src') || iframe.src || '').trim();
        if (!rawSrc) return;

        let normalizedSrc = rawSrc;
        try {
          const normalizedUrl = new URL(rawSrc, window.location.href);
          normalizedUrl.searchParams.set('enablejsapi', '1');
          normalizedUrl.searchParams.set('origin', window.location.origin);
          normalizedSrc = normalizedUrl.toString();
        } catch {
          // keep original src if URL parsing fails
        }

        if (normalizedSrc !== rawSrc) {
          iframe.setAttribute('src', normalizedSrc);
        }

        iframe.dataset.mtgVideoId = parseYouTubeVideoId(normalizedSrc);

        const player = new YT.Player(iframeId, {
          events: {
            onReady: () => {
              const meta = readYouTubeMeta(iframe, player);
              track('video_ready', {
                ...meta,
                video_action: 'ready'
              });
            },
            onStateChange: (event) => {
              const state = Number(event && event.data);
              const stateMap = {
                [YT.PlayerState.PLAYING]: { eventType: 'video_play', action: 'play' },
                [YT.PlayerState.PAUSED]: { eventType: 'video_pause', action: 'pause' },
                [YT.PlayerState.ENDED]: { eventType: 'video_complete', action: 'ended' }
              };

              if (state === YT.PlayerState.PLAYING) {
                setProgressTimer(iframe, player);
              }

              if (state === YT.PlayerState.PAUSED || state === YT.PlayerState.ENDED) {
                clearProgressTimer(iframeId);
              }

              const mapped = stateMap[state];
              if (!mapped) return;

              const meta = readYouTubeMeta(iframe, player);
              track(mapped.eventType, {
                ...meta,
                video_action: mapped.action
              });

              emitYouTubeMilestones(iframe, player);
            }
          }
        });

        youtubeTrackerState.playersByIframeId.set(iframeId, player);
      });
    }).catch(() => {
      // keep silent if youtube instrumentation fails
    });
  };

  const initVideoTelemetry = () => {
    if (youtubeTrackerState.scanned) return;
    youtubeTrackerState.scanned = true;
    instrumentYouTubeEmbeds();
  };

  const getActiveTaskContext = () => {
    const taskState = getTaskState();
    return {
      task_id: taskState.task_id || '',
      task_label: taskState.task_label || '',
      task_started_at: taskState.started_at || ''
    };
  };

  const getContext = () => ({
    participant_id: getParticipantId(),
    ...getActiveTaskContext()
  });

  const presetTaskDescriptions = {
    scenario_card_1: {
      title: 'Scenario Card 1 – First-Time Setup (Setup)',
      collapsedDescription: 'Assemble and set up the CPAP device and mask ready for first use, stopping before fitting the mask.',
      steps: [
        'Assemble and set up the CPAP device and mask ready for first use, stopping before fitting the mask.',
        'You may use the instructions at any time.'
      ]
    },
    scenario_card_2: {
      title: 'Scenario Card 2 – Fit and Start Therapy (Routine Use)',
      collapsedDescription: 'Fit the mask to the mannequin, checking and ensuring the mask fit is good, and start therapy.',
      steps: [
        'Fit the mask to the mannequin, checking and ensuring the mask fit is good, and start therapy.',
        'You may use the instructions at any time.'
      ]
    },
    scenario_card_3: {
      title: 'Scenario Card 3 – Comfort Adjustment (Troubleshooting)',
      collapsedDescription: 'You notice dry nose during therapy. Resolve this by adjusting the relevant comfort settings.',
      steps: [
        'You notice dry nose during therapy. Resolve this by adjusting the relevant comfort settings.',
        'You may use the instructions at any time.'
      ]
    },
    short_form_q1: {
      title: 'Short-Form Q1 – Cleaning frequency (Routine Use)',
      preamble: 'You have just finished your first week using CPAP at home and want to make sure your routine keeps the equipment clean and safe.',
      steps: [
        '(a) What is the recommended cleaning frequency for the CPAP device and humidifier?',
        '(b) What is the recommended cleaning frequency for the mask (excluding headgear)?',
        '(c) What is the recommended cleaning frequency for the headgear?',
        '(d) What is the recommended cleaning frequency for ClimateLineAir tubing?'
      ],
      parts: [
        { key: 'a', label: '(a) CPAP device and humidifier frequency' },
        { key: 'b', label: '(b) Mask (excluding headgear) frequency' },
        { key: 'c', label: '(c) Headgear frequency' },
        { key: 'd', label: '(d) ClimateLineAir tubing frequency' }
      ]
    },
    short_form_q2: {
      title: 'Short-Form Q2 – Error message safety escalation (Error 006)',
      preamble: 'You switch on your device before bed and see “System fault – refer to user guide – Error 006”. Therapy has not started, so you need to decide the safest next action.',
      steps: [
        '(a) What should be done next?',
        '(b) What should not be done with the device?'
      ],
      parts: [
        { key: 'a', label: '(a) Next action' },
        { key: 'b', label: '(b) What should not be done' }
      ]
    },
    short_form_q3: {
      title: 'Short-Form Q3 – Spare mask storage (Routine Use / Safety)',
      preamble: 'You receive a spare mask and need to store it until your current one wears out, while keeping it in good condition for future use.',
      steps: [
        '(a) How should a spare mask be stored?',
        '(b) What is the recommended storage temperature range?'
      ],
      parts: [
        { key: 'a', label: '(a) Storage method/conditions' },
        { key: 'b', label: '(b) Storage temperature range' }
      ]
    },
    short_form_q4: {
      title: 'Short-Form Q4 – Tubing length check (Setup)',
      preamble: 'Your bedroom layout means the machine sits about 7 feet from where your mask connects, so you need to check whether ClimateLineAir Oxy tubing will reach comfortably.',
      steps: [
        '(a) Is ClimateLineAir Oxy tubing long enough for 7 feet?',
        '(b) What is the length of ClimateLineAir Oxy tubing?'
      ],
      parts: [
        { key: 'a', label: '(a) Long enough for 7 feet? (yes/no)' },
        { key: 'b', label: '(b) Tubing length' }
      ]
    }
  };

  const getShortFormQuestionDefinition = (taskId) => {
    const entry = presetTaskDescriptions[String(taskId || '').trim()];
    if (!entry) return null;

    const parts = Array.isArray(entry.parts) && entry.parts.length
      ? entry.parts
      : [{ key: 'a', label: 'Answer' }];

    return {
      title: String(entry.title || '').trim(),
      preamble: String(entry.preamble || '').trim(),
      parts
    };
  };

  const ensureTaskPromptCard = () => {
    const existing = document.getElementById('mtg-task-prompt-card');
    if (existing) return existing;

    const card = document.createElement('aside');
    card.id = 'mtg-task-prompt-card';
    card.style.position = 'fixed';
    card.style.left = '50%';
    card.style.bottom = '96px';
    card.style.transform = 'translateX(-50%)';
    card.style.width = 'min(720px, calc(100vw - 24px))';
    card.style.maxWidth = 'calc(100vw - 24px)';
    card.style.maxHeight = '42vh';
    card.style.overflow = 'hidden';
    card.style.background = '#ecfdf5';
    card.style.border = '1px solid #34d399';
    card.style.borderRadius = '10px';
    card.style.boxShadow = '0 10px 24px rgba(16, 185, 129, 0.18)';
    card.style.padding = '12px';
    card.style.zIndex = '9600';
    card.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    card.style.color = '#1f2937';
    card.style.display = 'none';

    card.addEventListener('mouseenter', () => {
      setTaskPromptExpanded(true);
    });
    card.addEventListener('mouseleave', () => {
      setTaskPromptExpanded(false);
    });
    card.addEventListener('focusin', () => {
      setTaskPromptExpanded(true);
    });
    card.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (!card.contains(document.activeElement)) {
          setTaskPromptExpanded(false);
        }
      }, 0);
    });

    document.body.appendChild(card);
    return card;
  };

  const setTaskPromptExpanded = (expanded) => {
    const next = Boolean(expanded);
    if (isTaskPromptExpanded === next) return;
    isTaskPromptExpanded = next;
    syncTaskPromptCard();
  };

  const setShortFormCardExpanded = (expanded) => {
    const next = Boolean(expanded);
    if (isShortFormCardExpanded === next) return;
    isShortFormCardExpanded = next;
    syncParticipantEndButton();
  };

  const formatElapsedDuration = (durationMs) => {
    const totalSeconds = Math.max(0, Math.floor((durationMs || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const syncTaskPromptCard = () => {
    const taskState = getTaskState();
    const card = ensureTaskPromptCard();
    if (!taskState || !taskState.task_id) {
      isTaskPromptExpanded = false;
      card.style.display = 'none';
      card.innerHTML = '';
      updateTaskCardSafeArea();
      return;
    }

    const taskId = String(taskState.task_id || '').trim();
    const fallbackLabel = String(taskState.task_label || '').trim();
    const isShortFormTask = /^short_form_q[1-4]$/i.test(taskId);
    if (isShortFormTask) {
      isTaskPromptExpanded = false;
      card.style.display = 'none';
      card.innerHTML = '';
      updateTaskCardSafeArea();
      return;
    }

    const startedAtMs = Date.parse(String(taskState.started_at || ''));
    const elapsedMs = Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : 0;
    const elapsedText = formatElapsedDuration(elapsedMs);
    const entry = presetTaskDescriptions[taskId] || null;
    const displayLabel = (entry && entry.title) || fallbackLabel || taskId;
    const lines = entry && Array.isArray(entry.steps) ? entry.steps : [];
    const collapsedDescription = String((entry && entry.collapsedDescription) || '').trim();
    const scenarioDescription = collapsedDescription || (lines.length ? String(lines[0] || '').trim() : '');
    const isExpanded = isTaskPromptExpanded;
    const promptHint = isExpanded
      ? 'Move cursor away from this card to collapse'
      : 'Hover this card to expand';
    const completionInstruction = isShortFormTask
      ? 'Type your answer in the box below, then click Submit answer.'
      : 'When finished, click “I have finished this task”.';
    const listMarkup = lines.length
      ? `<ul style="margin:0 0 0 18px; padding:0; display:grid; gap:6px;">${lines.map((line) => `<li style="line-height:1.35;">${escapeHtml(line)}</li>`).join('')}</ul>`
      : '<div style="margin-top:8px; color:#4b5563; line-height:1.35;">Follow the task instructions and inform the observer when complete.</div>';

    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <strong style="font-size:13px; color:#0f172a;">Task in progress</strong>
        <span style="font-size:11px; color:#475569; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:999px; padding:2px 8px;">${escapeHtml(taskId)}</span>
      </div>
      <div style="margin-top:6px; font-size:12px; color:#334155; font-weight:600;">Elapsed: ${escapeHtml(elapsedText)}</div>
      <div style="margin-top:8px; color:#334155; line-height:1.35; font-size:12px; overflow:hidden; display:${scenarioDescription ? '-webkit-box' : 'none'}; -webkit-line-clamp:${isExpanded ? '3' : '2'}; -webkit-box-orient:vertical;">${escapeHtml(scenarioDescription)}</div>
      <div style="margin-top:6px; font-size:11px; color:#64748b;">${escapeHtml(promptHint)}</div>
      <div style="margin-top:8px; display:${isExpanded ? 'block' : 'none'};">
        <div style="font-size:13px; font-weight:600; line-height:1.3;">${escapeHtml(displayLabel)}</div>
        <div style="margin-top:8px; font-size:12px; color:#334155; line-height:1.35;">${listMarkup}</div>
        <div style="margin-top:8px; color:#334155; line-height:1.35; font-size:12px;">${escapeHtml(completionInstruction)}</div>
      </div>
    `;
    card.style.bottom = isShortFormTask ? '170px' : '96px';
    card.style.maxHeight = isExpanded ? '42vh' : (scenarioDescription ? '138px' : '86px');
    card.style.overflow = isExpanded ? 'auto' : 'hidden';
    card.style.display = 'block';
    updateTaskCardSafeArea();
  };

  const startTask = (taskId, label) => {
    if (!taskId) return;
    const nextState = {
      task_id: String(taskId),
      task_label: String(label || ''),
      started_at: new Date().toISOString()
    };
    setTaskSubscribedInTab(true);
    setTaskState(nextState);
    markTaskActiveInUrl(nextState);
    syncTaskPromptCard();
    track('task_start', {
      task_id: String(taskId),
      task_label: String(label || '')
    });
  };

  const endTask = (status) => {
    const state = getTaskState();
    if (!state.task_id) return;

    const startedAt = state.started_at ? Date.parse(state.started_at) : null;
    const durationMs = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : null;

    track('task_end', {
      task_id: state.task_id,
      task_label: state.task_label || '',
      task_status: String(status || ''),
      duration_ms: durationMs
    });

    setLastTaskResult({
      task_id: state.task_id,
      task_label: state.task_label || '',
      task_status: String(status || ''),
      duration_ms: durationMs,
      ended_at: new Date().toISOString()
    });

    setTaskState({});
    setTaskSubscribedInTab(false);
    markTaskClearedInUrl();
    syncTaskPromptCard();
  };

  const ensureParticipantEndButton = () => {
    const existing = document.getElementById('mtg-participant-end-task-wrap');
    if (existing) return existing;

    const wrap = document.createElement('div');
    wrap.id = 'mtg-participant-end-task-wrap';
    wrap.style.position = 'fixed';
    wrap.style.left = '50%';
    wrap.style.bottom = '12px';
    wrap.style.transform = 'translateX(-50%)';
    wrap.style.zIndex = '9500';
    wrap.style.display = 'none';
    wrap.style.maxWidth = 'min(720px, calc(100vw - 24px))';

    const shortFormWrap = document.createElement('div');
    shortFormWrap.id = 'mtg-short-form-answer-wrap';
    shortFormWrap.style.display = 'none';
    shortFormWrap.style.background = '#ecfdf5';
    shortFormWrap.style.border = '1px solid #34d399';
    shortFormWrap.style.borderRadius = '10px';
    shortFormWrap.style.boxShadow = '0 10px 24px rgba(16, 185, 129, 0.2)';
    shortFormWrap.style.padding = '10px';
    shortFormWrap.style.width = 'min(720px, calc(100vw - 24px))';
    shortFormWrap.style.boxSizing = 'border-box';
    shortFormWrap.style.maxHeight = '160px';
    shortFormWrap.style.overflow = 'hidden';

    shortFormWrap.addEventListener('mouseenter', () => {
      setShortFormCardExpanded(true);
    });
    shortFormWrap.addEventListener('mouseleave', () => {
      setShortFormCardExpanded(false);
    });
    shortFormWrap.addEventListener('focusin', () => {
      setShortFormCardExpanded(true);
    });
    shortFormWrap.addEventListener('focusout', () => {
      window.setTimeout(() => {
        if (!shortFormWrap.contains(document.activeElement)) {
          setShortFormCardExpanded(false);
        }
      }, 0);
    });

    const shortFormTaskHeader = document.createElement('div');
    shortFormTaskHeader.id = 'mtg-short-form-task-header';
    shortFormTaskHeader.style.display = 'flex';
    shortFormTaskHeader.style.alignItems = 'center';
    shortFormTaskHeader.style.justifyContent = 'space-between';
    shortFormTaskHeader.style.gap = '8px';
    shortFormTaskHeader.style.marginBottom = '6px';

    const shortFormElapsed = document.createElement('div');
    shortFormElapsed.id = 'mtg-short-form-task-elapsed';
    shortFormElapsed.style.fontSize = '12px';
    shortFormElapsed.style.color = '#334155';
    shortFormElapsed.style.fontWeight = '600';
    shortFormElapsed.style.marginBottom = '6px';

    const shortFormPreamble = document.createElement('div');
    shortFormPreamble.id = 'mtg-short-form-task-preamble';
    shortFormPreamble.style.fontSize = '12px';
    shortFormPreamble.style.color = '#334155';
    shortFormPreamble.style.lineHeight = '1.35';
    shortFormPreamble.style.marginBottom = '8px';

    const shortFormHint = document.createElement('div');
    shortFormHint.id = 'mtg-short-form-task-hint';
    shortFormHint.style.fontSize = '11px';
    shortFormHint.style.color = '#64748b';
    shortFormHint.style.marginBottom = '8px';

    const shortFormDetails = document.createElement('div');
    shortFormDetails.id = 'mtg-short-form-details';

    const shortFormSteps = document.createElement('div');
    shortFormSteps.id = 'mtg-short-form-task-steps';
    shortFormSteps.style.fontSize = '12px';
    shortFormSteps.style.color = '#334155';
    shortFormSteps.style.lineHeight = '1.35';
    shortFormSteps.style.marginBottom = '8px';

    const shortFormLabel = document.createElement('div');
    shortFormLabel.id = 'mtg-short-form-answer-label';
    shortFormLabel.style.fontSize = '13px';
    shortFormLabel.style.fontWeight = '600';
    shortFormLabel.style.marginBottom = '6px';
    shortFormLabel.textContent = 'Enter your answer:';

    const shortFormPrompt = document.createElement('div');
    shortFormPrompt.id = 'mtg-short-form-answer-prompt';
    shortFormPrompt.style.fontSize = '12px';
    shortFormPrompt.style.color = '#334155';
    shortFormPrompt.style.marginBottom = '8px';
    shortFormPrompt.style.lineHeight = '1.35';
    shortFormPrompt.textContent = 'Answer all parts below.';

    const shortFormFields = document.createElement('div');
    shortFormFields.id = 'mtg-short-form-answer-fields';
    shortFormFields.style.display = 'grid';
    shortFormFields.style.gap = '8px';
    shortFormFields.style.marginBottom = '8px';

    const shortFormSubmit = document.createElement('button');
    shortFormSubmit.id = 'mtg-short-form-answer-submit';
    shortFormSubmit.type = 'button';
    shortFormSubmit.style.marginTop = '8px';
    shortFormSubmit.style.padding = '10px 14px';
    shortFormSubmit.style.border = '1px solid #1d4ed8';
    shortFormSubmit.style.background = '#1d4ed8';
    shortFormSubmit.style.color = '#ffffff';
    shortFormSubmit.style.borderRadius = '999px';
    shortFormSubmit.style.fontSize = '14px';
    shortFormSubmit.style.fontWeight = '600';
    shortFormSubmit.style.cursor = 'pointer';
    shortFormSubmit.textContent = 'Submit answer';

    shortFormWrap.appendChild(shortFormTaskHeader);
    shortFormWrap.appendChild(shortFormElapsed);
    shortFormWrap.appendChild(shortFormPreamble);
    shortFormWrap.appendChild(shortFormHint);
    shortFormDetails.appendChild(shortFormSteps);
    shortFormDetails.appendChild(shortFormLabel);
    shortFormDetails.appendChild(shortFormPrompt);
    shortFormDetails.appendChild(shortFormFields);
    shortFormDetails.appendChild(shortFormSubmit);
    shortFormWrap.appendChild(shortFormDetails);

    const button = document.createElement('button');
    button.id = 'mtg-participant-end-task-btn';
    button.type = 'button';
    button.style.padding = '12px 18px';
    button.style.border = '1px solid #0f766e';
    button.style.background = '#0f766e';
    button.style.color = '#ffffff';
    button.style.borderRadius = '999px';
    button.style.fontSize = '15px';
    button.style.fontWeight = '600';
    button.style.cursor = 'pointer';
    button.style.boxShadow = '0 10px 24px rgba(0,0,0,0.2)';
    button.textContent = 'I have finished this task';

    const shortFormTaskIds = ['short_form_q1', 'short_form_q2', 'short_form_q3', 'short_form_q4'];

    shortFormSubmit.addEventListener('click', () => {
      const state = getTaskState();
      const taskId = String(state.task_id || '').trim();
      if (!shortFormTaskIds.includes(taskId)) {
        return;
      }

      const definition = getShortFormQuestionDefinition(taskId);
      const partInputs = Array.from(shortFormWrap.querySelectorAll('[data-short-form-part="1"]'));
      const answerParts = {};

      partInputs.forEach((input) => {
        const key = String(input.getAttribute('data-part-key') || '').trim();
        if (!key) return;
        answerParts[key] = String(input.value || '').trim();
      });

      const missingPart = (definition && definition.parts || []).find((part) => !String(answerParts[part.key] || '').trim());
      if (missingPart) {
        const missingInput = shortFormWrap.querySelector(`[data-short-form-part="1"][data-part-key="${missingPart.key}"]`);
        window.alert('Please complete all parts before submitting.');
        if (missingInput && typeof missingInput.focus === 'function') {
          missingInput.focus();
        }
        return;
      }

      const answerText = (definition && definition.parts || [])
        .map((part) => `(${part.key}) ${String(answerParts[part.key] || '').trim()}`)
        .join('\n');

      track('short_form_answer_submitted', {
        question_id: taskId,
        task_id: taskId,
        task_label: String(state.task_label || '').trim(),
        response_message: answerText,
        response_parts: answerParts
      });

      const currentIndex = shortFormTaskIds.indexOf(taskId);
      const nextTaskId = currentIndex >= 0 && currentIndex < shortFormTaskIds.length - 1
        ? shortFormTaskIds[currentIndex + 1]
        : '';

      endTask('short_form_answer_submitted');

      if (nextTaskId) {
        const nextLabel = presetTaskDescriptions[nextTaskId] ? presetTaskDescriptions[nextTaskId].title : nextTaskId;
        startTask(nextTaskId, nextLabel);
      } else {
        enableResearchModeInUrl();
        renderResearchPanel();
      }

      shortFormRenderedTaskId = '';
      syncParticipantEndButton();
    });

    button.addEventListener('click', () => {
      track('task_end_clicked_by_participant', {
        task_id: getTaskState().task_id || ''
      });
      endTask('participant_clicked_end');
      syncParticipantEndButton();
      enableResearchModeInUrl();
      renderResearchPanel();
    });

    wrap.appendChild(shortFormWrap);
    wrap.appendChild(button);

    document.body.appendChild(wrap);
    return wrap;
  };

  const syncParticipantEndButton = () => {
    const wrap = ensureParticipantEndButton();
    const taskState = getTaskState();
    const taskId = String(taskState.task_id || '').trim();
    const isShortFormTask = /^short_form_q[1-4]$/i.test(taskId);
    const endBtn = document.getElementById('mtg-participant-end-task-btn');
    const shortFormWrap = document.getElementById('mtg-short-form-answer-wrap');
    const shortFormTaskHeader = document.getElementById('mtg-short-form-task-header');
    const shortFormElapsed = document.getElementById('mtg-short-form-task-elapsed');
    const shortFormPreamble = document.getElementById('mtg-short-form-task-preamble');
    const shortFormHint = document.getElementById('mtg-short-form-task-hint');
    const shortFormDetails = document.getElementById('mtg-short-form-details');
    const shortFormSteps = document.getElementById('mtg-short-form-task-steps');
    const shortFormLabel = document.getElementById('mtg-short-form-answer-label');
    const shortFormPrompt = document.getElementById('mtg-short-form-answer-prompt');
    const shortFormFields = document.getElementById('mtg-short-form-answer-fields');

    wrap.style.display = taskId ? 'block' : 'none';

    if (!taskId) {
      setTaskPromptExpanded(false);
      isShortFormCardExpanded = false;
      shortFormRenderedTaskId = '';
    }

    if (shortFormLabel) {
      const questionLabel = presetTaskDescriptions[taskId] ? presetTaskDescriptions[taskId].title : 'Short-form question';
      shortFormLabel.textContent = `Answer: ${questionLabel}`;
    }

    if (shortFormWrap) {
      shortFormWrap.style.display = isShortFormTask && taskId ? 'block' : 'none';
    }
    if (endBtn) {
      endBtn.style.display = isShortFormTask && taskId ? 'none' : 'inline-block';
    }

    if (!isShortFormTask || !taskId) {
      shortFormAutoFocusTaskId = '';
      shortFormRenderedTaskId = '';
      isShortFormCardExpanded = false;
      if (shortFormTaskHeader) {
        shortFormTaskHeader.innerHTML = '';
      }
      if (shortFormElapsed) {
        shortFormElapsed.textContent = '';
      }
      if (shortFormPreamble) {
        shortFormPreamble.textContent = '';
      }
      if (shortFormHint) {
        shortFormHint.textContent = '';
      }
      if (shortFormDetails) {
        shortFormDetails.style.display = 'none';
      }
      if (shortFormSteps) {
        shortFormSteps.innerHTML = '';
      }
      if (shortFormFields) {
        shortFormFields.innerHTML = '';
      }
      updateTaskCardSafeArea();
      return;
    }

    const definition = getShortFormQuestionDefinition(taskId);
    const startedAtMs = Date.parse(String(taskState.started_at || ''));
    const elapsedMs = Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : 0;
    const elapsedText = formatElapsedDuration(elapsedMs);

    if (shortFormTaskHeader) {
      shortFormTaskHeader.innerHTML = `
        <strong style="font-size:13px; color:#0f172a;">Task in progress</strong>
        <span style="font-size:11px; color:#475569; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:999px; padding:2px 8px;">${escapeHtml(taskId)}</span>
      `;
    }

    if (shortFormElapsed) {
      shortFormElapsed.textContent = `Elapsed: ${elapsedText}`;
    }

    if (shortFormPreamble) {
      shortFormPreamble.textContent = definition && definition.preamble
        ? definition.preamble
        : 'Review the scenario and complete the question.';
    }

    if (shortFormHint) {
      shortFormHint.textContent = isShortFormCardExpanded
        ? 'Move cursor away from this card to collapse.'
        : 'Hover this card to expand and answer.';
    }

    if (shortFormDetails) {
      shortFormDetails.style.display = isShortFormCardExpanded ? 'block' : 'none';
    }

    if (shortFormWrap) {
      shortFormWrap.style.maxHeight = isShortFormCardExpanded ? '64vh' : '160px';
      shortFormWrap.style.overflow = isShortFormCardExpanded ? 'auto' : 'hidden';
    }

    if (shortFormSteps) {
      const lines = definition && Array.isArray((presetTaskDescriptions[taskId] || {}).steps)
        ? (presetTaskDescriptions[taskId] || {}).steps
        : [];
      shortFormSteps.innerHTML = lines.length
        ? `<ul style="margin:0 0 0 18px; padding:0; display:grid; gap:6px;">${lines.map((line) => `<li style="line-height:1.35;">${escapeHtml(line)}</li>`).join('')}</ul>`
        : '';
    }

    if (!shortFormFields) {
      return;
    }

    if (shortFormRenderedTaskId !== taskId) {
      if (shortFormPrompt) {
        shortFormPrompt.textContent = 'Answer all parts below.';
      }

      const parts = definition && Array.isArray(definition.parts) ? definition.parts : [];
      shortFormFields.innerHTML = parts.map((part) => `
        <label style="display:grid; gap:4px;">
          <span style="font-size:12px; color:#0f172a; font-weight:600;">${escapeHtml(String(part.label || '').trim())}</span>
          <textarea
            data-short-form-part="1"
            data-part-key="${escapeHtml(String(part.key || '').trim())}"
            rows="2"
            placeholder="Type your answer for part ${escapeHtml(String(part.key || '').toUpperCase())}…"
            style="width:100%; box-sizing:border-box; padding:8px 10px; border:1px solid #cbd5e1; border-radius:8px; font-family:inherit; font-size:14px; resize:vertical; min-height:64px;"
          ></textarea>
        </label>
      `).join('');

      shortFormRenderedTaskId = taskId;
    }

    const activeElement = document.activeElement;
    const firstShortFormInput = shortFormWrap ? shortFormWrap.querySelector('[data-short-form-part="1"]') : null;
    const isTypingElsewhere = Boolean(
      activeElement
      && (!shortFormWrap || !shortFormWrap.contains(activeElement))
      && activeElement !== document.body
      && activeElement !== document.documentElement
      && (
        ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName)
        || activeElement.isContentEditable
        || (activeElement.closest && activeElement.closest('[contenteditable="true"], [role="textbox"]'))
      )
    );

    if (isShortFormCardExpanded && !isTypingElsewhere && firstShortFormInput && shortFormAutoFocusTaskId !== taskId) {
      firstShortFormInput.focus();
      shortFormAutoFocusTaskId = taskId;
    }

    updateTaskCardSafeArea();
  };

  const renderResearchPanel = (forceOpen = false) => {
    const presetTasks = [
      { id: 'scenario_card_1', label: 'Scenario Card 1 – First-Time Setup (Setup)' },
      { id: 'scenario_card_2', label: 'Scenario Card 2 – Fit and Start Therapy (Routine Use)' },
      { id: 'scenario_card_3', label: 'Scenario Card 3 – Comfort Adjustment (Troubleshooting)' },
      { id: 'short_form_q1', label: 'Short-Form Q1 – Cleaning frequency (Routine Use)' },
      { id: 'short_form_q2', label: 'Short-Form Q2 – Error message safety escalation (Error 006)' },
      { id: 'short_form_q3', label: 'Short-Form Q3 – Spare mask storage (Routine Use / Safety)' },
      { id: 'short_form_q4', label: 'Short-Form Q4 – Tubing length check (Setup)' }
    ];
    const CUSTOM_TASK_VALUE = '__custom__';
    const labelById = Object.fromEntries(presetTasks.map((task) => [task.id, task.label]));
    const idByLabel = Object.fromEntries(presetTasks.map((task) => [task.label, task.id]));
    const taskIdOptions = [
      '<option value="">Select task ID</option>',
      ...presetTasks.map((task) => `<option value="${task.id}">${task.id}</option>`),
      '<option value="__custom__">Custom task…</option>'
    ].join('');
    const taskLabelOptions = [
      '<option value="">Select task label</option>',
      ...presetTasks.map((task) => `<option value="${task.label}">${task.label}</option>`),
      '<option value="__custom__">Custom task…</option>'
    ].join('');

    const activeTask = getTaskState();
    if (activeTask.task_id) {
      const existingPanel = document.getElementById('mtg-research-panel');
      if (existingPanel) {
        existingPanel.remove();
      }
      return;
    }

    if (!forceOpen && !isResearchMode()) return;
    if (document.getElementById('mtg-research-panel')) return;

    const panel = document.createElement('aside');
    panel.id = 'mtg-research-panel';
    panel.style.position = 'fixed';
    panel.style.right = '12px';
    panel.style.bottom = '12px';
    panel.style.width = '380px';
    panel.style.maxWidth = 'calc(100vw - 24px)';
    panel.style.overflow = 'hidden';
    panel.style.background = '#ffffff';
    panel.style.border = '1px solid #d7dce5';
    panel.style.borderRadius = '10px';
    panel.style.boxShadow = '0 10px 24px rgba(0,0,0,0.15)';
    panel.style.padding = '12px';
    panel.style.zIndex = '9999';
    panel.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    panel.style.fontSize = '13px';
    panel.style.color = '#1f2937';

    panel.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; margin-bottom:8px;">
        <strong>Research Controls</strong>
        <button id="mtg-research-close" type="button" style="border:0;background:transparent;cursor:pointer;font-size:16px;line-height:1;">×</button>
      </div>
      <div style="display:grid; gap:8px;">
        <label style="display:grid; gap:4px;">
          <span>Participant ID</span>
          <input id="mtg-participant-input" type="text" placeholder="e.g. P01" style="width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;" />
        </label>
        <button id="mtg-participant-save" type="button" style="padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; cursor:pointer;">Save participant</button>
        <hr style="border:0; border-top:1px solid #e5e7eb; margin:2px 0;" />
        <label style="display:grid; gap:4px;">
          <span>Task ID</span>
          <select id="mtg-task-id-select" style="width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;">${taskIdOptions}</select>
        </label>
        <label style="display:grid; gap:4px;">
          <span>Task label</span>
          <select id="mtg-task-label-select" style="width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;">${taskLabelOptions}</select>
        </label>
        <label id="mtg-task-id-custom-wrap" style="display:none; gap:4px;">
          <span>Custom task ID</span>
          <input id="mtg-task-id-custom" type="text" placeholder="e.g. task_custom_1" style="width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;" />
        </label>
        <label id="mtg-task-label-custom-wrap" style="display:none; gap:4px;">
          <span>Custom task label</span>
          <input id="mtg-task-label-custom" type="text" placeholder="e.g. Additional scenario" style="width:100%; min-width:0; box-sizing:border-box; padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;" />
        </label>
        <div style="display:flex; gap:8px;">
          <button id="mtg-task-start" type="button" style="flex:1; padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; background:#ecfdf3; cursor:pointer;">Start task</button>
          <button id="mtg-task-end" type="button" style="flex:1; padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; background:#eff6ff; cursor:pointer;">End task</button>
        </div>
        <div id="mtg-task-timer" style="padding:7px 10px; border:1px solid #e5e7eb; border-radius:6px; background:#f8fafc; font-weight:600;">Task timer: 00:00</div>
        <button id="mtg-export-csv" type="button" style="padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; background:#fff7ed; cursor:pointer;">Export CSV</button>
        <div id="mtg-research-state" style="font-size:12px; color:#4b5563; overflow-wrap:anywhere;"></div>
      </div>
    `;

    document.body.appendChild(panel);

    const participantInput = document.getElementById('mtg-participant-input');
    const participantSave = document.getElementById('mtg-participant-save');
    const taskIdSelect = document.getElementById('mtg-task-id-select');
    const taskLabelSelect = document.getElementById('mtg-task-label-select');
    const taskIdCustomWrap = document.getElementById('mtg-task-id-custom-wrap');
    const taskLabelCustomWrap = document.getElementById('mtg-task-label-custom-wrap');
    const taskIdCustomInput = document.getElementById('mtg-task-id-custom');
    const taskLabelCustomInput = document.getElementById('mtg-task-label-custom');
    const taskStart = document.getElementById('mtg-task-start');
    const taskEnd = document.getElementById('mtg-task-end');
    const taskTimer = document.getElementById('mtg-task-timer');
    const exportCsvBtn = document.getElementById('mtg-export-csv');
    const stateText = document.getElementById('mtg-research-state');
    const closeBtn = document.getElementById('mtg-research-close');
    let timerInterval = null;

    const formatDuration = (durationMs) => {
      const totalSeconds = Math.max(0, Math.floor((durationMs || 0) / 1000));
      const minutes = Math.floor(totalSeconds / 60);
      const seconds = totalSeconds % 60;
      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };

    const updateTimer = () => {
      if (!taskTimer) return;
      const taskState = getTaskState();
      if (!taskState.task_id || !taskState.started_at) {
        const lastTaskResult = getLastTaskResult();
        if (Number.isFinite(lastTaskResult.duration_ms)) {
          taskTimer.textContent = `Last task: ${formatDuration(lastTaskResult.duration_ms)}`;
        } else {
          taskTimer.textContent = 'Task timer: 00:00';
        }
        return;
      }

      const startedAt = Date.parse(taskState.started_at);
      const durationMs = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : 0;
      taskTimer.textContent = `Task timer: ${formatDuration(durationMs)}`;
    };

    const ensureTimerRunning = () => {
      if (timerInterval) {
        window.clearInterval(timerInterval);
      }
      timerInterval = window.setInterval(updateTimer, 1000);
      updateTimer();
    };

    const isCustomTaskSelection = () => {
      return (taskIdSelect && taskIdSelect.value === CUSTOM_TASK_VALUE)
        || (taskLabelSelect && taskLabelSelect.value === CUSTOM_TASK_VALUE);
    };

    const syncCustomTaskVisibility = () => {
      const showCustom = isCustomTaskSelection();
      if (taskIdCustomWrap) {
        taskIdCustomWrap.style.display = showCustom ? 'grid' : 'none';
      }
      if (taskLabelCustomWrap) {
        taskLabelCustomWrap.style.display = showCustom ? 'grid' : 'none';
      }
    };

    const getSelectedTaskId = () => {
      if (isCustomTaskSelection()) {
        return String(taskIdCustomInput ? taskIdCustomInput.value : '').trim();
      }
      return String(taskIdSelect ? taskIdSelect.value : '').trim();
    };

    const getSelectedTaskLabel = () => {
      if (isCustomTaskSelection()) {
        return String(taskLabelCustomInput ? taskLabelCustomInput.value : '').trim();
      }
      return String(taskLabelSelect ? taskLabelSelect.value : '').trim();
    };

    const syncFromTaskId = () => {
      if (!taskIdSelect || !taskLabelSelect) return;
      if (taskIdSelect.value === CUSTOM_TASK_VALUE) {
        taskLabelSelect.value = CUSTOM_TASK_VALUE;
        syncCustomTaskVisibility();
        return;
      }

      const matchingLabel = labelById[taskIdSelect.value] || '';
      if (matchingLabel) {
        taskLabelSelect.value = matchingLabel;
      }
      syncCustomTaskVisibility();
    };

    const syncFromTaskLabel = () => {
      if (!taskIdSelect || !taskLabelSelect) return;
      if (taskLabelSelect.value === CUSTOM_TASK_VALUE) {
        taskIdSelect.value = CUSTOM_TASK_VALUE;
        syncCustomTaskVisibility();
        return;
      }

      const matchingId = idByLabel[taskLabelSelect.value] || '';
      if (matchingId) {
        taskIdSelect.value = matchingId;
      }
      syncCustomTaskVisibility();
    };

    const refreshState = () => {
      const participantId = getParticipantId();
      const taskState = getTaskState();
      if (participantInput) {
        participantInput.value = participantId;
      }

      if (taskState.task_id) {
        if (taskIdSelect) {
          taskIdSelect.value = labelById[taskState.task_id] ? taskState.task_id : CUSTOM_TASK_VALUE;
        }
        if (taskLabelSelect) {
          taskLabelSelect.value = taskState.task_label && idByLabel[taskState.task_label]
            ? taskState.task_label
            : (labelById[taskState.task_id] || CUSTOM_TASK_VALUE);
        }
        if (taskIdCustomInput) {
          taskIdCustomInput.value = labelById[taskState.task_id] ? '' : taskState.task_id;
        }
        if (taskLabelCustomInput) {
          taskLabelCustomInput.value = idByLabel[taskState.task_label] ? '' : (taskState.task_label || '');
        }
      }
      syncCustomTaskVisibility();

      const taskSummary = taskState.task_id
        ? `Active task: ${taskState.task_id}${taskState.task_label ? ` (${taskState.task_label})` : ''}`
        : 'No active task';
      if (stateText) {
        stateText.textContent = `Participant: ${participantId || 'not set'} • ${taskSummary}`;
      }

      updateTimer();
    };

    if (participantSave) {
      participantSave.addEventListener('click', () => {
        setParticipantId(participantInput ? participantInput.value : '');
        refreshState();
      });
    }

    if (taskStart) {
      taskStart.addEventListener('click', () => {
        const participantId = String(participantInput ? participantInput.value : '').trim();
        const taskId = getSelectedTaskId();
        const taskLabel = getSelectedTaskLabel();

        if (!participantId || !taskId) {
          window.alert('Please set both Participant ID and Task ID before starting a task.');
          refreshState();
          return;
        }

        setParticipantId(participantId);
        startTask(taskId, taskLabel);
        disableResearchModeInUrl();
        panel.remove();
        refreshState();
      });
    }

    if (taskIdSelect) {
      taskIdSelect.addEventListener('change', syncFromTaskId);
    }

    if (taskLabelSelect) {
      taskLabelSelect.addEventListener('change', syncFromTaskLabel);
    }

    if (taskEnd) {
      taskEnd.addEventListener('click', () => {
        endTask('ended');
        refreshState();
      });
    }

    if (exportCsvBtn) {
      exportCsvBtn.addEventListener('click', () => {
        const exportUrl = getExportUrl();
        window.open(exportUrl, '_blank', 'noopener,noreferrer');
      });
    }

    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        if (timerInterval) {
          window.clearInterval(timerInterval);
          timerInterval = null;
        }
        panel.remove();
      });
    }

    ensureTimerRunning();
    syncCustomTaskVisibility();
    refreshState();
  };

  const init = () => {
    hydrateParticipantFromUrl();
    hydrateLastTaskResultFromUrl();
    hydrateTaskStateFromUrl();
    if (isTaskSubscribedInTab() && !getSharedTaskState().task_id) {
      setTaskSubscribedInTab(false);
    }
    getOrCreateSessionId();
    track('page_view', {
      referrer: document.referrer || ''
    });
    let visibleSegmentStartedAtMs = document.visibilityState === 'visible' ? Date.now() : null;

    const emitVisibleSegmentExit = () => {
      if (!Number.isFinite(visibleSegmentStartedAtMs)) {
        return;
      }

      const durationMs = Math.max(0, Date.now() - visibleSegmentStartedAtMs);
      track('page_exit', {
        duration_ms: durationMs
      });
      visibleSegmentStartedAtMs = null;
    };

    reconcileTaskStateFromServer('init');

    if (!taskStateSyncState.intervalId) {
      taskStateSyncState.intervalId = window.setInterval(() => {
        if (document.visibilityState === 'visible') {
          reconcileTaskStateFromServer('interval');
        }
      }, 3000);
    }

    initVideoTelemetry();

    syncParticipantEndButton();
    syncTaskPromptCard();

    renderResearchPanel();

    document.addEventListener('click', (event) => {
      const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link) return;

      const originalHref = link.getAttribute('href') || '';
      if (!originalHref || originalHref.startsWith('#')) return;

      const decoratedHref = decorateNavigationHref(originalHref);
      if (decoratedHref && decoratedHref !== originalHref) {
        link.setAttribute('href', decoratedHref);
      }

      track('nav_click', {
        target_href: link.getAttribute('href') || originalHref,
        link_text: (link.textContent || '').trim().slice(0, 140)
      });
    });

    window.addEventListener('pagehide', () => {
      emitVisibleSegmentExit();
    });

    window.addEventListener('storage', (event) => {
      if (event.key === taskStateKey) {
        reconcileSharedTaskState();
        syncTaskPromptCard();
      }

      if (event.key === participantKey || event.key === lastTaskResultKey) {
        syncParticipantEndButton();
      }
    });

    window.addEventListener('focus', reconcileSharedTaskState);
    window.addEventListener('focus', () => {
      reconcileTaskStateFromServer('focus');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        if (!Number.isFinite(visibleSegmentStartedAtMs)) {
          visibleSegmentStartedAtMs = Date.now();
          track('page_view', {
            referrer: ''
          });
        }
        reconcileSharedTaskState();
        reconcileTaskStateFromServer('visible');
        syncTaskPromptCard();
        return;
      }

      if (document.visibilityState === 'hidden') {
        emitVisibleSegmentExit();
      }
    });

    window.addEventListener('resize', () => {
      updateTaskCardSafeArea();
    });

    window.setInterval(() => {
      syncParticipantEndButton();
      syncTaskPromptCard();
    }, 1000);
  };

  window.MTGTelemetry = {
    init,
    track,
    setParticipantId,
    startTask,
    endTask,
    getContext,
    getActiveTaskContext
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();
