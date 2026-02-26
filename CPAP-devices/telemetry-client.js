(function () {
  if (window.MTGTelemetry) return;

  const sessionKey = 'mtg-telemetry-session-id';
  const participantKey = 'mtg-telemetry-participant-id';
  const taskStateKey = 'mtg-telemetry-task-state';
  const lastTaskResultKey = 'mtg-telemetry-last-task-result';

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

  const getTaskState = () => safeJsonParse(sessionStorage.getItem(taskStateKey) || '{}', {});

  const setTaskState = (state) => {
    sessionStorage.setItem(taskStateKey, JSON.stringify(state || {}));
  };

  const getLastTaskResult = () => safeJsonParse(sessionStorage.getItem(lastTaskResultKey) || '{}', {});

  const setLastTaskResult = (result) => {
    sessionStorage.setItem(lastTaskResultKey, JSON.stringify(result || {}));
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
      setTaskState({});
      return;
    }

    const taskId = String(url.searchParams.get('mtg_task_id') || '').trim();
    if (!taskId) {
      if (isHostedChatHost(url.hostname)) {
        setTaskState({});
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

  const startTask = (taskId, label) => {
    if (!taskId) return;
    const nextState = {
      task_id: String(taskId),
      task_label: String(label || ''),
      started_at: new Date().toISOString()
    };
    setTaskState(nextState);
    markTaskActiveInUrl(nextState);
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
    markTaskClearedInUrl();
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

    button.addEventListener('click', () => {
      track('task_end_clicked_by_participant', {
        task_id: getTaskState().task_id || ''
      });
      endTask('participant_clicked_end');
      syncParticipantEndButton();
      enableResearchModeInUrl();
      renderResearchPanel();
    });

    wrap.appendChild(button);
    document.body.appendChild(wrap);
    return wrap;
  };

  const syncParticipantEndButton = () => {
    const wrap = ensureParticipantEndButton();
    const taskState = getTaskState();
    wrap.style.display = taskState.task_id ? 'block' : 'none';
  };

  const renderResearchPanel = (forceOpen = false) => {
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
    panel.style.width = '320px';
    panel.style.maxWidth = 'calc(100vw - 24px)';
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
          <input id="mtg-participant-input" type="text" placeholder="e.g. P01" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;" />
        </label>
        <button id="mtg-participant-save" type="button" style="padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; background:#f8fafc; cursor:pointer;">Save participant</button>
        <hr style="border:0; border-top:1px solid #e5e7eb; margin:2px 0;" />
        <label style="display:grid; gap:4px;">
          <span>Task ID</span>
          <input id="mtg-task-id-input" type="text" placeholder="e.g. T1" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;" />
        </label>
        <label style="display:grid; gap:4px;">
          <span>Task label</span>
          <input id="mtg-task-label-input" type="text" placeholder="e.g. First-time setup" style="padding:6px 8px; border:1px solid #cbd5e1; border-radius:6px;" />
        </label>
        <div style="display:flex; gap:8px;">
          <button id="mtg-task-start" type="button" style="flex:1; padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; background:#ecfdf3; cursor:pointer;">Start task</button>
          <button id="mtg-task-end" type="button" style="flex:1; padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; background:#eff6ff; cursor:pointer;">End task</button>
        </div>
        <div id="mtg-task-timer" style="padding:7px 10px; border:1px solid #e5e7eb; border-radius:6px; background:#f8fafc; font-weight:600;">Task timer: 00:00</div>
        <button id="mtg-export-csv" type="button" style="padding:7px 10px; border:1px solid #cbd5e1; border-radius:6px; background:#fff7ed; cursor:pointer;">Export CSV</button>
        <div id="mtg-research-state" style="font-size:12px; color:#4b5563;"></div>
      </div>
    `;

    document.body.appendChild(panel);

    const participantInput = document.getElementById('mtg-participant-input');
    const participantSave = document.getElementById('mtg-participant-save');
    const taskIdInput = document.getElementById('mtg-task-id-input');
    const taskLabelInput = document.getElementById('mtg-task-label-input');
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

    const refreshState = () => {
      const participantId = getParticipantId();
      const taskState = getTaskState();
      if (participantInput) {
        participantInput.value = participantId;
      }
      if (taskIdInput && taskState.task_id) {
        taskIdInput.value = taskState.task_id;
      }
      if (taskLabelInput && taskState.task_label) {
        taskLabelInput.value = taskState.task_label;
      }

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
        const taskId = taskIdInput ? taskIdInput.value : '';
        const taskLabel = taskLabelInput ? taskLabelInput.value : '';
        startTask(taskId, taskLabel);
        disableResearchModeInUrl();
        panel.remove();
        refreshState();
      });
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
    refreshState();
  };

  const init = () => {
    hydrateParticipantFromUrl();
    hydrateLastTaskResultFromUrl();
    hydrateTaskStateFromUrl();
    getOrCreateSessionId();
    track('page_view', {
      referrer: document.referrer || ''
    });

    syncParticipantEndButton();

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

    const pageEnteredAt = Date.now();
    window.addEventListener('pagehide', () => {
      track('page_exit', {
        duration_ms: Math.max(0, Date.now() - pageEnteredAt)
      });
    });

    window.addEventListener('storage', (event) => {
      if (event.key === taskStateKey) {
        syncParticipantEndButton();
      }
    });

    window.setInterval(syncParticipantEndButton, 1000);
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
