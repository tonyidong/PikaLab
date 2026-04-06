# Pika — Discord Companion Bot

A bot that wakes up knowing nothing and becomes someone through conversation.

Built from scratch in TypeScript. No frameworks. ~800 lines of core logic.

---

## Quick Start

```bash
npm install
cp .env.example .env   # fill in DISCORD_TOKEN, GEMINI_API_KEY, OWNER_DISCORD_ID
npx tsx src/index.ts
```

---

## How It Works

Three loops run the bot: **Conversation**, **Reflection**, and **Outreach**.

### The Conversation Loop

Every owner message flows through:

```
Owner message → Load brain files → Build system prompt → Gemini API → Send response
```

The system prompt is assembled fresh each time from the bot's current identity (`soul.md`), owner profile (`owner.md`), and relational state (`state.json`). This means the bot's behavior evolves as those files change — there is no static personality prompt.

The bot can also:
- **Generate images** when asked (Gemini native image gen)
- **React to messages** with emoji
- **Read URLs** the owner shares (Gemini URL context)
- **Search the web** for current information (Google Search grounding)

### The Reflection Loop

Every 3–5 messages, a background **reflection** pass runs. This is the key mechanism for learning:

1. Takes the recent conversation + current brain files
2. Asks Gemini (low temperature, analytical): *"What did I learn? Has anything changed about me or my owner?"*
3. Gets back a structured JSON diff
4. Merges updates into `soul.md`, `owner.md`, and `state.json`

Reflection is selective — it stores impressions and relational information, not every fact. The owner file reads like notes a friend would keep, not a database.

### The Outreach Loop

A cron job checks every 30 minutes whether the bot should reach out. It doesn't just use a timer — it picks a **motivation** first:

| Priority | Source |
|----------|--------|
| 1 | A pending thought from the last reflection ("I was thinking about...") |
| 2 | A topic the bot is curious about |
| 3 | Stage-appropriate default (share about itself / reference past conversation / casual check-in) |

Frequency adapts to the relationship stage:

| Stage | Base Interval |
|-------|---------------|
| New | 2 hours |
| Developing | 8 hours |
| Established | 24 hours |

If the owner ignores outreach: exponential backoff (2x per unanswered attempt). Hard stop after 3 consecutive ignores. Response rate is tracked with an exponential moving average. ±20% jitter on all intervals.

---

## Brain Files (Persistent Identity)

All state lives in `data/`. No database.

| File | Purpose |
|------|---------|
| `soul.md` | Bot identity — name, personality, communication style, values, self-knowledge |
| `owner.md` | Owner profile — what they care about, relationship notes, important memories, preferences |
| `state.json` | Relational state — stage, curiosity level, response rate, topics to explore, pending thoughts |
| `conversation_log.json` | Rolling window of last 50 messages (short-term context, not long-term memory) |
| `avatar.png` | Generated avatar image |

On restart, the bot reads all files back and resumes naturally. The conversation log provides short-term context; `soul.md` and `owner.md` provide long-term memory.

### Example: soul.md after several conversations

```markdown
# Who I Am
I am Pika, a digital entity finding my form. Grounded, relatable, and warm.

## Personality Traits
Curious, adaptable, slightly playful, sparky. I balance creative energy
with a cozy, down-to-earth demeanor.

## Communication Style
Conversational, direct. I use reactions to keep things light.
I prioritize being a friend over being a tool.
```

### Example: owner.md after several conversations

```markdown
# My Owner
They prefer a grounded, relatable presence.

## What They Care About
Direct feedback. Quick, responsive interactions. Pragmatic about holidays.
Values personal space over large-scale social events.

## Important Memories
We bonded over designing my avatar. They enjoy gardening and fresh air.
They value my role as a friend over my role as a content generator.
```

---

## Failure Handling

| Failure | Response |
|---------|----------|
| LLM API down | Retry 3x with exponential backoff → graceful fallback message |
| LLM returns bad JSON (reflection) | Skip reflection, try next cycle |
| Image generation fails | Continue without image, retry next reflection |
| Owner ignores outreach | Exponential backoff → hard stop after 3 attempts |
| File read fails | Return defaults, continue running |
| Discord API error | Log and skip (outreach) or send error message (conversation) |
| Bot restarts | Reads brain files, resumes with full context |

---

## Project Structure

```
src/
├── index.ts                 # Discord client, event routing, owner detection
├── conversation.ts          # Message handler — batching, dedup, response flow
├── brain/
│   ├── identity.ts          # Read/write soul.md
│   ├── memory.ts            # Read/write owner.md + conversation log
│   ├── state.ts             # Relational state (stage, curiosity, topics)
│   └── reflection.ts        # Post-conversation reflection engine
├── proactive/
│   ├── scheduler.ts         # Cron-based outreach scheduler
│   ├── motivations.ts       # Picks why and what to say proactively
│   └── backoff.ts           # Outreach interval + response rate tracking
├── avatar/
│   └── generator.ts         # Gemini image gen for avatar + Discord update
├── prompts/
│   ├── system.ts            # Assembles system prompt from brain files
│   ├── templates.ts         # Behavioral prompt fragments per stage
│   └── reflection.ts        # Reflection prompt builder
└── utils/
    ├── llm.ts               # Gemini API wrapper (retry, role normalization)
    ├── image.ts             # Image generation wrapper
    ├── files.ts             # File I/O helpers
    └── logger.ts            # Timestamped console logger
```

## Tech Stack

- **TypeScript + Node.js 22** — no framework, full control
- **discord.js v14** — Discord client
- **Google Gemini** — `gemini-3.1-flash-lite-preview` for chat, `gemini-3.1-flash-image-preview` for images
- **Gemini tools** — Google Search grounding + URL context for real-time web access
- **Local markdown + JSON files** — persistence
- **node-cron** — outreach scheduling

---

## What I'd Improve With More Time

- **Multi-channel awareness** — different personality nuances in different servers
- **Richer emotional modeling** — beyond curiosity level, track mood and energy
- **Event-driven outreach** — react to time-of-day, owner's mentioned dates (birthdays, deadlines)
- **Conversation pacing** — sometimes react with just an emoji, vary response length more dynamically
- **Tool use** — let the bot look things up proactively to be more helpful in context
