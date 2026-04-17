/**
 * MODULE 2 — BOILERPLATE: ReAct Reasoning Loop
 * =============================================
 *
 * LEARNING GOAL:
 * Implement the ReAct (Reason + Act) loop — the core control flow that
 * turns a stateless LLM into an agent that can use tools iteratively.
 *
 * THE ReAct PATTERN (from the 2022 Google paper):
 *
 *   ┌─────────────────────────────────────────────────────┐
 *   │  REASON:  LLM looks at history + tools, decides     │
 *   │           whether to call a tool or answer directly │
 *   │                                                     │
 *   │    ↓  (if tool_calls present in response)           │
 *   │                                                     │
 *   │  ACT:     Execute the requested tool(s)             │
 *   │                                                     │
 *   │    ↓                                                │
 *   │                                                     │
 *   │  OBSERVE: Append tool result to conversation        │
 *   │           history. Loop back to REASON.             │
 *   │                                                     │
 *   │    ↓  (if no tool_calls — LLM gave final answer)   │
 *   │                                                     │
 *   │  ANSWER:  Return the text response to the caller   │
 *   └─────────────────────────────────────────────────────┘
 *
 * WHY NOT LANGCHAIN?
 * LangChain abstracts this loop away — great for prototyping, bad for learning.
 * Here you implement it from scratch so you understand every decision point.
 *
 * TIME: ~30 minutes
 */

import OpenAI from "openai";
import {
  AgentConfig,
  AgentResult,
  AssistantMessage,
  Message,
  ToolCall,
  ToolResultMessage,
} from "../../shared/types";
import { ToolRegistry } from "../01-tool-schema/tool-schema";

// ---------------------------------------------------------------------------
// EXERCISE 1: Understand the message history
//
// The entire "memory" of a ReAct agent is its message history.
// Each iteration of the loop appends messages to this array.
//
// A complete tool-call cycle adds THREE messages:
//   1. AssistantMessage (with tool_calls) — the LLM's request
//   2. ToolResultMessage (role: "tool")   — the tool's output
//   3. (next loop) AssistantMessage       — the LLM's reaction
//
// TODO: Read the type definitions in shared/types.ts before proceeding.
//       Understand UserMessage, AssistantMessage, and ToolResultMessage.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// EXERCISE 2: Implement callLLM
//
// This function sends the current message history + tool definitions to the
// LLM and returns the assistant's response.
//
// TODO: Implement this function.
// HINTS:
//   - Use openai.chat.completions.create()
//   - Pass `messages` and `tools` in the request
//   - The response is at response.choices[0].message
//   - Cast to AssistantMessage — its shape matches what OpenAI returns
// ---------------------------------------------------------------------------

/**
 * Sends a conversation history to the LLM and returns the assistant's reply.
 * This is one "REASON" step in the ReAct loop.
 */
async function callLLM(
  openai: OpenAI,
  model: string,
  messages: Message[],
  registry: ToolRegistry
): Promise<AssistantMessage> {
  // TODO: Call openai.chat.completions.create() with:
  //   - model: model
  //   - messages: messages (cast as any — OpenAI SDK types are slightly different)
  //   - tools: registry.getDefinitions() (cast as any)
  //
  // Return the first choice's message as an AssistantMessage.
  throw new Error("TODO: implement callLLM()");
}

// ---------------------------------------------------------------------------
// EXERCISE 3: Implement executeToolCalls
//
// When the LLM returns tool_calls, you must run each tool and collect results.
//
// TODO: Implement this function.
// HINTS:
//   - tool_calls is an array — process ALL of them (parallel calling!)
//   - Each ToolCall has: id, function.name, function.arguments (a JSON string)
//   - Parse arguments with JSON.parse() before passing to registry.execute()
//   - Return one ToolResultMessage per ToolCall (matching tool_call_id)
//   - If a tool throws, catch the error and return the error message as the result
//     (the LLM can then self-correct — crashing the loop is worse)
// ---------------------------------------------------------------------------

/**
 * Runs all tool calls the LLM requested and returns their results.
 * This is the "ACT" step in the ReAct loop.
 */
async function executeToolCalls(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
  verbose: boolean
): Promise<ToolResultMessage[]> {
  // TODO:
  //   1. Map each toolCall to a Promise<ToolResultMessage>
  //   2. Parse toolCall.function.arguments (JSON string → object)
  //   3. Call registry.execute(name, parsedArgs)
  //   4. If it throws, return the error message as the content
  //   5. Use Promise.all() to run all tools in parallel
  throw new Error("TODO: implement executeToolCalls()");
}

// ---------------------------------------------------------------------------
// EXERCISE 4: Implement the main runAgent function
//
// This is the ReAct loop itself.
//
// TODO: Implement the loop. The skeleton below shows the structure.
// HINTS:
//   - Build initial message history: [systemMessage, userMessage]
//   - Loop up to maxIterations times
//   - Each iteration: call LLM → check for tool_calls → execute → append results
//   - If no tool_calls, the LLM is done — return the text content as the answer
//   - If maxIterations is hit, return a timeout message
// ---------------------------------------------------------------------------

/**
 * Runs the ReAct agent loop until the LLM produces a final answer or
 * the iteration limit is reached.
 *
 * @param userInput - The user's message to the agent.
 * @param config    - Model, system prompt, tools, and loop settings.
 * @param registry  - The tool registry with registered handlers.
 * @returns The agent's final answer and a log of all tool calls made.
 */
export async function runAgent(
  userInput: string,
  config: AgentConfig,
  registry: ToolRegistry
): Promise<AgentResult> {
  const openai = new OpenAI(); // Reads OPENAI_API_KEY from environment
  const maxIterations = config.maxIterations ?? 10;
  const verbose = config.verbose ?? false;

  // --- Build initial message history ---
  // The system prompt goes first as a "system" role message.
  // Note: the OpenAI SDK accepts { role: "system", content: string } but we
  // cast to `any` since our Message union doesn't include "system" (keep it simple).
  const messages: Message[] = [
    // TODO: Add the system message: { role: "system", content: config.systemPrompt }
    // TODO: Add the user message: { role: "user", content: userInput }
  ] as Message[];

  // --- Tracking for the returned AgentResult ---
  const toolCallsMade: AgentResult["toolCallsMade"] = [];
  let iterations = 0;

  // --- The ReAct loop ---
  for (let i = 0; i < maxIterations; i++) {
    iterations++;

    if (verbose) {
      console.log(`\n[Loop] Iteration ${iterations} — calling LLM...`);
    }

    // REASON: Ask the LLM what to do next.
    // TODO: Call callLLM() and store the result as `assistantMessage`.
    // const assistantMessage = ...

    // Append the assistant's message to history so the LLM sees its own output
    // on the next iteration.
    // TODO: Push assistantMessage to messages

    // --- Check: did the LLM request any tool calls? ---
    // TODO: if assistantMessage.tool_calls is empty or undefined:
    //         return { answer: assistantMessage.content ?? "", toolCallsMade, iterations }
    //       (No tool calls means the LLM has a final answer.)

    if (verbose) {
      // TODO: log the names of the tools being called
      console.log(`[Loop] LLM requested tools: TODO`);
    }

    // ACT + OBSERVE: Execute the tools and append results.
    // TODO: Call executeToolCalls() to get tool results.
    // TODO: For each result, track it in toolCallsMade.
    // TODO: Append all ToolResultMessages to messages.
  }

  // If we exit the loop without a final answer, the agent hit its iteration limit.
  return {
    answer: `Agent stopped after ${maxIterations} iterations without a final answer.`,
    toolCallsMade,
    iterations,
  };
}
