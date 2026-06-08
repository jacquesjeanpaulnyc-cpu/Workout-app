# JJP Agent — Personal AI Chief of Staff

A Telegram bot powered by Claude that acts as your personal AI assistant. Send it messages and it routes them through Claude with full tool access.

## Quick Start

### 1. Create Telegram Bot
1. Open Telegram, message **@BotFather**
2. Send `/newbot`
3. Name: `JJP Intel`
4. Username: `jjpintel_bot` (or closest available)
5. Copy the bot token

### 2. Configure Environment
```bash
cp .env.example .env
# Edit .env and paste your keys:
#   ANTHROPIC_API_KEY=sk-ant-...
#   TELEGRAM_BOT_TOKEN=123456:ABC...
```

### 3. Install & Run
```bash
npm install
npm start
```

### 4. Get Your Chat ID
1. Open Telegram, find your bot (`@jjpintel_bot`)
2. Send `/start`
3. Bot replies with your chat ID
4. Add it to `.env` as `TELEGRAM_OWNER_ID`
5. Restart: `npm start`

## Architecture

```
You (Telegram) → Bot (polling) → Claude Brain → Tool Execution → Response → You
```

### Tools
| Tool | What it does |
|------|-------------|
| `web_search` | DuckDuckGo search, summarized by Claude |
| `square_revenue` | Pull today's salon revenue from Square API |
| `send_reminder` | Schedule a reminder at a specific time |
| `draft_email` | Create a Gmail draft |

### Scheduled Briefings
| Time | Briefing |
|------|----------|
| 5:30 AM ET daily | Morning brief — priorities, deadlines, countdown |
| 8:00 PM ET daily | Evening wind-down — reflection, tomorrow's focus |
| 7:00 AM ET Sunday | Weekly intel — review, strategy, status checks |

## Optional: Square API Setup
1. Go to [Square Developer Dashboard](https://developer.squareup.com/)
2. Create an application
3. Get your production access token
4. Find your location ID under Locations
5. Add both to `.env`

## Optional: Gmail OAuth Setup
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project → Enable Gmail API
3. Create OAuth 2.0 credentials (Desktop app)
4. Get client ID and secret
5. Use the OAuth playground or a script to get a refresh token
6. Add all three to `.env`

## Run as Background Service (macOS)

```bash
# Edit the plist — update WorkingDirectory and node path
nano com.jjp.agent.plist

# Copy to LaunchAgents
cp com.jjp.agent.plist ~/Library/LaunchAgents/

# Load the service
launchctl load ~/Library/LaunchAgents/com.jjp.agent.plist

# Check status
launchctl list | grep jjp

# View logs
tail -f /tmp/jjp-agent.out.log
tail -f /tmp/jjp-agent.err.log

# Stop service
launchctl unload ~/Library/LaunchAgents/com.jjp.agent.plist
```

## File Structure
```
jjp-agent/
├── .env                    # Your credentials (git-ignored)
├── .env.example            # Template
├── .gitignore
├── package.json
├── com.jjp.agent.plist     # macOS background service
├── README.md
└── src/
    ├── index.js            # Entry point
    ├── bot.js              # Telegram bot (polling)
    ├── brain.js            # Claude API + tool routing
    ├── briefings.js        # Scheduled daily briefings
    └── tools/
        ├── web-search.js   # DuckDuckGo search
        ├── square-revenue.js # Square API integration
        ├── send-reminder.js  # Cron-based reminders
        └── draft-email.js    # Gmail draft creation
```
