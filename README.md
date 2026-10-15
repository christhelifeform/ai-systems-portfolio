# AI Systems Portfolio — Christopher Marriott

**AI ops & internal-tools builder · creative producer** · Orange County / LA

I build AI systems that let small teams produce like big ones: governed agent teams with human approval gates, internal tools people actually use, and the cost/usage tracking that shows whether they work. Before that: 10+ years in creative production and brand content (Rushbreakers, y3k.baby, FIZZ CULTURE).

How I work: **ship a minimum viable version fast, then refine it with feedback loops from real use.**

> Most of my production code lives in private repos (client and employer data). This repo shows the architecture, real design decisions, and sanitized excerpts in [`llm-and-agent-kit/`](llm-and-agent-kit/).

## Skills
| Area | What I use |
|---|---|
| LLM apps & agents | Claude API, Claude Code, OpenAI / Gemini / xAI / DeepSeek / Groq APIs, multi-agent role specs, JSON-mode planning calls |
| Languages | Python, TypeScript / JavaScript, Google Apps Script, shell, SQL, some Swift |
| Data & infra | Supabase (Postgres), Next.js, Vercel, Inngest, Modal, launchd/cron, REST/webhooks |
| Agent safety & ops | Human approval queues, kill switch, pre-commit governance freeze, role allowlists, scheduled self-audits |
| Voice | Whisper STT (Groq/local), ElevenLabs TTS |

## Featured projects
| # | Project | One line |
|---|---|---|
| 01 | [Slay OS](projects/01-slay-os/) | Governed multi-agent operating system that runs my studio: 13 role agents, approval queue, kill switch, pre-commit freeze |
| 02 | [Team assistant on Google Workspace](projects/02-team-assistant/) | Internal Apps Script + LLM app, live ~2 days after I started building it, iterated in production |
| 03 | [Multi-provider LLM router](projects/03-llm-router/) | Routes tasks across Anthropic, OpenAI, Google, xAI, DeepSeek; per-call cost + usage logged to Supabase |
| 04 | [Quinn — voice AI producer with recall](projects/04-quinn-recall/) | Real-time voice co-host; a small "librarian" LLM plans transcript searches for cheap, targeted recall |
| 05 | [HookLab lead pipeline](projects/05-hooklab-pipeline/) | Supabase + Claude lead import and client wrappers with a human approval gate |
| 06 | [HeyAgent (Clawathon)](projects/06-heyagent/) | Hackathon entry built by my agent squad; personal-AI-agent web app deployed on Vercel |
| 07 | [Voidglyph](projects/07-voidglyph/) | An AI-native visual language created with my agent Nanohana |

## Code you can read
[`llm-and-agent-kit/`](llm-and-agent-kit/) — real excerpts, cleaned of secrets, IDs and names:
- `governance/pre-commit` — protected-path freeze with an explicit threat model
- `router/router.ts` — model selection, cost calculation, usage tracking
- `recall/recall.py` — LLM-planned transcript retrieval

## Contact
chris@hooklab.tv · [linkedin.com/in/cgmarriott](https://linkedin.com/in/cgmarriott)
