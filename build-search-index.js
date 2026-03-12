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

  // Preserve alt text for small inline icons used inside instructional text,
  // while ignoring larger standalone/manual images.
  text = text.replace(/<img\b[^>]*>/gi, (tag) => {
    if (!looksInlineIconTag(tag)) {
      return ' ';
    }

    const alt = extractAttribute(tag, 'alt');
    return alt ? ` ${alt} ` : ' ';
  });
  
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

function decodeHtmlEntities(text) {
  const namedEntities = {
    nbsp: ' ',
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    '#39': "'"
  };

  return String(text || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&([a-z0-9#]+);/gi, (match, name) => {
      const key = String(name || '').toLowerCase();
      return Object.prototype.hasOwnProperty.call(namedEntities, key)
        ? namedEntities[key]
        : match;
    });
}

function extractAttribute(tag, attributeName) {
  const escapedName = String(attributeName || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = String(tag || '').match(new RegExp(`${escapedName}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? decodeHtmlEntities(match[2]).trim() : '';
}

function getNumericStyleValue(tag, propertyName) {
  const style = extractAttribute(tag, 'style').toLowerCase();
  const escapedName = String(propertyName || '').replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const match = style.match(new RegExp(`${escapedName}\\s*:\\s*(\d+(?:\.\d+)?)px`, 'i'));
  return match ? Number(match[1]) : 0;
}

function getNumericAttributeValue(tag, attributeName) {
  const value = extractAttribute(tag, attributeName);
  const match = value.match(/(\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function looksInlineIconTag(tag) {
  const style = extractAttribute(tag, 'style').toLowerCase();
  const width = getNumericAttributeValue(tag, 'width') || getNumericStyleValue(tag, 'width');
  const height = getNumericAttributeValue(tag, 'height') || getNumericStyleValue(tag, 'height');
  const explicitlySmall = width > 0 && height > 0 && width <= 120 && height <= 120;
  const alt = extractAttribute(tag, 'alt');

  return /vertical-align|display\s*:\s*inline|height\s*:\s*1(?:\.\d+)?em/.test(style)
    || explicitlySmall
    || (alt.length <= 2 && !extractAttribute(tag, 'class').includes('manual-image'));
}

function extractHtmlBlocks(html, tagName) {
  const regex = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\/${tagName}>`, 'gi');
  const blocks = [];
  let match;

  while ((match = regex.exec(html)) !== null) {
    blocks.push(match[1]);
  }

  return blocks;
}

function extractImageMetadata(html, filename, title) {
  const headingRegex = /<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  const headings = [];
  let headingMatch;

  while ((headingMatch = headingRegex.exec(html)) !== null) {
    headings.push({
      index: headingMatch.index,
      level: Number(headingMatch[1]),
      text: extractTextFromHtml(headingMatch[2])
    });
  }

  const imageRegex = /<img\b[^>]*>/gi;
  const images = [];
  let imageMatch;

  while ((imageMatch = imageRegex.exec(html)) !== null) {
    const tag = imageMatch[0];
    if (looksInlineIconTag(tag)) {
      continue;
    }

    const src = extractAttribute(tag, 'src');
    const alt = extractAttribute(tag, 'alt');
    if (!src || !alt) {
      continue;
    }

    let headingIndex = -1;
    for (let i = 0; i < headings.length; i += 1) {
      if (headings[i].index <= imageMatch.index) {
        headingIndex = i;
      } else {
        break;
      }
    }

    const currentHeading = headingIndex >= 0 ? headings[headingIndex] : null;
    const nextHeading = headingIndex >= 0 ? headings[headingIndex + 1] : headings[0];
    const contextWindowStart = Math.max(0, imageMatch.index - 600);
    const contextWindowEnd = Math.min(html.length, imageMatch.index + 2800);
    const sectionHtml = html.slice(contextWindowStart, contextWindowEnd);

    const listItems = extractHtmlBlocks(sectionHtml, 'li')
      .map((item) => extractTextFromHtml(item))
      .filter(Boolean)
      .slice(0, 8);

    const paragraphs = extractHtmlBlocks(sectionHtml, 'p')
      .map((item) => extractTextFromHtml(item))
      .filter(Boolean)
      .slice(0, 4);

    const tableCells = [
      ...extractHtmlBlocks(sectionHtml, 'th'),
      ...extractHtmlBlocks(sectionHtml, 'td')
    ]
      .map((item) => extractTextFromHtml(item))
      .filter(Boolean)
      .slice(0, 12);

    const sectionText = [
      currentHeading ? currentHeading.text : '',
      nextHeading && nextHeading.index < imageMatch.index + 1000 ? nextHeading.text : '',
      ...listItems,
      ...paragraphs,
      ...tableCells
    ]
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();

    images.push({
      src,
      alt,
      pageTitle: title || filename,
      pageFile: filename,
      heading: currentHeading ? currentHeading.text : title || filename,
      context: sectionText.substring(0, 1200)
    });
  }

  return images;
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
  const images = extractImageMetadata(html, filename, title || filename);
  
  return {
    title: title || filename,
    file: filename,
    description: description || 'Information about ' + title.toLowerCase(),
    keywords: keywords,
    content: text.substring(0, 5000), // Store first 5000 chars of content
    headings,
    images
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
