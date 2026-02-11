// Highlight functionality for search results
function initializeHighlight() {
  // Get highlight parameter from URL
  const urlParams = new URLSearchParams(window.location.search);
  const highlightTerm = urlParams.get('highlight');

  if (!highlightTerm || highlightTerm.trim().length === 0) {
    return;
  }

  // Highlight all instances of the search term
  highlightText(highlightTerm);

  // Remove highlights after 30 seconds
  setTimeout(() => {
    removeHighlights();
  }, 30000);

  // Scroll to first highlight
  const firstHighlight = document.querySelector('.search-highlight');
  if (firstHighlight) {
    setTimeout(() => {
      firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 100);
  }
}

/**
 * Highlight all instances of a term in the page content
 */
function highlightText(term) {
  const container = document.querySelector('.container') || document.body;
  const regex = new RegExp(`${escapeRegex(term)}`, 'gi');

  // Walk through all text nodes
  const walker = document.createTreeWalker(
    container,
    NodeFilter.SHOW_TEXT,
    null,
    false
  );

  const nodesToReplace = [];
  let node;

  while (node = walker.nextNode()) {
    if (regex.test(node.textContent)) {
      nodesToReplace.push(node);
    }
  }

  // Replace text nodes with highlighted spans
  nodesToReplace.forEach(node => {
    const span = document.createElement('span');
    const regex = new RegExp(`${escapeRegex(term)}`, 'gi');
    
    span.innerHTML = node.textContent.replace(
      regex,
      '<mark class="search-highlight">$&</mark>'
    );

    node.parentNode.replaceChild(span, node);
  });

  // Open collapsible cards containing highlights
  const highlights = document.querySelectorAll('.search-highlight');
  highlights.forEach(highlight => {
    // Find parent details element if it exists
    let parent = highlight.closest('details');
    if (parent && !parent.hasAttribute('open')) {
      parent.setAttribute('open', '');
    }
  });
}

/**
 * Remove all highlights from the page
 */
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

  // Remove the highlight parameter from URL
  const url = new URL(window.location);
  url.searchParams.delete('highlight');
  window.history.replaceState({}, document.title, url.toString());
}

/**
 * Escape special regex characters
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initializeHighlight);

// Also run immediately in case DOM is already loaded
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeHighlight);
} else {
  initializeHighlight();
}
