(function () {
  if (window.MTGTelemetry) return;

  const sessionKey = 'mtg-telemetry-session-id';
  const participantKey = 'mtg-telemetry-participant-id';
  const taskStateKey = 'mtg-telemetry-task-state';
  const lastTaskResultKey = 'mtg-telemetry-last-task-result';
  const tabTaskSubscribedKey = 'mtg-telemetry-tab-task-subscribed';
  const shortFormDraftsKey = 'mtg-telemetry-short-form-drafts';
  const participantNextTaskStateKey = 'mtg-telemetry-participant-next-task';
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

  const updateChatDockForTaskCardOverlap = () => {
    const dock = document.querySelector('.mobile-chat-dock');
    if (!dock) {
      return;
    }

    const dockRect = dock.getBoundingClientRect();
    const callout = dock.querySelector('.mobile-chat-callout');
    const targetRect = callout && isElementVisibleForLayout(callout)
      ? callout.getBoundingClientRect()
      : dockRect;

    if (!Number.isFinite(targetRect.width) || !Number.isFinite(targetRect.height) || targetRect.width <= 0 || targetRect.height <= 0) {
      return;
    }

    if (!dock.dataset.mtgBaseBottom) {
      const computed = window.getComputedStyle(dock);
      const parsed = Number.parseFloat(String(computed.bottom || '0'));
      dock.dataset.mtgBaseBottom = String(Number.isFinite(parsed) ? parsed : 10);
    }

    const baseBottom = Number.parseFloat(dock.dataset.mtgBaseBottom || '10');
    const candidates = [
      document.getElementById('mtg-task-prompt-card'),
      document.getElementById('mtg-participant-end-task-wrap'),
      document.getElementById('mtg-trial-intro-overlay-card')
    ];

    let extraBottomPx = 0;
    candidates.forEach((element) => {
      if (!isElementVisibleForLayout(element)) {
        return;
      }

      const rect = element.getBoundingClientRect();
      const overlapsHorizontally = rect.left < targetRect.right && rect.right > targetRect.left;
      const overlapsVertically = rect.top < targetRect.bottom && rect.bottom > targetRect.top;
      if (!overlapsHorizontally || !overlapsVertically) {
        return;
      }

      const pushUp = Math.ceil(rect.bottom - targetRect.top + 12);
      if (pushUp > extraBottomPx) {
        extraBottomPx = pushUp;
      }
    });

    dock.style.bottom = `${Math.max(baseBottom, baseBottom + extraBottomPx)}px`;
  };

  const updateTaskCardSafeArea = () => {
    if (!document.body) return;
    ensureBaseBodyPaddingBottom();

    const candidates = [
      document.getElementById('mtg-task-prompt-card'),
      document.getElementById('mtg-participant-end-task-wrap'),
      document.getElementById('mtg-trial-intro-overlay-card')
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
    updateChatDockForTaskCardOverlap();
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

  const participantTaskOrder = [
    'scenario_card_1',
    'scenario_card_2',
    'scenario_card_3',
    'short_form_q1',
    'short_form_q2',
    'short_form_q3',
    'short_form_q4'
  ];

  const scenarioTaskCapMs = 5 * 60 * 1000;
  const shortFormTaskCapMs = 90 * 1000;

  const getTaskCapMs = (taskId) => {
    const key = String(taskId || '').trim();
    if (!key) return null;
    if (/^scenario_card_\d+$/i.test(key)) return scenarioTaskCapMs;
    if (/^short_form_q[1-4]$/i.test(key)) return shortFormTaskCapMs;
    return null;
  };

  const getElapsedMsForTaskState = (taskState) => {
    if (!taskState || !taskState.task_id || !taskState.started_at) {
      return 0;
    }

    const startedAtMs = Date.parse(String(taskState.started_at || ''));
    return Number.isFinite(startedAtMs) ? Math.max(0, Date.now() - startedAtMs) : 0;
  };

  const getDisplayedElapsedMsForTaskState = (taskState) => {
    const elapsedMs = getElapsedMsForTaskState(taskState);
    const capMs = getTaskCapMs(taskState && taskState.task_id);
    if (!Number.isFinite(capMs)) {
      return elapsedMs;
    }
    return Math.min(elapsedMs, capMs);
  };

  const getTaskDisplayLabel = (taskId) => {
    const key = String(taskId || '').trim();
    if (!key) return '';
    const entry = presetTaskDescriptions[key];
    if (entry && entry.title) {
      return String(entry.title).trim();
    }
    return key;
  };

  const getNextTaskIdInSequence = (taskId) => {
    const key = String(taskId || '').trim();
    const index = participantTaskOrder.indexOf(key);
    if (index < 0 || index >= participantTaskOrder.length - 1) {
      return '';
    }
    return participantTaskOrder[index + 1] || '';
  };

  const getParticipantNextTaskState = () => safeJsonParse(localStorage.getItem(participantNextTaskStateKey) || '{}', {});

  const setParticipantNextTaskState = (state) => {
    localStorage.setItem(participantNextTaskStateKey, JSON.stringify(state || {}));
  };

  const clearParticipantNextTaskState = () => {
    localStorage.removeItem(participantNextTaskStateKey);
  };

  const getShortFormDrafts = () => safeJsonParse(localStorage.getItem(shortFormDraftsKey) || '{}', {});

  const getShortFormDraft = (taskId) => {
    const key = String(taskId || '').trim();
    if (!key) return null;
    const drafts = getShortFormDrafts();
    const draft = drafts && typeof drafts === 'object' ? drafts[key] : null;
    return draft && typeof draft === 'object' && !Array.isArray(draft) ? draft : null;
  };

  const setShortFormDraft = (taskId, draftParts) => {
    const key = String(taskId || '').trim();
    if (!key) return;

    const drafts = getShortFormDrafts();
    const nextDrafts = drafts && typeof drafts === 'object' ? { ...drafts } : {};
    nextDrafts[key] = draftParts && typeof draftParts === 'object' && !Array.isArray(draftParts)
      ? draftParts
      : {};
    localStorage.setItem(shortFormDraftsKey, JSON.stringify(nextDrafts));
  };

  const clearShortFormDraft = (taskId) => {
    const key = String(taskId || '').trim();
    if (!key) return;

    const drafts = getShortFormDrafts();
    if (!drafts || typeof drafts !== 'object' || Array.isArray(drafts) || !Object.prototype.hasOwnProperty.call(drafts, key)) {
      return;
    }

    const nextDrafts = { ...drafts };
    delete nextDrafts[key];
    localStorage.setItem(shortFormDraftsKey, JSON.stringify(nextDrafts));
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
    const participantNextState = getParticipantNextTaskState();
    const hasParticipantTransitionState = Boolean(
      participantNextState
      && (
        String(participantNextState.next_task_id || '').trim()
        || String(participantNextState.status || '').trim() === 'completed'
      )
    );

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
        if (!hasParticipantTransitionState) {
          renderResearchPanel(true);
        }
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
      if (!hasParticipantTransitionState) {
        renderResearchPanel(true);
      }
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
    intervalId: null,
    localTransitionUntilMs: 0
  };

  const markLocalTaskTransition = (durationMs = 4500) => {
    const windowMs = Number.isFinite(Number(durationMs)) ? Math.max(0, Number(durationMs)) : 4500;
    taskStateSyncState.localTransitionUntilMs = Date.now() + windowMs;
  };

  const getTaskStateApiUrl = () => getApiUrl().replace(/\/api\/telemetry$/, '/api/telemetry/task-state');

  const reconcileTaskStateFromServer = async (reason) => {
    const participantId = String(getParticipantId() || '').trim();
    if (!participantId || taskStateSyncState.inFlight) {
      return;
    }

    const now = Date.now();
    if (now < Number(taskStateSyncState.localTransitionUntilMs || 0)) {
      return;
    }

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
        const localStartedAtMs = Date.parse(localStartedAt);
        const serverStartedAtMs = Date.parse(String(serverTask.started_at || ''));
        const transitionGuardActive = Date.now() < Number(taskStateSyncState.localTransitionUntilMs || 0);
        const localTaskAppearsNewerThanServer = localTaskId
          && localTaskId !== serverTask.task_id
          && Number.isFinite(localStartedAtMs)
          && (!Number.isFinite(serverStartedAtMs) || localStartedAtMs > (serverStartedAtMs + 250));

        if ((transitionGuardActive && localTaskId && localTaskId !== serverTask.task_id) || localTaskAppearsNewerThanServer) {
          if (!isTaskSubscribedInTab()) {
            setTaskSubscribedInTab(true);
          }
          markTaskActiveInUrl(localTask);
          enableResearchModeInUrl();
          syncParticipantEndButton();
          syncTaskPromptCard();
          return;
        }

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
      const sharedStartedAtMs = Date.parse(String(sharedTask.started_at || ''));
      const sharedTaskStartedRecently = Number.isFinite(sharedStartedAtMs)
        && (Date.now() - sharedStartedAtMs) < 15000;
      const transitionGuardActive = Date.now() < Number(taskStateSyncState.localTransitionUntilMs || 0);
      if ((transitionGuardActive || sharedTaskStartedRecently) && String(sharedTask.task_id || '').trim()) {
        if (!isTaskSubscribedInTab()) {
          setTaskSubscribedInTab(true);
        }
        markTaskActiveInUrl(sharedTask);
        enableResearchModeInUrl();
        syncParticipantEndButton();
        syncTaskPromptCard();
        return;
      }

      if (String(sharedTask.task_id || '').trim()) {
        setTaskState({});
      }

      const participantNextState = getParticipantNextTaskState();
      const hasParticipantTransitionState = Boolean(
        participantNextState
        && (
          String(participantNextState.next_task_id || '').trim()
          || String(participantNextState.status || '').trim() === 'completed'
        )
      );

      if (isTaskSubscribedInTab()) {
        setTaskSubscribedInTab(false);
        markTaskClearedInUrl();
        if (!hasParticipantTransitionState) {
          renderResearchPanel(true);
        }
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
        '(b) What is the recommended cleaning frequency for the F&P Vitera mask (excluding headgear)?',
        '(c) What is the recommended cleaning frequency for the headgear?',
        '(d) What is the recommended cleaning frequency for ClimateLineAir tubing?'
      ],
      parts: [
        { key: 'a', label: '(a) CPAP device and humidifier frequency' },
        { key: 'b', label: '(b) F&P Vitera mask (excluding headgear) frequency' },
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
      title: 'Short-Form Q3 – Spare F&P Vitera mask storage (Routine Use / Safety)',
      preamble: 'You receive a spare F&P Vitera mask and need to store it until your current one wears out, while keeping it in good condition for future use.',
      steps: [
        '(a) How should a spare F&P Vitera mask be stored?',
        '(b) What is the recommended storage temperature range (in °C)?'
      ],
      parts: [
        { key: 'a', label: '(a) F&P Vitera mask storage method/conditions' },
        { key: 'b', label: '(b) Storage temperature range (°C)' }
      ]
    },
    short_form_q4: {
      title: 'Short-Form Q4 – Tubing length check (Setup)',
      preamble: 'Your bedroom layout means the machine sits about 7 feet from where your mask connects, so you need to check whether ClimateLineAir Oxy tubing will reach comfortably.',
      steps: [
        '(a) Is ClimateLineAir Oxy tubing long enough for 7 feet?',
        '(b) What is the length of ClimateLineAir Oxy tubing (in feet)?'
      ],
      parts: [
        { key: 'a', label: '(a) Long enough for 7 feet? (yes/no)' },
        { key: 'b', label: '(b) Tubing length (feet)' }
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

  const getShortFormSectionPrompt = (parts) => {
    if (!Array.isArray(parts) || !parts.length) {
      return 'Provide your response below.';
    }

    const keys = parts
      .map((part) => String(part && part.key || '').trim().toLowerCase())
      .filter(Boolean);

    if (!keys.length) {
      return 'Provide your response below.';
    }

    if (keys.length === 1) {
      return `Provide your response for section (${keys[0]}) below.`;
    }

    return `Provide your response for each section (${keys[0]})-(${keys[keys.length - 1]}) below.`;
  };

  const getShortFormCompletionSummary = (taskId, rawParts) => {
    const definition = getShortFormQuestionDefinition(taskId);
    const orderedParts = Array.isArray(definition && definition.parts) ? definition.parts : [];
    const expectedKeys = orderedParts
      .map((part) => String(part && part.key || '').trim())
      .filter(Boolean);

    if (!expectedKeys.length) {
      return {
        isIncomplete: false,
        answeredCount: Object.keys(rawParts && typeof rawParts === 'object' ? rawParts : {}).length,
        totalCount: 0
      };
    }

    const normalized = rawParts && typeof rawParts === 'object' ? rawParts : {};
    const answeredCount = expectedKeys.filter((key) => {
      return Object.prototype.hasOwnProperty.call(normalized, key)
        && String(normalized[key] || '').trim().length > 0;
    }).length;

    return {
      isIncomplete: answeredCount < expectedKeys.length,
      answeredCount,
      totalCount: expectedKeys.length
    };
  };

  const collectPopulatedShortFormAnswers = (rawParts) => {
    const next = {};
    Object.entries(rawParts && typeof rawParts === 'object' ? rawParts : {}).forEach(([key, value]) => {
      const partKey = String(key || '').trim();
      const text = String(value || '').trim();
      if (!partKey || !text) return;
      next[partKey] = text;
    });
    return next;
  };

  const submitPartialShortFormAnswer = (taskId, taskLabel, rawParts, taskStatus, options = {}) => {
    const key = String(taskId || '').trim();
    if (!/^short_form_q[1-4]$/i.test(key)) {
      return false;
    }

    const forceNullWhenEmpty = Boolean(options && options.forceNullWhenEmpty);
    let responseParts = collectPopulatedShortFormAnswers(rawParts);
    const definition = getShortFormQuestionDefinition(key);
    const orderedParts = Array.isArray(definition && definition.parts) ? definition.parts : [];

    if (!Object.keys(responseParts).length && forceNullWhenEmpty) {
      responseParts = {};
      orderedParts.forEach((part) => {
        const partKey = String(part && part.key || '').trim();
        if (!partKey) return;
        responseParts[partKey] = null;
      });
    }

    if (!Object.keys(responseParts).length) {
      return false;
    }

    const answerText = orderedParts.length
      ? orderedParts
        .map((part) => {
          const partKey = String(part && part.key || '').trim();
          const text = responseParts[partKey];
          return text ? `(${partKey}) ${text}` : '';
        })
        .filter(Boolean)
        .join('\n')
      : Object.entries(responseParts).map(([partKey, text]) => `(${partKey}) ${text}`).join('\n');

    track('short_form_answer_submitted', {
      question_id: key,
      task_id: key,
      task_label: String(taskLabel || '').trim(),
      response_message: answerText,
      response_parts: responseParts,
      task_status: String(taskStatus || '').trim()
    });

    clearShortFormDraft(key);
    return true;
  };

  const ensureTaskPromptCard = () => {
    const existing = document.getElementById('mtg-task-prompt-card');
    if (existing) return existing;

    const card = document.createElement('aside');
    card.id = 'mtg-task-prompt-card';
    card.style.position = 'fixed';
    card.style.left = '50%';
    card.style.bottom = '12px';
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

  const removeTrialIntroOverlayCard = () => {
    const existing = document.getElementById('mtg-trial-intro-overlay-card');
    if (existing) {
      existing.remove();
      updateTaskCardSafeArea();
    }
  };

  const showTrialIntroOverlayCard = ({ participantId, taskId, taskLabel }) => {
    removeTrialIntroOverlayCard();

    const card = document.createElement('aside');
    card.id = 'mtg-trial-intro-overlay-card';
    card.style.position = 'fixed';
    card.style.left = '50%';
    card.style.bottom = '96px';
    card.style.transform = 'translateX(-50%)';
    card.style.width = 'min(720px, calc(100vw - 24px))';
    card.style.maxWidth = 'calc(100vw - 24px)';
    card.style.maxHeight = '42vh';
    card.style.overflow = 'auto';
    card.style.background = '#ecfdf5';
    card.style.border = '1px solid #34d399';
    card.style.borderRadius = '10px';
    card.style.boxShadow = '0 10px 24px rgba(16, 185, 129, 0.18)';
    card.style.padding = '12px';
    card.style.zIndex = '9700';
    card.style.fontFamily = 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif';
    card.style.color = '#1f2937';

    card.innerHTML = `
      <div style="font-size:18px; font-weight:700; color:#0f172a; margin-bottom:6px; line-height:1.25;">About this trial</div>
      <div style="font-size:16px; color:#334155; line-height:1.55;">
        You will complete 7 activities in total: 3 practical scenarios followed by 4 short questions.<br />
        Task timings, completion outcomes, and task responses/interactions will be recorded for research purposes only.<br />
        Each scenario has a 5:00-minute time limit, and each question has a 1:30-minute time limit.<br />
        You may find it helpful to focus on information that is most relevant to each task, given the time limit.<br />
        Question tasks have multiple sections; type each section answer as soon as you find it so it is logged.<br />
        When you finish a task, click “I have completed this task”.<br />
        Once a task is marked complete, you cannot return to it and it is treated as finished.<br />
        Work through the tasks in order using the on-screen buttons.<br />
        A timer runs for each activity, and your progress is recorded automatically.<br />
        Once you click Start trial, the timer for the first task starts immediately.
      </div>
      <div style="display:flex; justify-content:flex-end; margin-top:10px;">
        <button data-role="start-trial" type="button" style="padding:8px 12px; border:1px solid #0f766e; border-radius:999px; background:#0f766e; color:#fff; cursor:pointer; font-weight:600;">Start trial</button>
      </div>
    `;

    const startButton = card.querySelector('[data-role="start-trial"]');
    if (startButton) {
      startButton.addEventListener('click', () => {
        setParticipantId(participantId);
        startTask(taskId, taskLabel);
        disableResearchModeInUrl();
        removeTrialIntroOverlayCard();
      });
    }

    document.body.appendChild(card);
    updateTaskCardSafeArea();
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

  const lockVisibleShortFormInputsForTimeout = () => {
    const shortFormWrap = document.getElementById('mtg-short-form-answer-wrap');
    if (!shortFormWrap) {
      return;
    }

    const partInputs = Array.from(shortFormWrap.querySelectorAll('[data-short-form-part="1"]'));
    partInputs.forEach((input) => {
      input.disabled = true;
      input.style.background = '#e5e7eb';
      input.style.color = '#6b7280';
      input.style.cursor = 'not-allowed';
    });

    const submitButton = document.getElementById('mtg-short-form-answer-submit');
    if (submitButton) {
      submitButton.disabled = true;
      submitButton.style.opacity = '0.65';
      submitButton.style.cursor = 'not-allowed';
      submitButton.textContent = 'Time limit reached';
    }
  };

  const formatElapsedDuration = (durationMs) => {
    const totalSeconds = Math.max(0, Math.floor((durationMs || 0) / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  };

  const handleParticipantTaskFinished = () => {
    const state = getTaskState();
    const currentTaskId = String(state.task_id || '').trim();
    const nextTaskId = getNextTaskIdInSequence(currentTaskId);

    if (nextTaskId) {
      setParticipantNextTaskState({
        status: 'next',
        current_task_id: currentTaskId,
        next_task_id: nextTaskId,
        next_task_label: getTaskDisplayLabel(nextTaskId)
      });
    } else {
      setParticipantNextTaskState({
        status: 'completed'
      });
    }

    track('task_end_clicked_by_participant', {
      task_id: currentTaskId || ''
    });
    endTask('participant_clicked_end');
    syncParticipantEndButton();
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
    const isScenarioTask = /^scenario_card_\d+$/i.test(taskId);
    if (isShortFormTask) {
      isTaskPromptExpanded = false;
      card.style.display = 'none';
      card.innerHTML = '';
      updateTaskCardSafeArea();
      return;
    }

    const capMs = getTaskCapMs(taskId);
    const elapsedMs = getDisplayedElapsedMsForTaskState(taskState);
    const elapsedText = formatElapsedDuration(elapsedMs);
    const elapsedWithCapText = Number.isFinite(capMs)
      ? `${elapsedText} / ${formatElapsedDuration(capMs)}`
      : elapsedText;
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
      : 'When finished, click “I have completed this task”.';
    const instructionsLine = lines.find((line) => /you may use the instructions at any time/i.test(String(line || '')));
    const detailLines = lines.filter((line, index) => {
      if (index !== 0) return true;
      return String(line || '').trim().toLowerCase() !== scenarioDescription.toLowerCase();
    }).filter((line) => {
      if (!isScenarioTask) return true;
      return !/you may use the instructions at any time/i.test(String(line || ''));
    });
    const listMarkup = detailLines.length
      ? `<ul style="margin:0 0 0 18px; padding:0; display:grid; gap:6px;">${detailLines.map((line) => `<li style="line-height:1.35;">${escapeHtml(line)}</li>`).join('')}</ul>`
      : '';

    card.innerHTML = `
      <div style="display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <strong style="font-size:13px; color:#0f172a;">Task in progress</strong>
      </div>
      <div style="margin-top:6px; font-size:12px; color:#334155; font-weight:600;">Elapsed: ${escapeHtml(elapsedWithCapText)}</div>
      <div style="margin-top:8px; color:#334155; line-height:1.4; font-size:14px; overflow:hidden; display:${scenarioDescription ? '-webkit-box' : 'none'}; -webkit-line-clamp:${isExpanded ? '3' : '2'}; -webkit-box-orient:vertical;">${escapeHtml(scenarioDescription)}</div>
      <div style="margin-top:6px; color:#334155; line-height:1.4; font-size:13px; display:${isExpanded && isScenarioTask && instructionsLine ? 'block' : 'none'};">${escapeHtml(String(instructionsLine || ''))}</div>
      <div style="margin-top:6px; color:#334155; line-height:1.35; font-size:12px; display:${isExpanded ? 'block' : 'none'};">${escapeHtml(completionInstruction)}</div>
      <div style="margin-top:6px; font-size:11px; color:#64748b;">${escapeHtml(promptHint)}</div>
      <div style="margin-top:8px; display:${isExpanded ? 'block' : 'none'};">
        <div style="font-size:13px; font-weight:600; line-height:1.3; display:${isScenarioTask ? 'none' : 'block'};">${escapeHtml(displayLabel)}</div>
        <div style="margin-top:8px; font-size:12px; color:#334155; line-height:1.35;">${listMarkup}</div>
      </div>
      <div style="position:sticky; bottom:0; margin-top:8px; padding-top:8px; background:#ecfdf5; display:flex; justify-content:flex-end; border-top:1px solid #d1fae5;">
        <button id="mtg-task-prompt-finish-btn" type="button" style="padding:6px 10px; border:1px solid #0f766e; background:#0f766e; color:#ffffff; border-radius:999px; font-size:12px; font-weight:600; cursor:pointer; white-space:nowrap;">I have completed this task</button>
      </div>
    `;
    card.style.bottom = '12px';
    card.style.maxHeight = isExpanded ? '42vh' : (scenarioDescription ? '150px' : '128px');
    card.style.overflow = isExpanded ? 'auto' : 'hidden';
    card.style.display = 'block';

    const finishBtn = card.querySelector('#mtg-task-prompt-finish-btn');
    if (finishBtn) {
      finishBtn.addEventListener('click', handleParticipantTaskFinished);
    }

    updateTaskCardSafeArea();
  };

  const startTask = (taskId, label) => {
    if (!taskId) return;
    clearParticipantNextTaskState();
    const nextState = {
      task_id: String(taskId),
      task_label: String(label || ''),
      started_at: new Date().toISOString()
    };
    setTaskSubscribedInTab(true);
    setTaskState(nextState);
    markLocalTaskTransition();
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
    const rawDurationMs = Number.isFinite(startedAt) ? Math.max(0, Date.now() - startedAt) : null;
    const capMs = getTaskCapMs(state.task_id);
    const durationMs = Number.isFinite(rawDurationMs)
      ? (Number.isFinite(capMs) ? Math.min(rawDurationMs, capMs) : rawDurationMs)
      : null;

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
    markLocalTaskTransition();
    markTaskClearedInUrl();
    syncTaskPromptCard();
  };

  let taskCapProcessing = false;
  const maybeApplyActiveTaskTimeCap = () => {
    if (taskCapProcessing) {
      return;
    }

    const state = getTaskState();
    const currentTaskId = String(state.task_id || '').trim();
    if (!currentTaskId) {
      return;
    }

    const capMs = getTaskCapMs(currentTaskId);
    if (!Number.isFinite(capMs)) {
      return;
    }

    const elapsedMs = getElapsedMsForTaskState(state);
    if (elapsedMs < capMs) {
      return;
    }

    taskCapProcessing = true;
    try {
      const nextTaskId = getNextTaskIdInSequence(currentTaskId);

      if (/^short_form_q[1-4]$/i.test(currentTaskId)) {
        lockVisibleShortFormInputsForTimeout();
        submitPartialShortFormAnswer(
          currentTaskId,
          state.task_label || '',
          getShortFormDraft(currentTaskId) || {},
          'time_cap_reached',
          { forceNullWhenEmpty: true }
        );
      }

      if (nextTaskId) {
        setParticipantNextTaskState({
          status: 'next',
          current_task_id: currentTaskId,
          next_task_id: nextTaskId,
          next_task_label: getTaskDisplayLabel(nextTaskId),
          transition_reason: 'time_cap_reached'
        });
      } else {
        setParticipantNextTaskState({
          status: 'completed',
          transition_reason: 'time_cap_reached'
        });
      }

      track('task_time_cap_reached', {
        task_id: currentTaskId,
        task_label: String(state.task_label || ''),
        duration_ms: capMs
      });

      endTask('time_cap_reached');
      syncParticipantEndButton();
    } finally {
      taskCapProcessing = false;
    }
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
    shortFormHint.style.marginTop = '8px';
    shortFormHint.style.textAlign = 'right';

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
    shortFormDetails.appendChild(shortFormSteps);
    shortFormDetails.appendChild(shortFormLabel);
    shortFormDetails.appendChild(shortFormPrompt);
    shortFormDetails.appendChild(shortFormFields);
    shortFormDetails.appendChild(shortFormSubmit);
    shortFormWrap.appendChild(shortFormDetails);
    shortFormWrap.appendChild(shortFormHint);

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
    button.textContent = 'I have completed this task';

    const shortFormTaskIds = ['short_form_q1', 'short_form_q2', 'short_form_q3', 'short_form_q4'];

    shortFormSubmit.addEventListener('click', () => {
      const state = getTaskState();
      const taskId = String(state.task_id || '').trim();
      if (!shortFormTaskIds.includes(taskId)) {
        return;
      }

      const partInputs = Array.from(shortFormWrap.querySelectorAll('[data-short-form-part="1"]'));
      const answerParts = {};

      partInputs.forEach((input) => {
        const key = String(input.getAttribute('data-part-key') || '').trim();
        if (!key) return;
        answerParts[key] = String(input.value || '').trim();
      });

      const completion = getShortFormCompletionSummary(taskId, answerParts);
      const hasAnyAnswer = Object.values(answerParts).some((value) => String(value || '').trim().length > 0);
      if (completion.isIncomplete) {
        const confirmed = window.confirm(
          `You have answered ${completion.answeredCount} of ${completion.totalCount} sections. Submit your answer anyway?`
        );
        if (!confirmed) {
          return;
        }
      }

      const submittedAny = submitPartialShortFormAnswer(
        taskId,
        String(state.task_label || '').trim(),
        answerParts,
        'short_form_answer_submitted',
        { forceNullWhenEmpty: !hasAnyAnswer }
      );
      if (!submittedAny) {
        window.alert('Please provide at least one answer before submitting.');
        return;
      }

      const currentIndex = shortFormTaskIds.indexOf(taskId);
      const nextTaskId = currentIndex >= 0 && currentIndex < shortFormTaskIds.length - 1
        ? shortFormTaskIds[currentIndex + 1]
        : '';

      endTask('short_form_answer_submitted');

      if (nextTaskId) {
        const nextLabel = presetTaskDescriptions[nextTaskId] ? presetTaskDescriptions[nextTaskId].title : nextTaskId;
        startTask(nextTaskId, nextLabel);
      } else {
        setParticipantNextTaskState({
          status: 'completed'
        });
      }

      shortFormRenderedTaskId = '';
      syncParticipantEndButton();
    });

    button.addEventListener('click', handleParticipantTaskFinished);

    const participantNextWrap = document.createElement('div');
    participantNextWrap.id = 'mtg-participant-next-task-wrap';
    participantNextWrap.style.display = 'none';
    participantNextWrap.style.background = '#ecfdf5';
    participantNextWrap.style.border = '1px solid #34d399';
    participantNextWrap.style.borderRadius = '10px';
    participantNextWrap.style.boxShadow = '0 10px 24px rgba(16, 185, 129, 0.2)';
    participantNextWrap.style.padding = '10px';
    participantNextWrap.style.width = 'min(720px, calc(100vw - 24px))';
    participantNextWrap.style.boxSizing = 'border-box';

    const participantNextHeader = document.createElement('div');
    participantNextHeader.style.display = 'flex';
    participantNextHeader.style.alignItems = 'center';
    participantNextHeader.style.justifyContent = 'space-between';
    participantNextHeader.style.gap = '8px';

    const participantNextTitle = document.createElement('div');
    participantNextTitle.id = 'mtg-participant-next-task-title';
    participantNextTitle.style.fontSize = '14px';
    participantNextTitle.style.fontWeight = '700';
    participantNextTitle.style.color = '#0f172a';
    participantNextTitle.style.marginBottom = '6px';
    participantNextTitle.textContent = 'Task complete';

    const participantNextClose = document.createElement('button');
    participantNextClose.id = 'mtg-participant-next-task-close';
    participantNextClose.type = 'button';
    participantNextClose.style.display = 'none';
    participantNextClose.style.border = '0';
    participantNextClose.style.background = 'transparent';
    participantNextClose.style.color = '#64748b';
    participantNextClose.style.cursor = 'pointer';
    participantNextClose.style.fontSize = '18px';
    participantNextClose.style.lineHeight = '1';
    participantNextClose.style.padding = '0 2px';
    participantNextClose.textContent = '×';
    participantNextClose.setAttribute('aria-label', 'Close');

    participantNextClose.addEventListener('click', () => {
      clearParticipantNextTaskState();
      syncParticipantEndButton();
    });

    const participantNextLabel = document.createElement('div');
    participantNextLabel.id = 'mtg-participant-next-task-label';
    participantNextLabel.style.fontSize = '13px';
    participantNextLabel.style.color = '#334155';
    participantNextLabel.style.lineHeight = '1.35';
    participantNextLabel.style.marginBottom = '8px';

    const participantNextButton = document.createElement('button');
    participantNextButton.id = 'mtg-participant-next-task-btn';
    participantNextButton.type = 'button';
    participantNextButton.style.padding = '10px 14px';
    participantNextButton.style.border = '1px solid #0f766e';
    participantNextButton.style.background = '#0f766e';
    participantNextButton.style.color = '#ffffff';
    participantNextButton.style.borderRadius = '999px';
    participantNextButton.style.fontSize = '14px';
    participantNextButton.style.fontWeight = '600';
    participantNextButton.style.cursor = 'pointer';
    participantNextButton.textContent = 'Proceed to next task';

    participantNextButton.addEventListener('click', () => {
      const nextState = getParticipantNextTaskState();
      const nextTaskId = String(nextState.next_task_id || '').trim();
      if (!nextTaskId) {
        return;
      }

      clearParticipantNextTaskState();
      disableResearchModeInUrl();
      startTask(nextTaskId, getTaskDisplayLabel(nextTaskId));
      syncParticipantEndButton();
    });

    participantNextHeader.appendChild(participantNextTitle);
    participantNextHeader.appendChild(participantNextClose);
    participantNextWrap.appendChild(participantNextHeader);
    participantNextWrap.appendChild(participantNextLabel);
    participantNextWrap.appendChild(participantNextButton);

    wrap.appendChild(shortFormWrap);
    wrap.appendChild(button);
    wrap.appendChild(participantNextWrap);

    document.body.appendChild(wrap);
    return wrap;
  };

  const syncParticipantEndButton = () => {
    const wrap = ensureParticipantEndButton();
    const taskState = getTaskState();
    const taskId = String(taskState.task_id || '').trim();
    const isShortFormTask = /^short_form_q[1-4]$/i.test(taskId);
    const endBtn = document.getElementById('mtg-participant-end-task-btn');
    const participantNextWrap = document.getElementById('mtg-participant-next-task-wrap');
    const participantNextTitle = document.getElementById('mtg-participant-next-task-title');
    const participantNextClose = document.getElementById('mtg-participant-next-task-close');
    const participantNextLabel = document.getElementById('mtg-participant-next-task-label');
    const participantNextButton = document.getElementById('mtg-participant-next-task-btn');
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
    const shortFormSubmit = document.getElementById('mtg-short-form-answer-submit');

    const participantNextState = getParticipantNextTaskState();
    const transitionReason = String(participantNextState.transition_reason || '').trim();
    const timedOut = transitionReason === 'time_cap_reached';
    const researchMode = isResearchMode();
    const hasPendingNextTask = !taskId && String(participantNextState.next_task_id || '').trim();
    const hasCompletedSequence = !taskId && String(participantNextState.status || '').trim() === 'completed';
    const showCompletedSequenceCard = hasCompletedSequence && researchMode;

    wrap.style.display = ((isShortFormTask && taskId) || hasPendingNextTask || showCompletedSequenceCard) ? 'block' : 'none';

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
      endBtn.style.display = isShortFormTask && taskId ? 'none' : (taskId ? 'inline-block' : 'none');
    }

    if (participantNextWrap) {
      participantNextWrap.style.display = !taskId && (hasPendingNextTask || showCompletedSequenceCard) ? 'block' : 'none';
    }

    if (participantNextClose) {
      participantNextClose.style.display = showCompletedSequenceCard ? 'inline-block' : 'none';
    }

    if (participantNextTitle) {
      participantNextTitle.textContent = timedOut ? 'Time limit reached' : 'Task complete';
    }

    if (participantNextLabel) {
      if (hasPendingNextTask) {
        participantNextLabel.textContent = timedOut ? 'Time limit reached for this task.' : '';
      } else if (showCompletedSequenceCard) {
        participantNextLabel.textContent = timedOut
          ? 'Time limit reached for the final task. All participant tasks are complete. Press Ctrl+Alt+R to open Research Controls.'
          : 'All participant tasks are complete. Press Ctrl+Alt+R to open Research Controls.';
      } else {
        participantNextLabel.textContent = '';
      }
    }

    if (participantNextButton) {
      participantNextButton.style.display = hasPendingNextTask ? 'inline-block' : 'none';
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
      if (shortFormSubmit) {
        shortFormSubmit.disabled = false;
        shortFormSubmit.style.opacity = '1';
        shortFormSubmit.style.cursor = 'pointer';
        shortFormSubmit.textContent = 'Submit answer';
      }
      updateTaskCardSafeArea();
      return;
    }

    const definition = getShortFormQuestionDefinition(taskId);
    const capMs = getTaskCapMs(taskId);
    const elapsedMs = getDisplayedElapsedMsForTaskState(taskState);
    const elapsedText = formatElapsedDuration(elapsedMs);
    const elapsedWithCapText = Number.isFinite(capMs)
      ? `${elapsedText} / ${formatElapsedDuration(capMs)}`
      : elapsedText;

    if (shortFormTaskHeader) {
      shortFormTaskHeader.innerHTML = `
        <strong style="font-size:13px; color:#0f172a;">Task in progress</strong>
        <span style="font-size:11px; color:#475569; background:#f1f5f9; border:1px solid #e2e8f0; border-radius:999px; padding:2px 8px;">${escapeHtml(taskId)}</span>
      `;
    }

    if (shortFormElapsed) {
      shortFormElapsed.textContent = `Elapsed: ${elapsedWithCapText}`;
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

    if (shortFormSubmit) {
      shortFormSubmit.disabled = false;
      shortFormSubmit.style.opacity = '1';
      shortFormSubmit.style.cursor = 'pointer';
      shortFormSubmit.textContent = 'Submit answer';
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
      const parts = definition && Array.isArray(definition.parts) ? definition.parts : [];
      if (shortFormPrompt) {
        shortFormPrompt.textContent = getShortFormSectionPrompt(parts);
      }

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

      const draft = getShortFormDraft(taskId) || {};
      const draftInputs = Array.from(shortFormFields.querySelectorAll('[data-short-form-part="1"]'));
      draftInputs.forEach((input) => {
        const key = String(input.getAttribute('data-part-key') || '').trim();
        if (!key) return;

        if (Object.prototype.hasOwnProperty.call(draft, key)) {
          input.value = String(draft[key] || '');
        }

        input.addEventListener('input', () => {
          const nextDraft = {};
          draftInputs.forEach((draftInput) => {
            const draftKey = String(draftInput.getAttribute('data-part-key') || '').trim();
            if (!draftKey) return;
            nextDraft[draftKey] = String(draftInput.value || '');
          });
          setShortFormDraft(taskId, nextDraft);
        });
      });

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

  const renderResearchPanel = (forceOpen = false, allowDuringActiveTask = false) => {
    removeTrialIntroOverlayCard();

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
    if (activeTask.task_id && !allowDuringActiveTask) {
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
        <button id="mtg-force-end-all" type="button" style="padding:7px 10px; border:1px solid #dc2626; border-radius:6px; background:#fef2f2; color:#991b1b; cursor:pointer;">Force end all active tasks</button>
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
    const forceEndAllBtn = document.getElementById('mtg-force-end-all');
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

      const capMs = getTaskCapMs(taskState.task_id);
      const durationMs = getDisplayedElapsedMsForTaskState(taskState);
      taskTimer.textContent = Number.isFinite(capMs)
        ? `Task timer: ${formatDuration(durationMs)} / ${formatDuration(capMs)}`
        : `Task timer: ${formatDuration(durationMs)}`;
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

    const isScenarioOneSelection = () => String(getSelectedTaskId() || '').trim() === 'scenario_card_1';

    const syncTaskStartButtonLabel = () => {
      if (!taskStart) return;
      taskStart.textContent = isScenarioOneSelection() ? 'Proceed to trial' : 'Start task';
    };

    const launchSelectedTaskFromPanel = () => {
      const participantId = String(participantInput ? participantInput.value : '').trim();
      const taskId = getSelectedTaskId();
      const taskLabel = getSelectedTaskLabel();

      if (!participantId || !taskId) {
        window.alert('Please set both Participant ID and Task ID before starting a task.');
        refreshState();
        return false;
      }

      setParticipantId(participantId);
      startTask(taskId, taskLabel);
      disableResearchModeInUrl();
      panel.remove();
      refreshState();
      return true;
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
      syncTaskStartButtonLabel();
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
      syncTaskStartButtonLabel();
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
      syncTaskStartButtonLabel();

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
        if (isScenarioOneSelection()) {
          const participantId = String(participantInput ? participantInput.value : '').trim();
          const taskId = getSelectedTaskId();
          const taskLabel = getSelectedTaskLabel();

          if (!participantId || !taskId) {
            window.alert('Please set both Participant ID and Task ID before continuing to the trial.');
            refreshState();
            return;
          }

          panel.remove();
          showTrialIntroOverlayCard({ participantId, taskId, taskLabel });
          return;
        }

        launchSelectedTaskFromPanel();
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

    if (forceEndAllBtn) {
      forceEndAllBtn.addEventListener('click', async () => {
        const confirmed = window.confirm('Force end all active tasks for all participants?');
        if (!confirmed) {
          return;
        }

        const originalLabel = forceEndAllBtn.textContent;
        forceEndAllBtn.disabled = true;
        forceEndAllBtn.textContent = 'Force ending…';

        try {
          const response = await fetch(getApiUrl().replace(/\/api\/telemetry$/, '/api/telemetry/force-end-all'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ source: 'research_controls' })
          });

          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            throw new Error(String((payload && payload.error) || 'Request failed'));
          }

          if (String(getTaskState().task_id || '').trim()) {
            setTaskState({});
            setTaskSubscribedInTab(false);
            clearParticipantNextTaskState();
            markTaskClearedInUrl();
            syncTaskPromptCard();
            syncParticipantEndButton();
          }

          const forcedCount = Number(payload && payload.forced_count);
          const participantsScanned = Number(payload && payload.participants_scanned);
          if (Number.isFinite(forcedCount) && Number.isFinite(participantsScanned)) {
            window.alert(`Force end complete. Ended ${forcedCount} active task(s) across ${participantsScanned} participant(s).`);
          } else {
            window.alert('Force end complete.');
          }

          refreshState();
        } catch (error) {
          window.alert(`Unable to force end tasks: ${error && error.message ? error.message : error}`);
        } finally {
          forceEndAllBtn.disabled = false;
          forceEndAllBtn.textContent = originalLabel;
        }
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

  const toggleResearchPanelHotkey = (event) => {
    const isRKey = String(event.key || '').toLowerCase() === 'r';
    const hasModifier = (event.ctrlKey || event.metaKey) && event.altKey;
    if (!isRKey || !hasModifier) {
      return;
    }

    event.preventDefault();

    const existingPanel = document.getElementById('mtg-research-panel');
    if (existingPanel) {
      existingPanel.remove();
      return;
    }

    renderResearchPanel(true, true);
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

      if (event.key === participantKey || event.key === lastTaskResultKey || event.key === participantNextTaskStateKey) {
        syncParticipantEndButton();
      }
    });

    window.addEventListener('focus', reconcileSharedTaskState);
    window.addEventListener('focus', () => {
      reconcileTaskStateFromServer('focus');
    });
    document.addEventListener('keydown', toggleResearchPanelHotkey);
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
      maybeApplyActiveTaskTimeCap();
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
