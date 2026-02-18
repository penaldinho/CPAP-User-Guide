#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const targetDirArg = process.argv[2];
const baseDir = targetDirArg
  ? path.resolve(__dirname, targetDirArg)
  : path.join(__dirname, 'CPAP-devices', 'Airsense-10-User-Guide');

const excludedHtmlFiles = new Set([
  'chat.html',
  'chat-setup.html',
  'search.html'
]);

const priorityOrder = [
  'index.html',
  'welcome.html',
  'setup.html',
  'operating-instructions.html',
  'fitting-your-mask.html',
  'mask-assembly.html',
  'cleaning-your-mask-at-home.html',
  'cleaning.html',
  'climate-control.html',
  'starting-therapy.html',
  'stopping-therapy.html',
  'troubleshooting.html',
  'technical-information.html',
  'technical-specifications.html',
  'further-information.html',
  'limited-warranty.html',
  'warranty-statement.html'
];

function getHtmlFilesToIndex(directory) {
  const allHtmlFiles = fs.readdirSync(directory)
    .filter((name) => name.toLowerCase().endsWith('.html'))
    .filter((name) => !excludedHtmlFiles.has(name.toLowerCase()));

  const priorityRank = new Map(priorityOrder.map((name, index) => [name, index]));

  return allHtmlFiles.sort((a, b) => {
    const aRank = priorityRank.has(a) ? priorityRank.get(a) : Number.MAX_SAFE_INTEGER;
    const bRank = priorityRank.has(b) ? priorityRank.get(b) : Number.MAX_SAFE_INTEGER;
    if (aRank !== bRank) return aRank - bRank;
    return a.localeCompare(b);
  });
}

/**
 * Extract text content from HTML
 * Removes scripts, styles, and HTML tags
 */
function extractTextFromHtml(html) {
  // Remove script and style elements
  let text = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '');
  text = text.replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '');
  
  // Remove HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  
  // Decode HTML entities
  text = text.replace(/&nbsp;/gi, ' ');
  text = text.replace(/&amp;/g, '&');
  text = text.replace(/&lt;/g, '<');
  text = text.replace(/&gt;/g, '>');
  text = text.replace(/&quot;/g, '"');
  text = text.replace(/&#39;/g, "'");
  
  // Clean up whitespace
  text = text.replace(/\s+/g, ' ').trim();
  
  return text;
}

/**
 * Extract title from HTML
 */
function extractTitle(html) {
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch && titleMatch[1]) {
    return titleMatch[1].split('—')[0].trim();
  }
  return '';
}

/**
 * Extract first heading (h1) as page title fallback
 */
function extractHeading(html) {
  const h1Match = html.match(/<h1[^>]*>([^<]+)<\/h1>/i);
  if (h1Match && h1Match[1]) {
    return h1Match[1].trim();
  }
  return '';
}

/**
 * Extract all headings from the page
 */
function extractHeadings(html) {
  const headings = [];
  const headingRegex = /<h[1-6][^>]*>([^<]+)<\/h[1-6]>/gi;
  let match;
  while ((match = headingRegex.exec(html)) !== null) {
    headings.push(match[1].trim());
  }
  return headings;
}

/**
 * Extract the first paragraph or description from content
 */
function extractDescription(html, text) {
  // Try to find a description in card with "muted small" class
  const cardMatch = html.match(/<div[^>]*class="[^"]*card[^"]*"[^>]*>\s*<p[^>]*class="[^"]*muted[^"]*"[^>]*>([^<]+)<\/p>/i);
  if (cardMatch && cardMatch[1]) {
    return cardMatch[1].trim();
  }
  
  // Fallback: first sentence from text
  const sentences = text.split(/[.!?]+/);
  if (sentences[0]) {
    return sentences[0].trim().substring(0, 150) + (sentences[0].length > 150 ? '...' : '');
  }
  
  return '';
}

/**
 * Generate keywords from text using frequency analysis
 */
function generateKeywords(text, existingKeywords = []) {
  // Common words to exclude
  const stopwords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
    'from', 'up', 'about', 'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they', 'what',
    'which', 'who', 'when', 'where', 'why', 'how', 'is', 'are', 'was', 'were', 'be', 'been',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should', 'can',
    'as', 'if', 'then', 'so', 'than', 'your', 'my', 'his', 'her', 'its', 'our', 'their'
  ]);
  
  // Extract words and count frequency
  const words = text.toLowerCase().match(/\b[a-z]+(?:-[a-z]+)*\b/g) || [];
  const frequency = {};
  
  words.forEach(word => {
    if (word.length > 3 && !stopwords.has(word)) {
      frequency[word] = (frequency[word] || 0) + 1;
    }
  });
  
  // Get top words by frequency
  const topWords = Object.entries(frequency)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 15)
    .map(([word]) => word);
  
  // Combine with existing keywords
  return [...new Set([...existingKeywords, ...topWords])];
}

/**
 * Process a single HTML file
 */
function processHtmlFile(filepath) {
  const filename = path.basename(filepath);
  const html = fs.readFileSync(filepath, 'utf8');
  const text = extractTextFromHtml(html);
  
  let title = extractTitle(html);
  if (!title) {
    title = extractHeading(html);
  }
  
  const headings = extractHeadings(html);
  const description = extractDescription(html, text);
  const keywords = generateKeywords(text);
  
  return {
    title: title || filename,
    file: filename,
    description: description || 'Information about ' + title.toLowerCase(),
    keywords: keywords,
    content: text.substring(0, 5000) // Store first 5000 chars of content
  };
}

/**
 * Main build function
 */
function buildSearchIndex() {
  console.log('Building search index...');
  const htmlFiles = getHtmlFilesToIndex(baseDir);

  const pages = [];
  
  htmlFiles.forEach(filename => {
    const filepath = path.join(baseDir, filename);
    
    if (fs.existsSync(filepath)) {
      try {
        console.log(`  Processing: ${filename}`);
        const pageData = processHtmlFile(filepath);
        pages.push(pageData);
      } catch (error) {
        console.error(`  Error processing ${filename}:`, error.message);
      }
    } else {
      console.warn(`  Skipping: ${filename} (not found)`);
    }
  });
  
  const searchIndex = { pages };
  
  // Write search index
  const outputPath = path.join(baseDir, 'search-index.json');
  fs.writeFileSync(outputPath, JSON.stringify(searchIndex, null, 2), 'utf8');
  
  console.log(`\nSearch index built successfully!`);
  console.log(`  Pages indexed: ${pages.length}`);
  console.log(`  Output: search-index.json`);
  
  return searchIndex;
}

// Run the build
buildSearchIndex();
