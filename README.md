# AirSense 10 User Guide

Interactive training materials and user guide for the AirSense 10 CPAP device.

## Features

- Complete device documentation
- Search functionality across all pages
- Responsive design
- Comprehensive technical specifications
- Troubleshooting guides
- Device care and maintenance instructions

## Building the Search Index

The search index is automatically generated from your HTML files using a build script. This ensures the search stays in sync with your content.

### Prerequisites

You need Node.js installed on your computer. Download it from [nodejs.org](https://nodejs.org/) (the LTS version is recommended).

### How to Build

1. Open PowerShell or Command Prompt
2. Navigate to your project folder:
   ```
   cd "c:\Users\edfre\OneDrive - NHS\Freddie OneDrive\NHSE MedTech in the Community\MSc Project\cpap-training-materials"
   ```

3. Run the build script:
   ```
   node build-search-index.js
   ```

This will automatically:
- Extract text content from all HTML files
- Generate meaningful keywords from page content
- Create descriptions for each page
- Update `search-index.json`

### When to Rebuild

You should rebuild the search index whenever you:
- Add a new page
- Significantly update page content
- Change page titles

Just run `node build-search-index.js` again and your search index will be updated automatically.

## Project Structure

```
cpap-training-materials/
├── welcome.html              # Entry point
├── index.html                # Table of contents
├── about-device.html         # Device overview
├── setup.html                # Setup instructions
├── starting-therapy.html     # Starting guide
├── stopping-therapy.html     # Stopping guide
├── power-save-mode.html      # Power save features
├── my-options.html           # Settings and options
├── caring-for-your-device.html
├── therapy-data.html
├── travelling.html
├── troubleshooting.html
├── reassembling-parts.html
├── technical-specifications.html
├── symbols.html
├── environmental-information.html
├── servicing.html
├── limited-warranty.html
├── further-information.html
├── search.html               # Search results page
├── style.css                 # Stylesheet
├── nav.js                    # Navigation system
├── search.js                 # Search functionality
├── search-index.json         # Auto-generated search index
├── build-search-index.js     # Build script
├── package.json              # Project metadata
└── images/                   # Image assets
```

## How the Search Works

1. **Content Extraction**: The build script reads all HTML files and extracts plain text
2. **Keyword Generation**: Important words are identified automatically from page content
3. **Intelligent Search**: When users search, the algorithm:
   - Breaks queries into individual words
   - Finds pages containing those words
   - Ranks results by relevance (exact matches first)
   - Shows related keywords for context

## Updating Content

1. Edit any `.html` file as usual
2. Save your changes
3. Run `node build-search-index.js` to update the search index
4. The site will immediately reflect the changes (refresh your browser)

## Technical Details

- **Static Site**: No server required, runs entirely in the browser
- **Client-side Search**: All searching happens on the user's computer
- **No External Dependencies**: The search function uses only vanilla JavaScript
- **Responsive Design**: Works on desktop, tablet, and mobile
