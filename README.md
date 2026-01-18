# Cloudflare Skills

A collection of [Agent Skills](https://www.anthropic.com/engineering/equipping-agents-for-the-real-world-with-agent-skills) for building on Cloudflare, Workers, the Agents SDK, and the wider Cloudflare Developer Platform.

## Installing Skills

These skills work with any agent that supports the Agent Skills standard, including Claude Code, OpenCode, OpenAI Codex, and Pi.

Copy the skill directories you need to the appropriate location for your agent:

| Agent | Skill Directory | Docs |
|-------|-----------------|------|
| Claude Code | `~/.claude/skills/` | [docs](https://code.claude.com/docs/en/skills) |
| OpenCode | `~/.config/opencode/skill/` | [docs](https://opencode.ai/docs/skills/) |
| OpenAI Codex | `~/.codex/skills/` | [docs](https://developers.openai.com/codex/skills/) |
| Pi | `~/.pi/agent/skills/` | [docs](https://github.com/badlogic/pi-mono/tree/main/packages/coding-agent#skills) |

## Skills

### Core Platform

| Skill | Useful for | Directory |
|-------|------------|-----------|
| workers | Core Workers fundamentals including handlers, configuration, and Service Bindings | `workers/` |
| wrangler | Deploying and managing Workers, KV, R2, D1, Vectorize, Queues, Workflows | `wrangler/` |
| web-perf | Auditing Core Web Vitals (FCP, LCP, TBT, CLS), render-blocking resources, network chains | `web-perf/` |
| static-assets | Serve static files and single-page applications from Workers | `static-assets/` |

### Storage & Databases

| Skill | Useful for | Directory |
|-------|------------|-----------|
| d1-database | Serverless SQLite database for structured data at the edge | `d1-database/` |
| durable-objects | Stateful coordination (chat rooms, games, booking), RPC, SQLite, alarms, WebSockets | `durable-objects/` |
| kv | Eventually-consistent key-value storage distributed globally | `kv/` |
| r2-storage | S3-compatible object storage for files, images, and large data | `r2-storage/` |
| vectorize | Vector database for embeddings and semantic search at the edge | `vectorize/` |
| hyperdrive | Connection pooling and caching for PostgreSQL and MySQL databases | `hyperdrive/` |

### AI & Agents

| Skill | Useful for | Directory |
|-------|------------|-----------|
| agents-sdk | Building stateful AI agents with state, scheduling, RPC, MCP servers, email, and streaming chat | `agents-sdk/` |
| workers-ai | Run AI inference at the edge with OpenAI SDK and Workers AI | `workers-ai/` |
| building-ai-agent-on-cloudflare | Building AI agents with state, WebSockets, and tool integration | `building-ai-agent-on-cloudflare/` |
| building-mcp-server-on-cloudflare | Building remote MCP servers with tools, OAuth, and deployment | `building-mcp-server-on-cloudflare/` |

### Background Processing

| Skill | Useful for | Directory |
|-------|------------|-----------|
| queues | Asynchronous message queues for reliable background processing | `queues/` |
| workflows | Durable, long-running workflows with automatic retries and state persistence | `workflows/` |
| analytics-engine | Write and query high-cardinality event data at scale with SQL | `analytics-engine/` |

### Frameworks & Tools

| Skill | Useful for | Directory |
|-------|------------|-----------|
| cloudflare-opennext | Deploy Next.js to Cloudflare Workers with full App Router, Pages Router, ISR, and SSG support | `cloudflare-opennext/` |
| browser-rendering | Headless Chrome automation for web scraping, screenshots, PDFs, and testing at the edge | `browser-rendering/` |

## Usage

When a request matches a skill's triggers, the agent loads and applies the relevant skill to provide accurate, up-to-date guidance.

## Validating Skills

To ensure skills follow the Agent Skills standard and have valid frontmatter, use the `skills-ref` validation tool:

```bash
# Validate a single skill
npx skills-ref validate ./agents-sdk

# Validate all skills
npx skills-ref validate ./*/
```

This checks that each `SKILL.md` frontmatter is valid and follows all naming conventions.

## Resources

- [Cloudflare Agents Documentation](https://developers.cloudflare.com/agents/)
- [Cloudflare MCP Guide](https://developers.cloudflare.com/agents/model-context-protocol/)
- [Agents SDK Repository](https://github.com/cloudflare/agents)
- [Agents Starter Template](https://github.com/cloudflare/agents-starter)
