# Agentic AI Basics: Tool Calling Workshop

A 2-hour hands-on workshop that takes you from "what is a tool call?" to building a working multi-turn AI agent from scratch — no heavy frameworks required.

---

## Prerequisites

- TypeScript / JavaScript familiarity (intermediate level)
- Basic understanding of async/await and REST APIs
- An OpenAI API key with GPT-4o access

```bash
# Install dependencies
npm install

# Copy environment config
cp .env.example .env
# → Edit .env and add your OPENAI_API_KEY
```

---

## What You'll Build

By the end of this workshop, you will have implemented:

| Module | What you build | Core concept |
|--------|---------------|--------------|
| 1 | Tool Schema + Registry | JSON Schema, tool definitions |
| 2 | ReAct Reasoning Loop | Reason → Act → Observe |
| 3 | Tool Orchestrator | Validation, retry, timeout |
| 4 | State Persistence | Multi-turn thread memory |

Then you'll run two complete working agents:

- **Weather Agent** — current conditions + forecast with parallel tool calls
- **GitHub Search Agent** — explore and read real codebases via tool chaining

---

## Workshop Syllabus

### Module 1 — Tool Schema & Registration `[0:00 – 0:30]`

**The core question:** How do you describe a TypeScript function to an LLM so it knows when to call it?

**Key concepts:**

- JSON Schema: the lingua franca between your code and the LLM
- The `tools` array: what you send to the API
- `description` as prompt engineering — "when to call" not "what it returns"
- `required` vs optional parameters
- Enums to prevent hallucinated argument values
- The `ToolRegistry` pattern: decoupling schema from implementation

**Exercises in `boilerplate/01-tool-schema/tool-schema.ts`:**

1. Define a `get_current_weather` tool schema with location + unit
2. Implement the `ToolRegistry` class (register, getDefinitions, execute)
3. Build the `buildTool()` ergonomic helper
4. Register and test a `calculate` tool

**Run the solution to see expected output:**
```bash
npx ts-node solutions/01-tool-schema/tool-schema.ts
```

**Discussion checkpoint (5 min):**
> What happens if you remove the description from a tool? Try it and see how the LLM behaves.

---

### Module 2 — The ReAct Reasoning Loop `[0:30 – 1:00]`

**The core question:** How does an LLM "decide" to use a tool, and how do you turn that decision into a real function call?

**Key concepts:**

- The ReAct pattern (Reason + Act): a loop, not a single call
- How tool calls appear in the API response (`tool_calls` array)
- Why `role: "tool"` messages must be appended BEFORE the next LLM call
- The stop condition: no `tool_calls` = final answer
- Parallel tool calls: the LLM can request multiple tools in one response
- The `maxIterations` safety limit — preventing infinite loops

**The loop in plain English:**

```
1. Send [system, ...history] to LLM
2. LLM replies with tool_calls or text
3. If tool_calls:
     a. Execute all requested tools
     b. Append assistant message + tool results to history
     c. Go to step 1
4. If text (no tool_calls):
     return text as final answer
```

**Exercises in `boilerplate/02-reasoning-loop/reasoning-loop.ts`:**

1. Implement `callLLM()` — the REASON step
2. Implement `executeToolCalls()` — the ACT step (with error handling)
3. Implement the `runAgent()` loop

**Run the solution:**
```bash
npx ts-node solutions/02-reasoning-loop/reasoning-loop.ts
```

**Discussion checkpoint (5 min):**
> What would happen without the `maxIterations` limit? Can you construct a task where the agent would loop forever?

---

### Module 3 — Tool Orchestrator `[1:00 – 1:20]`

**The core question:** What happens between "LLM requests a tool" and "tool executes"? How do you make that layer robust?

**Key concepts:**

- Argument validation: catching LLM mistakes before they crash your code
- `Promise.race()` for timeouts — bounding any async operation
- Exponential backoff: retrying transient API failures gracefully
- The execution log: observability for debugging agent behavior
- Why the factory function pattern (`() => Promise<T>`) is required for retry

**Exercises in `boilerplate/03-tool-orchestrator/tool-orchestrator.ts`:**

1. Implement `validateArguments()` — check required fields + types
2. Implement `withTimeout()` — race a promise against a deadline
3. Implement `withRetry()` — exponential backoff loop
4. Implement `ToolOrchestrator.execute()` — compose all three

**Mental model for composing these:**
```
execute(toolCall) =
  parse(args)
  → validate(args, schema)
  → withRetry(() => withTimeout(registry.execute(name, args), 10s))
  → log(result)
```

**Discussion checkpoint (5 min):**
> The retry function takes `() => Promise<T>`, not `Promise<T>`. Why? What would happen if you passed a plain Promise?

---

### Module 4 — State Persistence `[1:20 – 1:40]`

**The core question:** How does an agent remember what was said in a previous message, or even a previous session?

**Key concepts:**

- Why the LLM is stateless: it only "knows" what you send it
- Threads: conversation history as a first-class entity
- The `ThreadStore` interface: enabling swappable storage backends
- In-memory vs file-based persistence: tradeoffs
- System prompt injection: why it's NOT stored in the thread
- Token cost of memory: longer threads = more tokens per turn

**Exercises in `boilerplate/04-state-persistence/state-persistence.ts`:**

1. Implement `InMemoryThreadStore` (create, get, append, appendMany, list, delete)
2. Implement `FileThreadStore` — same interface, writes JSON to disk
3. Implement `runTurn()` — one conversational turn within a persistent thread

**Test multi-turn memory:**
```bash
npx ts-node solutions/04-state-persistence/state-persistence.ts
# Observe: Turn 2 references the result of Turn 1's calculation
```

**Discussion checkpoint (5 min):**
> What are the scaling limits of this approach? What would you change for a production chatbot with 10,000 concurrent users?

---

### Examples & Wrap-up `[1:40 – 2:00]`

**Run the weather agent (no extra API key needed):**
```bash
npm run example:weather
```

Watch the verbose output to see:
- How the LLM decides WHICH tool to call for each question
- Parallel tool calls when comparing two cities
- Multi-step chaining: current weather → then forecast

**Run the GitHub search agent (requires `GITHUB_TOKEN` in `.env`):**
```bash
npm run example:github
```

Watch the verbose output to see:
- Tool chaining: `search_github_code` → `get_file_contents`
- Multi-turn context: Turn 2 references what Turn 1 found
- How the agent synthesizes code search results into an explanation

**Final discussion (5 min):**

1. What would a production agent need that we skipped? (answer: streaming, cost tracking, human-in-the-loop approval, tool versioning)
2. When does tool calling break down? (answer: too many tools → LLM can't choose, ambiguous descriptions, missing context)
3. What's the difference between this and LangChain? (answer: LangChain hides the loop — now you know what's inside it)

---

## Repository Structure

```
.
├── shared/
│   └── types.ts                    # All shared TypeScript types
│
├── boilerplate/                    # Start here — fill in the TODOs
│   ├── 01-tool-schema/
│   │   └── tool-schema.ts
│   ├── 02-reasoning-loop/
│   │   └── reasoning-loop.ts
│   ├── 03-tool-orchestrator/
│   │   └── tool-orchestrator.ts
│   └── 04-state-persistence/
│       └── state-persistence.ts
│
├── solutions/                      # Reference implementations
│   ├── 01-tool-schema/
│   ├── 02-reasoning-loop/
│   ├── 03-tool-orchestrator/
│   └── 04-state-persistence/
│
├── examples/                       # Complete agents built on the modules
│   ├── weather-agent/
│   │   └── weather-agent.ts        # Parallel tool calls, mock weather API
│   └── github-search-agent/
│       └── github-search-agent.ts  # Tool chaining, real GitHub API, multi-turn
│
├── package.json
├── tsconfig.json
└── .env.example
```

---

## Quick Reference: OpenAI Tool Calling Format

```typescript
// 1. Define tools (sent to LLM in every request)
const tools = [{
  type: "function",
  function: {
    name: "get_weather",
    description: "Get current weather for a city.",
    parameters: {
      type: "object",
      properties: {
        location: { type: "string", description: "City name" }
      },
      required: ["location"]
    }
  }
}];

// 2. Send to LLM
const response = await openai.chat.completions.create({ model, messages, tools });
const message = response.choices[0].message;

// 3. Check for tool calls
if (message.tool_calls) {
  for (const toolCall of message.tool_calls) {
    const name = toolCall.function.name;               // "get_weather"
    const args = JSON.parse(toolCall.function.arguments); // { location: "London" }
    const result = await myFunctions[name](args);      // call your function

    // 4. Return results to LLM
    messages.push({ role: "assistant", ...message });
    messages.push({ role: "tool", tool_call_id: toolCall.id, content: result });
  }
  // 5. Loop: call LLM again with tool results appended
}
```

---

## Troubleshooting

**`Error: OPENAI_API_KEY is missing`**
→ Copy `.env.example` to `.env` and add your key.

**`Error: GitHub API error 403`**
→ Add a `GITHUB_TOKEN` to `.env`. Without it, GitHub rate-limits unauthenticated requests to 60/hour.

**`Agent stopped after N iterations`**
→ Increase `maxIterations` in the agent config, or simplify the task.

**`Unknown tool: "xyz"`**
→ The LLM hallucinated a tool name. Make sure all tool names in the system prompt exactly match the registered names.

**TypeScript errors in boilerplate files**
→ That's expected — the `throw new Error("TODO")` stubs prevent compilation until implemented. Run `npm run check` to see the full error list.
