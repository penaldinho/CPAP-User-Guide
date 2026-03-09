function initializeHighlight() {
  const urlParams = new URLSearchParams(window.location.search);
  const highlightTerm = urlParams.get('highlight');

  if (!highlightTerm || highlightTerm.trim().length === 0) {
    return;
  }

  highlightText(highlightTerm);

  setTimeout(() => {
    removeHighlights();
  }, 30000);

  const firstHighlight = document.querySelector('.search-highlight');
  if (firstHighlight) {
    setTimeout(() => {
      firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }
}

function getQueryWords(query) {
  return [...new Set(String(query || '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0))];
}

function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeRegex(str) {
  return String(str || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getWordTokens(text) {
  const tokens = [];
  const wordRegex = /[A-Za-z0-9]+/g;
  let match;

  while ((match = wordRegex.exec(text)) !== null) {
    tokens.push({
      word: match[0].toLowerCase(),
      start: match.index,
      end: match.index + match[0].length
    });
  }

  return tokens;
}

function findBestHighlightRange(text, queryWords) {
  const uniqueWords = getQueryWords(queryWords.join(' '));
  if (!text || uniqueWords.length === 0) return null;

  const needed = new Set(uniqueWords);
  const tokens = getWordTokens(text);
  const counts = new Map();
  let coveredWordCount = 0;
  let left = 0;
  let bestRange = null;

  for (let right = 0; right < tokens.length; right += 1) {
    const rightWord = tokens[right].word;
    if (needed.has(rightWord)) {
      const currentCount = counts.get(rightWord) || 0;
      counts.set(rightWord, currentCount + 1);
      if (currentCount === 0) {
        coveredWordCount += 1;
      }
    }

    while (coveredWordCount === needed.size && left <= right) {
      const candidateRange = {
        start: tokens[left].start,
        end: tokens[right].end
      };

      if (!bestRange || (candidateRange.end - candidateRange.start) < (bestRange.end - bestRange.start)) {
        bestRange = candidateRange;
      }

      const leftWord = tokens[left].word;
      if (needed.has(leftWord)) {
        const currentCount = counts.get(leftWord) || 0;
        if (currentCount <= 1) {
          counts.delete(leftWord);
          coveredWordCount -= 1;
        } else {
          counts.set(leftWord, currentCount - 1);
        }
      }
      left += 1;
    }
  }

  return bestRange;
}

function highlightIndividualWords(text, queryWords) {
  const uniqueWords = getQueryWords(queryWords.join(' '));
  if (!text || uniqueWords.length === 0) return escapeHtml(text);

  const regex = new RegExp(`\\b(${uniqueWords.map(escapeRegex).join('|')})\\b`, 'gi');
  let html = '';
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    html += escapeHtml(text.slice(lastIndex, match.index));
    html += `<mark class="search-highlight">${escapeHtml(match[0])}</mark>`;
    lastIndex = match.index + match[0].length;
  }

  html += escapeHtml(text.slice(lastIndex));
  return html;
}

function buildHighlightHtml(text, queryWords) {
  if (!text) return '';

  const bestRange = findBestHighlightRange(text, queryWords);
  if (bestRange && queryWords.length > 1) {
    return [
      escapeHtml(text.slice(0, bestRange.start)),
      `<mark class="search-highlight">${escapeHtml(text.slice(bestRange.start, bestRange.end))}</mark>`,
      escapeHtml(text.slice(bestRange.end))
    ].join('');
  }

  return highlightIndividualWords(text, queryWords);
}

function highlightText(term) {
  const container = document.querySelector('.container') || document.body;
  const queryWords = getQueryWords(term);

  if (queryWords.length === 0) {
    return;
  }

  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    {
      acceptNode(node) {
        if (!node.textContent || !node.textContent.trim()) {
          return NodeFilter.FILTER_REJECT;
        }

        const parentTagName = node.parentElement ? node.parentElement.tagName : '';
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'MARK'].includes(parentTagName)) {
          return NodeFilter.FILTER_REJECT;
        }

        const bestRange = findBestHighlightRange(node.textContent, queryWords);
        if (bestRange) {
          return NodeFilter.FILTER_ACCEPT;
        }

        const fallbackRegex = new RegExp(`\\b(${queryWords.map(escapeRegex).join('|')})\\b`, 'i');
        return fallbackRegex.test(node.textContent)
          ? NodeFilter.FILTER_ACCEPT
          : NodeFilter.FILTER_REJECT;
      }
    }
  );

  const nodesToReplace = [];
  let node;

  while ((node = walker.nextNode())) {
    nodesToReplace.push(node);
  }

  nodesToReplace.forEach(textNode => {
    const wrapper = document.createElement('span');
    wrapper.innerHTML = buildHighlightHtml(textNode.textContent, queryWords);
    textNode.parentNode.replaceChild(wrapper, textNode);
  });

  const highlights = document.querySelectorAll('.search-highlight');
  highlights.forEach(highlight => {
    const parent = highlight.closest('details');
    if (parent && !parent.hasAttribute('open')) {
      parent.setAttribute('open', '');
    }
  });
}

function removeHighlights() {
  const highlights = document.querySelectorAll('.search-highlight');
  highlights.forEach(highlight => {
    const parent = highlight.parentNode;
    while (highlight.firstChild) {
      parent.insertBefore(highlight.firstChild, highlight);
    }
    parent.removeChild(highlight);
    parent.normalize();
  });

  const url = new URL(window.location);
  url.searchParams.delete('highlight');
  window.history.replaceState({}, document.title, url.toString());
}

document.addEventListener('DOMContentLoaded', initializeHighlight);

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeHighlight);
} else {
  initializeHighlight();
}
