let searchIndex = [];

async function loadSearchIndex() {
  try {
    const response = await fetch('search-index.json');
    const data = await response.json();
    searchIndex = data.pages;
  } catch (error) {
    console.error('Error loading search index:', error);
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

function escapeRegex(text) {
  return String(text || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

function emphasizeIndividualWords(text, queryWords) {
  const uniqueWords = getQueryWords(queryWords.join(' '));
  if (!text || uniqueWords.length === 0) return escapeHtml(text);

  const regex = new RegExp(`\\b(${uniqueWords.map(escapeRegex).join('|')})\\b`, 'gi');
  let result = '';
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIndex, match.index));
    result += `<strong class="search-result-match">${escapeHtml(match[0])}</strong>`;
    lastIndex = match.index + match[0].length;
  }

  result += escapeHtml(text.slice(lastIndex));
  return result;
}

function emphasizeSearchText(text, queryWords) {
  if (!text) return '';

  const bestRange = findBestHighlightRange(text, queryWords);
  if (bestRange && queryWords.length > 1) {
    return [
      escapeHtml(text.slice(0, bestRange.start)),
      `<strong class="search-result-match">${escapeHtml(text.slice(bestRange.start, bestRange.end))}</strong>`,
      escapeHtml(text.slice(bestRange.end))
    ].join('');
  }

  return emphasizeIndividualWords(text, queryWords);
}

function getSentenceScore(sentence, queryWords, queryLower) {
  const sentenceLower = sentence.toLowerCase();
  const matchedCount = queryWords.filter(word => sentenceLower.includes(word)).length;
  const bestRange = findBestHighlightRange(sentence, queryWords);
  const rangeLength = bestRange ? (bestRange.end - bestRange.start) : Number.MAX_SAFE_INTEGER;
  const exactPhraseBonus = sentenceLower.includes(queryLower) ? 1000 : 0;

  return {
    matchedCount,
    rangeLength,
    score: exactPhraseBonus + (matchedCount * 100) - Math.min(rangeLength, 1000)
  };
}

function trimSnippetAroundRange(text, range, maxLength = 220) {
  if (!text || text.length <= maxLength || !range) {
    return text;
  }

  const padding = 70;
  const snippetStart = Math.max(0, range.start - padding);
  const snippetEnd = Math.min(text.length, range.end + padding);
  const prefix = snippetStart > 0 ? '...' : '';
  const suffix = snippetEnd < text.length ? '...' : '';

  return `${prefix}${text.slice(snippetStart, snippetEnd).trim()}${suffix}`;
}

function getMatchSnippet(content, queryWords) {
  if (!content) return '';

  const queryLower = queryWords.join(' ');
  const sentences = content
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

  let bestSentence = '';
  let bestSentenceMeta = null;

  sentences.forEach(sentence => {
    const meta = getSentenceScore(sentence, queryWords, queryLower);
    if (meta.matchedCount === 0) {
      return;
    }

    if (!bestSentenceMeta || meta.score > bestSentenceMeta.score) {
      bestSentence = sentence;
      bestSentenceMeta = meta;
    }
  });

  if (!bestSentence) return '';

  const bestRange = findBestHighlightRange(bestSentence, queryWords);
  return trimSnippetAroundRange(bestSentence, bestRange);
}

function searchPages(query) {
  if (!query || query.trim().length < 1) {
    return [];
  }

  const queryLower = query.toLowerCase().trim();
  const queryWords = getQueryWords(query);
  const results = [];

  searchIndex.forEach((page) => {
    let relevanceScore = 0;
    const matchedKeywords = [];
    const matchedWords = [];

    const titleLower = page.title.toLowerCase();
    const descriptionLower = page.description.toLowerCase();
    const contentLower = page.content.toLowerCase();

    if (queryWords.length > 1) {
      if (findBestHighlightRange(page.title, queryWords)) {
        relevanceScore += 700;
      }

      if (findBestHighlightRange(page.description, queryWords)) {
        relevanceScore += 200;
      }

      if (findBestHighlightRange(page.content, queryWords)) {
        relevanceScore += 100;
      }
    }

    if (titleLower.includes(queryLower)) {
      relevanceScore += 1200;
    }

    queryWords.forEach((word) => {
      if (titleLower === word) {
        relevanceScore += 1000;
      } else if (titleLower.includes(word)) {
        relevanceScore += 500;
        matchedWords.push(word);
      }

      const exactKeywordMatch = page.keywords.find(keyword => keyword === word);
      if (exactKeywordMatch) {
        relevanceScore += 300;
        if (!matchedKeywords.includes(exactKeywordMatch)) {
          matchedKeywords.push(exactKeywordMatch);
        }
      } else {
        page.keywords.forEach((keyword) => {
          if (keyword.includes(word) && !matchedKeywords.includes(keyword)) {
            relevanceScore += 100;
            matchedKeywords.push(keyword);
          }
        });
      }

      if (descriptionLower.includes(word)) {
        relevanceScore += 50;
        if (!matchedWords.includes(word)) {
          matchedWords.push(word);
        }
      }

      const contentMatches = (contentLower.match(new RegExp(`\\b${escapeRegex(word)}\\b`, 'g')) || []).length;
      if (contentMatches > 0) {
        relevanceScore += contentMatches * 15;
        if (!matchedWords.includes(word)) {
          matchedWords.push(word);
        }
      }
    });

    if (relevanceScore > 0) {
      const matchSnippet = getMatchSnippet(page.content, queryWords) || page.description;
      results.push({
        ...page,
        relevanceScore,
        matchedKeywords: [...new Set(matchedKeywords)],
        matchedWords: [...new Set(matchedWords)],
        matchSnippet
      });
    }
  });

  results.sort((a, b) => b.relevanceScore - a.relevanceScore);
  return results;
}

function displayResults(query) {
  const resultsContainer = document.getElementById('search-results');
  const resultsCount = document.getElementById('results-count');
  const searchQueryDisplay = document.getElementById('search-query');

  if (!resultsContainer) return;

  const queryWords = getQueryWords(query);
  const results = searchPages(query);

  if (window.MTGTelemetry && query && query.trim()) {
    window.MTGTelemetry.track('search_submit', {
      query: query.trim(),
      result_count: results.length
    });
  }

  if (results.length === 0) {
    resultsContainer.innerHTML = '<p class="muted">No results found for your search.</p>';
    resultsCount.textContent = '0 results';
    searchQueryDisplay.textContent = `"${query}"`;
    return;
  }

  searchQueryDisplay.textContent = `"${query}"`;
  resultsCount.textContent = `${results.length} result${results.length !== 1 ? 's' : ''}`;

  const html = results.map(result => `
    <div class="search-result card">
      <a href="${result.file}?highlight=${encodeURIComponent(query)}" class="search-result-title">${escapeHtml(result.title)}</a>
      ${result.matchSnippet ? `<p class="search-result-snippet">${emphasizeSearchText(result.matchSnippet, queryWords)}</p>` : ''}
    </div>
  `).join('');

  resultsContainer.innerHTML = html;
}

function setupSearchForm() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');
  const resultsContainer = document.getElementById('search-results');

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = input.value;
      if (query.trim()) {
        displayResults(query);
      }
    });
  }

  if (resultsContainer) {
    resultsContainer.addEventListener('click', (event) => {
      const link = event.target.closest('a.search-result-title');
      if (!link || !window.MTGTelemetry) return;

      window.MTGTelemetry.track('search_result_click', {
        query: (input && input.value ? input.value : '').trim(),
        target_href: link.getAttribute('href') || ''
      });
    });
  }

  const urlParams = new URLSearchParams(window.location.search);
  const searchQuery = urlParams.get('q');
  if (searchQuery && input) {
    input.value = searchQuery;
    displayResults(searchQuery);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  loadSearchIndex().then(() => {
    setupSearchForm();
  });
});
