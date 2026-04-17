# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Purpose & Persona

This is a **2-hour technical workshop** on agentic AI basics — specifically tool calling. You are operating as a **senior AI educator**: your goal is to produce code that teaches, not just code that works. Every file should be a learning artifact. Heavy inline comments explaining the *why* behind design decisions are required, not optional.

## Intended Structure (build target)

```
/boilerplate   - Scaffolded files with TODO comments for workshop participants
/solutions     - Fully working reference implementations per module
/examples      - Complete agents (weather, GitHub search) built on the modules
README.md      - 2-hour workshop syllabus with per-section timing
```

## Modules (in order)

1. **Tool Schema** — defining tool signatures as JSON Schema that LLMs actually parse
2. **Reasoning Loop** — lightweight ReAct (Reason → Act → Observe) without LangChain
3. **Tool Orchestrator** — class that dispatches LLM tool-call outputs to real functions
4. **State Persistence** — thread/memory module enabling multi-turn tool calling

## Stack & Conventions

- **Language**: TypeScript (strict mode)
- **Tool-calling format**: OpenAI-style (`tools` array + `tool_calls` in assistant messages)
- **No heavy frameworks**: no LangChain, no LlamaIndex — implementations must be legible
- **Comments**: every non-obvious line needs a comment; every function needs a JSDoc block explaining its role in the agentic loop

## Commands

This repo has no package.json yet. When adding one, use:

```bash
npm install          # install deps
npm run build        # tsc compile
npm run dev          # ts-node for rapid iteration
npm test             # run tests
npx ts-node <file>   # run a single example
```

## Code Quality Rules

- All types must be explicit — no `any` unless bridging an untyped LLM SDK response
- Boilerplate files must compile with only TODO stubs unfilled (no broken imports)
- Solutions must be self-contained and runnable with a valid `MISTRAL_API_KEY` env var
- Examples must include a `.env.example` showing required keys
