/**
 * MODULE 4 — SOLUTION: State Persistence & Multi-Turn Tool Calling
 * ================================================================
 *
 * KEY INSIGHTS from this module:
 *
 * 1. THREADS ARE JUST ARRAYS PLUS AN ID
 *    There's no magic. A thread is a message array with a unique identifier
 *    so you can reload it later. Everything else (metadata, timestamps) is
 *    operational convenience.
 *
 * 2. THE INTERFACE ENABLES SWAPPABLE STORAGE
 *    The reasoning loop only calls store.create/get/appendMany.
 *    Swap InMemoryThreadStore for FileThreadStore (or a Postgres adapter)
 *    without touching any loop code. This is the interface segregation principle.
 *
 * 3. SYSTEM PROMPT IS NOT STORED
 *    The system prompt is injected fresh on every turn. This lets you update
 *    the agent's instructions without migrating stored thread data.
 *
 * 4. APPENDMANY IS ATOMIC-ISH
 *    We do one read → modify → write per turn (not one per message).
 *    This prevents partial state if the process crashes mid-turn.
 *
 * 5. THE THREAD AS A UNIT OF COST
 *    Every turn sends the entire thread to the LLM. Long threads = more tokens.
 *    In production you'd add summarization or sliding-window truncation.
 *    For this workshop, we keep it simple.
 */

import * as fs from "fs";
import * as path from "path";
import OpenAI from "openai";
import { AgentConfig, AssistantMessage, Message, ToolCall, ToolResultMessage } from "../../shared/types";
import { ToolRegistry } from "../01-tool-schema/tool-schema";

// ---------------------------------------------------------------------------
// Thread data structures
// ---------------------------------------------------------------------------

export interface Thread {
  id: string;
  messages: Message[];
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, string>;
}

export interface ThreadStore {
  create(metadata?: Record<string, string>): Promise<Thread>;
  get(threadId: string): Promise<Thread | null>;
  append(threadId: string, message: Message): Promise<void>;
  appendMany(threadId: string, messages: Message[]): Promise<void>;
  list(): Promise<string[]>;
  delete(threadId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// SOLUTION: InMemoryThreadStore
// ---------------------------------------------------------------------------

export class InMemoryThreadStore implements ThreadStore {
  private threads = new Map<string, Thread>();

  private generateId(): string {
    // Timestamp + short random suffix — collision-resistant for a single process.
    return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  async create(metadata: Record<string, string> = {}): Promise<Thread> {
    const now = new Date().toISOString();
    const thread: Thread = {
      id: this.generateId(),
      messages: [],
      createdAt: now,
      updatedAt: now,
      metadata,
    };
    this.threads.set(thread.id, thread);
    return thread;
  }

  async get(threadId: string): Promise<Thread | null> {
    return this.threads.get(threadId) ?? null;
  }

  async append(threadId: string, message: Message): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    // Produce a new object rather than mutating in place — easier to debug.
    this.threads.set(threadId, {
      ...thread,
      messages: [...thread.messages, message],
      updatedAt: new Date().toISOString(),
    });
  }

  async appendMany(threadId: string, messages: Message[]): Promise<void> {
    const thread = this.threads.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    this.threads.set(threadId, {
      ...thread,
      messages: [...thread.messages, ...messages],
      updatedAt: new Date().toISOString(),
    });
  }

  async list(): Promise<string[]> {
    // Sort by createdAt descending (newest first).
    return Array.from(this.threads.values())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((t) => t.id);
  }

  async delete(threadId: string): Promise<void> {
    if (!this.threads.has(threadId)) throw new Error(`Thread not found: ${threadId}`);
    this.threads.delete(threadId);
  }
}

// ---------------------------------------------------------------------------
// SOLUTION: FileThreadStore
// ---------------------------------------------------------------------------

export class FileThreadStore implements ThreadStore {
  private dir: string;

  constructor(directory: string) {
    this.dir = directory;
    // Create the directory on construction so callers don't need to.
    fs.mkdirSync(directory, { recursive: true });
  }

  private threadPath(threadId: string): string {
    return path.join(this.dir, `${threadId}.json`);
  }

  private generateId(): string {
    return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  async create(metadata: Record<string, string> = {}): Promise<Thread> {
    const now = new Date().toISOString();
    const thread: Thread = {
      id: this.generateId(),
      messages: [],
      createdAt: now,
      updatedAt: now,
      metadata,
    };
    await fs.promises.writeFile(
      this.threadPath(thread.id),
      JSON.stringify(thread, null, 2),
      "utf8"
    );
    return thread;
  }

  async get(threadId: string): Promise<Thread | null> {
    try {
      const raw = await fs.promises.readFile(this.threadPath(threadId), "utf8");
      return JSON.parse(raw) as Thread;
    } catch (error: any) {
      // ENOENT = file doesn't exist — normal "not found" case.
      if (error.code === "ENOENT") return null;
      throw error; // Other errors (permissions, malformed JSON) should propagate.
    }
  }

  async append(threadId: string, message: Message): Promise<void> {
    await this.appendMany(threadId, [message]);
  }

  async appendMany(threadId: string, messages: Message[]): Promise<void> {
    const thread = await this.get(threadId);
    if (!thread) throw new Error(`Thread not found: ${threadId}`);

    const updated: Thread = {
      ...thread,
      messages: [...thread.messages, ...messages],
      updatedAt: new Date().toISOString(),
    };

    await fs.promises.writeFile(
      this.threadPath(threadId),
      JSON.stringify(updated, null, 2),
      "utf8"
    );
  }

  async list(): Promise<string[]> {
    const files = await fs.promises.readdir(this.dir);
    const jsonFiles = files.filter((f) => f.endsWith(".json"));

    // Read each file to get its createdAt for sorting.
    const threads = await Promise.all(
      jsonFiles.map(async (file) => {
        const raw = await fs.promises.readFile(path.join(this.dir, file), "utf8");
        return JSON.parse(raw) as Thread;
      })
    );

    return threads
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((t) => t.id);
  }

  async delete(threadId: string): Promise<void> {
    try {
      await fs.promises.unlink(this.threadPath(threadId));
    } catch (error: any) {
      if (error.code === "ENOENT") throw new Error(`Thread not found: ${threadId}`);
      throw error;
    }
  }
}

// ---------------------------------------------------------------------------
// SOLUTION: runTurn — one conversational turn within a thread
// ---------------------------------------------------------------------------

/**
 * Runs one user → agent turn, persisting all messages to the thread store.
 *
 * This integrates all four modules:
 *   - Module 1: ToolRegistry (tool schema + registration)
 *   - Module 2: ReAct loop logic (inline here for clarity)
 *   - Module 3: Error handling (simplified)
 *   - Module 4: Thread persistence (this module)
 */
export async function runTurn(
  threadId: string | null,
  userInput: string,
  config: AgentConfig,
  registry: ToolRegistry,
  store: ThreadStore
): Promise<{ answer: string; threadId: string }> {
  const openai = new OpenAI();

  // --- 1. Load or create the thread ---
  let thread: Thread;
  if (threadId === null) {
    thread = await store.create();
  } else {
    const existing = await store.get(threadId);
    if (!existing) throw new Error(`Thread not found: ${threadId}`);
    thread = existing;
  }

  // --- 2. Append the user's message to the thread ---
  const userMessage: Message = { role: "user", content: userInput };
  await store.append(thread.id, userMessage);

  // --- 3. Build messages for LLM call ---
  // System prompt injected fresh (not stored in thread).
  const messagesForLLM: any[] = [
    { role: "system", content: config.systemPrompt },
    // Reload thread to get the freshly-appended user message.
    ...(await store.get(thread.id))!.messages,
  ];

  // --- 4. ReAct mini-loop for this turn ---
  const newMessages: Message[] = []; // Messages added THIS turn (assistant + tools).
  const maxIterations = config.maxIterations ?? 10;
  let finalAnswer = "";

  for (let i = 0; i < maxIterations; i++) {
    const response = await openai.chat.completions.create({
      model: config.model,
      messages: [...messagesForLLM, ...newMessages],
      tools: registry.getDefinitions() as any,
    });

    const raw = response.choices[0].message;
    const assistantMessage: AssistantMessage = {
      role: "assistant",
      content: raw.content,
      tool_calls: raw.tool_calls as ToolCall[] | undefined,
    };

    newMessages.push(assistantMessage);

    // No tool calls — LLM has a final answer.
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      finalAnswer = assistantMessage.content ?? "(no response)";
      break;
    }

    // Execute tool calls and collect results.
    const toolResults: ToolResultMessage[] = await Promise.all(
      assistantMessage.tool_calls.map(async (tc): Promise<ToolResultMessage> => {
        let result: string;
        try {
          const args = JSON.parse(tc.function.arguments);
          result = await registry.execute(tc.function.name, args);
        } catch (err) {
          result = `Error: ${err instanceof Error ? err.message : String(err)}`;
        }
        return { role: "tool", tool_call_id: tc.id, content: result };
      })
    );

    newMessages.push(...toolResults);
  }

  // --- 5. Persist all new messages from this turn ---
  await store.appendMany(thread.id, newMessages);

  return { answer: finalAnswer, threadId: thread.id };
}

// ---------------------------------------------------------------------------
// Demo: multi-turn conversation with persistent memory
// ---------------------------------------------------------------------------

async function demo() {
  // Import here to avoid circular deps in the boilerplate version.
  const { buildTool } = await import("../01-tool-schema/tool-schema");
  const registry = new ToolRegistry();

  // A simple calculator tool for testing multi-turn memory.
  const calcTool = buildTool({
    name: "calculate",
    description: "Perform basic arithmetic operations on two numbers.",
    parameters: {
      type: "object",
      properties: {
        a: { type: "number", description: "First number" },
        b: { type: "number", description: "Second number" },
        op: { type: "string", enum: ["add", "subtract", "multiply", "divide"], description: "Operation" },
      },
      required: ["a", "b", "op"],
    },
    handler: async ({ a, b, op }) => {
      const x = a as number, y = b as number;
      if (op === "divide" && y === 0) return "Error: division by zero";
      const r = op === "add" ? x + y : op === "subtract" ? x - y : op === "multiply" ? x * y : x / y;
      return String(r);
    },
  });
  registry.register(calcTool.definition, calcTool.handler);

  const store = new InMemoryThreadStore();
  const config: AgentConfig = {
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
    systemPrompt: "You are a helpful math assistant. Use the calculate tool when asked to do arithmetic.",
    tools: registry.getDefinitions(),
    verbose: true,
  };

  console.log("=== Turn 1 ===");
  const turn1 = await runTurn(null, "What is 42 times 7?", config, registry, store);
  console.log("Answer:", turn1.answer);
  console.log("Thread ID:", turn1.threadId);

  console.log("\n=== Turn 2 (same thread — agent remembers the previous result) ===");
  const turn2 = await runTurn(turn1.threadId, "Now divide that result by 6.", config, registry, store);
  console.log("Answer:", turn2.answer);

  console.log("\n=== Thread history ===");
  const thread = await store.get(turn1.threadId);
  console.log(`Thread has ${thread?.messages.length} messages.`);
}

if (require.main === module) {
  demo().catch(console.error);
}
