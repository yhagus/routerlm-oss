---
name: lobakai
description: Entry point for LobakAI — local/remote AI gateway with OpenAI-compatible REST for chat, image, TTS, embeddings, web search, web fetch. Use when the user mentions LobakAI, LOBAKAI_URL, or wants AI without writing provider boilerplate. This skill covers setup + indexes capability skills; fetch the relevant capability SKILL.md from the URLs below when needed.
---

# LobakAI

Local/remote AI gateway exposing OpenAI-compatible REST. One key, many providers, auto-fallback.

## Setup

```bash
export LOBAKAI_URL="http://localhost:20129"      # or VPS / tunnel URL
export LOBAKAI_KEY="sk-..."                      # from Dashboard → Keys (only if requireApiKey=true)
```

All requests: `${LOBAKAI_URL}/v1/...` with header `Authorization: Bearer ${LOBAKAI_KEY}` (omit if auth disabled).

Verify: `curl $LOBAKAI_URL/api/health` → `{"ok":true}`

## Discover models

```bash
curl $LOBAKAI_URL/v1/models                  # chat/LLM (default)
curl $LOBAKAI_URL/v1/models/image            # image-gen
curl $LOBAKAI_URL/v1/models/tts              # text-to-speech
curl $LOBAKAI_URL/v1/models/embedding        # embeddings
curl $LOBAKAI_URL/v1/models/web              # web search + fetch (entries have `kind` field)
curl $LOBAKAI_URL/v1/models/stt              # speech-to-text
curl $LOBAKAI_URL/v1/models/image-to-text    # vision
```

Use `data[].id` as `model` field in requests. Combos appear with `owned_by:"combo"`.

Response shape:
```json
{ "object": "list", "data": [
  { "id": "openai/gpt-5", "object": "model", "owned_by": "openai", "created": 1735000000 },
  { "id": "tavily/search", "object": "model", "kind": "webSearch", "owned_by": "tavily", "created": 1735000000 }
]}
```

## Capability skills

When the user needs a specific capability, fetch that skill's `SKILL.md`. Paths are relative to the host that served this file:

| Capability | Path |
|---|---|
| Chat / code-gen | /skills/lobakai-chat/SKILL.md |
| Image generation | /skills/lobakai-image/SKILL.md |
| Text-to-speech | /skills/lobakai-tts/SKILL.md |
| Speech-to-text | /skills/lobakai-stt/SKILL.md |
| Embeddings | /skills/lobakai-embeddings/SKILL.md |
| Web search | /skills/lobakai-web-search/SKILL.md |
| Web fetch (URL → markdown) | /skills/lobakai-web-fetch/SKILL.md |

## Errors

- 401 → set/refresh `LOBAKAI_KEY` (Dashboard → Keys)
- 400 `Invalid model format` → check `model` exists in `/v1/models/<kind>`
- 503 `All accounts unavailable` → wait `retry-after` or add another provider account
