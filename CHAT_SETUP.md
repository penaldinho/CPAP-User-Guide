# Chat Assistant Setup Guide

The chatbot uses AI to answer questions based on your AirSense 10 user manual. It understands context and dependencies (like knowing setup must come before starting therapy).

## Prerequisites

1. **Node.js** - Already installed (you have this!)
2. **An LLM API Key** - Choose one option below
3. **Express.js** - Will be installed via npm

## Step 1: Install Dependencies

Run this in PowerShell in your project folder:

```powershell
npm install
```

This installs Express.js (required for the chat server).

## Step 2: Get an API Key

Choose one provider (both work great):

### Option A: Hugging Face (Free, Recommended)
1. Go to https://huggingface.co/settings/tokens
2. Create a new token (read access is fine)
3. Copy your token

### Option B: OpenAI
1. Go to https://platform.openai.com/account/api-keys
2. Create a new API key
3. Copy your key

## Step 3: Start the Chat Server

### For Hugging Face:
```powershell
$env:LLM_API_KEY = "your_huggingface_token_here"
npm run chat
```

### For OpenAI:
```powershell
$env:LLM_PROVIDER = "openai"
$env:LLM_API_KEY = "your_openai_key_here"
npm run chat
```

Replace `your_huggingface_token_here` or `your_openai_key_here` with your actual key.

## Step 4: Use the Chatbot

1. Open your browser
2. Go to: `http://localhost:3000/chat.html`
3. Ask questions like:
   - "How do I start therapy?"
   - "How should I clean the humidifier?"
   - "What should I do if the device won't turn on?"
   - "What's the warranty coverage?"

## Stopping the Server

Press `Ctrl+C` in PowerShell to stop the server.

## Troubleshooting

**"Cannot find module 'express'"**
- Run `npm install` first

**"API Key not found"**
- Make sure you set the `LLM_API_KEY` environment variable before running the server

**"EADDRINUSE: address already in use"**
- Another process is using port 3000
- Try: `$env:PORT = 3001; npm run chat`

**Slow responses**
- LLM API responses can take 5-15 seconds depending on the provider
- This is normal! The AI is reading your manual and thinking

## How It Works

1. User asks a question on `chat.html`
2. The question is sent to your chat server (`chat-server.js`)
3. Server combines the question with your manual content
4. Sends everything to the LLM API
5. LLM thinks about your manual and generates a response
6. Response is displayed in the chat

## Cost

- **Hugging Face**: Completely free (includes free inference API)
- **OpenAI**: Uses your API credits ($0.0015 per message approximately)

## Security Notes

- Your API key is only sent from your server to the LLM provider
- Users never see your API key
- All communication is encrypted (HTTPS)

## Tips for Better Answers

- Ask specific questions: "How do I clean the mask?" is better than "How to clean?"
- Mention the device: "AirSense 10" helps with context
- Ask about procedures: "What are the setup steps?" works better than just "setup"

Enjoy your AI assistant! 🤖
