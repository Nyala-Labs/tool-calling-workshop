/**
 * MODULE 4 — BOILERPLATE: State Persistence & Multi-Turn Tool Calling
 * ====================================================================
 *
 * LEARNING GOAL:
 * Implement thread-based memory so an agent remembers previous turns.
 * Without this, every user message starts a blank conversation — no context,
 * no continuity, no multi-step tasks that span multiple inputs.
 *
 * THE PROBLEM:
 * The LLM itself is stateless — it has no memory between API calls.
 * "Memory" is just the messages array you send each time.
 * To simulate persistence, you store that array somewhere and reload it.
 *
 * TWO LEVELS OF PERSISTENCE:
 *
 *   1. IN-MEMORY (Thread): Fast, simple, lives for the process lifetime.
 *      Use for: single-session agents, testing, rapid prototyping.
 *
 *   2. FILE-BASED (FileThread): Survives process restarts.
 *      Use for: chatbots that remember users, long-running task agents.
 *
 * THE THREAD ABSTRACTION:
 * A "thread" (borrowing OpenAI Assistants terminology) is:
 *   - A unique ID
 *   - A list of messages (the conversation history)
 *   - Metadata (created timestamp, last updated, custom tags)
 *
 * TIME: ~20 minutes
 */

import * as fs from "fs";
import * as path from "path";
import { Message } from "../../shared/types";

// ---------------------------------------------------------------------------
// EXERCISE 1: Define the Thread data structure
//
// A thread holds everything needed to continue a conversation.
// ---------------------------------------------------------------------------

/** A conversation thread — the persistent unit of agent memory. */
export interface Thread {
  /** Unique identifier. Use a timestamp or UUID. */
  id: string;
  /** All messages in this conversation, in order. */
  messages: Message[];
  /** ISO string when this thread was first created. */
  createdAt: string;
  /** ISO string when this thread was last modified. */
  updatedAt: string;
  /** Optional user-defined tags or metadata (e.g. { userId: "u_123" }). */
  metadata: Record<string, string>;
}

// ---------------------------------------------------------------------------
// EXERCISE 2: ThreadStore interface
//
// Define a common interface so in-memory and file-based stores are swappable.
// The reasoning loop only depends on this interface — it doesn't care about storage.
// ---------------------------------------------------------------------------

/**
 * Abstract storage interface for threads.
 * Any implementation (memory, file, database) must satisfy this contract.
 */
export interface ThreadStore {
  /** Creates a new empty thread and returns it. */
  create(metadata?: Record<string, string>): Promise<Thread>;

  /** Retrieves a thread by ID. Returns null if not found. */
  get(threadId: string): Promise<Thread | null>;

  /** Appends a message to an existing thread. Updates `updatedAt`. */
  append(threadId: string, message: Message): Promise<void>;

  /** Appends multiple messages atomically. */
  appendMany(threadId: string, messages: Message[]): Promise<void>;

  /** Lists all thread IDs in the store, sorted newest-first. */
  list(): Promise<string[]>;

  /** Deletes a thread permanently. */
  delete(threadId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// EXERCISE 3: InMemoryThreadStore
//
// Store threads in a Map<string, Thread> — no I/O, just memory.
//
// TODO: Implement all methods.
// HINTS:
//   - generateId(): use Date.now() + random suffix, e.g. `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`
//   - append(): clone the thread, push the message, update updatedAt, re-store.
//   - list(): return keys sorted by thread.createdAt descending.
// ---------------------------------------------------------------------------

export class InMemoryThreadStore implements ThreadStore {
  // TODO: Declare a private Map<string, Thread>

  private generateId(): string {
    // TODO: Return a unique string ID for a new thread.
    throw new Error("TODO: implement generateId()");
  }

  async create(metadata: Record<string, string> = {}): Promise<Thread> {
    // TODO: Create a Thread with a generated ID, empty messages, current timestamps.
    throw new Error("TODO: implement create()");
  }

  async get(threadId: string): Promise<Thread | null> {
    // TODO: Return the thread from the map, or null if not found.
    throw new Error("TODO: implement get()");
  }

  async append(threadId: string, message: Message): Promise<void> {
    // TODO: Get the thread, push the message, update updatedAt, save back.
    // Throw if the thread doesn't exist.
    throw new Error("TODO: implement append()");
  }

  async appendMany(threadId: string, messages: Message[]): Promise<void> {
    // TODO: Same as append but for multiple messages.
    // Use a single get/save cycle (not multiple appends) to avoid redundant work.
    throw new Error("TODO: implement appendMany()");
  }

  async list(): Promise<string[]> {
    // TODO: Return all thread IDs sorted by createdAt descending (newest first).
    throw new Error("TODO: implement list()");
  }

  async delete(threadId: string): Promise<void> {
    // TODO: Remove the thread from the map. Throw if it doesn't exist.
    throw new Error("TODO: implement delete()");
  }
}

// ---------------------------------------------------------------------------
// EXERCISE 4: FileThreadStore
//
// Persist each thread as a JSON file in a directory.
// File name pattern: <threadId>.json
//
// TODO: Implement all methods.
// HINTS:
//   - Use fs.promises (async file I/O) throughout.
//   - threadPath(id): path.join(this.dir, `${id}.json`)
//   - create(): write the initial thread JSON to disk, return the thread.
//   - get(): read + JSON.parse the file; return null if ENOENT.
//   - append/appendMany: read → modify → write back.
// ---------------------------------------------------------------------------

export class FileThreadStore implements ThreadStore {
  private dir: string;

  constructor(directory: string) {
    this.dir = directory;
    // TODO: Ensure the directory exists (fs.mkdirSync with { recursive: true }).
  }

  private threadPath(threadId: string): string {
    // TODO: Return the full file path for a thread.
    throw new Error("TODO: implement threadPath()");
  }

  private generateId(): string {
    return `thread_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  }

  async create(metadata: Record<string, string> = {}): Promise<Thread> {
    // TODO: Build a Thread, write it to disk as JSON, return it.
    throw new Error("TODO: implement create()");
  }

  async get(threadId: string): Promise<Thread | null> {
    // TODO: Read and parse the thread file. Return null on ENOENT (file not found).
    // Propagate other errors (permissions, malformed JSON, etc.).
    throw new Error("TODO: implement get()");
  }

  async append(threadId: string, message: Message): Promise<void> {
    // TODO: Load → push → save.
    throw new Error("TODO: implement append()");
  }

  async appendMany(threadId: string, messages: Message[]): Promise<void> {
    // TODO: Load → push all → save.
    throw new Error("TODO: implement appendMany()");
  }

  async list(): Promise<string[]> {
    // TODO:
    //   1. List all .json files in this.dir.
    //   2. Parse each to get the thread's createdAt.
    //   3. Sort by createdAt descending.
    //   4. Return thread IDs (filenames without .json extension).
    throw new Error("TODO: implement list()");
  }

  async delete(threadId: string): Promise<void> {
    // TODO: Delete the thread file. Handle ENOENT gracefully.
    throw new Error("TODO: implement delete()");
  }
}

// ---------------------------------------------------------------------------
// EXERCISE 5: Integrate threads with the reasoning loop
//
// Write a helper that runs one turn of an agent within a persistent thread.
// This is the function your examples will call.
//
// TODO: Implement runTurn().
// HINTS:
//   - Load (or create) the thread.
//   - Append the user's message.
//   - Pass the full thread.messages as context to the LLM call.
//   - Append the assistant response (and any tool messages) back to the thread.
//   - Return the assistant's final text.
// ---------------------------------------------------------------------------

import OpenAI from "openai";
import { AgentConfig } from "../../shared/types";
import { ToolRegistry } from "../01-tool-schema/tool-schema";

/**
 * Runs a single conversational turn within a persistent thread.
 *
 * @param threadId  - Existing thread ID, or null to create a new thread.
 * @param userInput - The user's message for this turn.
 * @param config    - Agent configuration (model, systemPrompt, tools).
 * @param registry  - Registered tool handlers.
 * @param store     - Thread storage backend.
 * @returns { answer, threadId } — the LLM's reply and the thread ID for next turn.
 */
export async function runTurn(
  threadId: string | null,
  userInput: string,
  config: AgentConfig,
  registry: ToolRegistry,
  store: ThreadStore
): Promise<{ answer: string; threadId: string }> {
  // TODO:
  //   1. If threadId is null, call store.create() to get a new thread.
  //      Otherwise call store.get(threadId) — throw if null (thread not found).
  //
  //   2. Append the user message to the thread.
  //
  //   3. Build the full messages array to send to the LLM:
  //      [systemMessage, ...thread.messages]
  //      (system message is NOT stored in the thread — it's added fresh each turn)
  //
  //   4. Call the LLM and execute any tool calls (use your solutions from modules 2 & 3).
  //      Keep looping until the LLM gives a final answer (no tool_calls).
  //
  //   5. Append all new messages (assistant + tool results) to the thread via store.appendMany().
  //
  //   6. Return { answer: finalText, threadId: thread.id }.
  throw new Error("TODO: implement runTurn()");
}
