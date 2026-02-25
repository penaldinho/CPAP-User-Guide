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

function searchPages(query) {
  if (!query || query.trim().length < 1) {
    return [];
  }

  const queryLower = query.toLowerCase().trim();
  const queryWords = queryLower.split(/\s+/).filter(word => word.length > 0);
  const results = [];

  searchIndex.forEach((page) => {
    let relevanceScore = 0;
    const matchedKeywords = [];
    const matchedWords = [];

    const titleLower = page.title.toLowerCase();
    const descriptionLower = page.description.toLowerCase();
    const contentLower = page.content.toLowerCase();

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

      const contentMatches = (contentLower.match(new RegExp(`\\b${word}\\b`, 'g')) || []).length;
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

function getMatchSnippet(content, queryWords) {
  if (!content) return '';

  const normalizedWords = queryWords.map(word => word.toLowerCase());
  const sentences = content
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map(sentence => sentence.trim())
    .filter(Boolean);

  const matchedSentence = sentences.find(sentence => {
    const sentenceLower = sentence.toLowerCase();
    return normalizedWords.some(word => sentenceLower.includes(word));
  });

  if (!matchedSentence) return '';
  if (matchedSentence.length <= 220) return matchedSentence;
  return `${matchedSentence.slice(0, 217).trim()}...`;
}

function displayResults(query) {
  const resultsContainer = document.getElementById('search-results');
  const resultsCount = document.getElementById('results-count');
  const searchQueryDisplay = document.getElementById('search-query');

  if (!resultsContainer) return;

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
      <a href="${result.file}?highlight=${encodeURIComponent(query)}" class="search-result-title">${result.title}</a>
      <p class="search-result-description">${result.description}</p>
      ${result.matchSnippet ? `<p class="search-result-keywords"><strong>Matched text:</strong> ${result.matchSnippet}</p>` : ''}
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
