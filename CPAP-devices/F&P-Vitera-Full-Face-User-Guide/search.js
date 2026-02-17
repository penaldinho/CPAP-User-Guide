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
      results.push({
        ...page,
        relevanceScore,
        matchedKeywords: [...new Set(matchedKeywords)],
        matchedWords: [...new Set(matchedWords)]
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

  const results = searchPages(query);

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
      ${result.matchedKeywords.length > 0 ? `<p class="search-result-keywords"><strong>Keywords:</strong> ${result.matchedKeywords.join(', ')}</p>` : ''}
    </div>
  `).join('');

  resultsContainer.innerHTML = html;
}

function setupSearchForm() {
  const form = document.getElementById('search-form');
  const input = document.getElementById('search-input');

  if (form) {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const query = input.value;
      if (query.trim()) {
        displayResults(query);
      }
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
