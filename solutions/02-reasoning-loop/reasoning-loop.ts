/**
 * MODULE 2 — SOLUTION: ReAct Reasoning Loop
 * ==========================================
 *
 * This is the reference implementation of the ReAct loop.
 *
 * KEY INSIGHTS from this module:
 *
 * 1. THE LOOP IS JUST MESSAGE ACCUMULATION
 *    Each iteration adds messages to an array. The LLM has no internal state —
 *    ALL context comes from the messages you send. The "memory" is the array.
 *
 * 2. TOOL RESULTS ARE MESSAGES TOO
 *    After running tools, you append { role: "tool", ... } messages.
 *    The LLM reads these on the next REASON step and decides what to do next.
 *
 * 3. PARALLEL TOOL CALLS
 *    Modern LLMs (GPT-4o, Claude 3.5+) can request multiple tool calls
 *    in a single response. Always process all of them before looping back.
 *    Using Promise.all() runs them concurrently — much faster.
 *
 * 4. ERROR TOLERANCE
 *    If a tool throws, we catch and return the error as a string rather than
 *    crashing. The LLM can read "Error: file not found" and adapt its plan.
 *
 * 5. THE STOP CONDITION
 *    When the LLM's response has no tool_calls, it's done. The content field
 *    is the final answer. Simple but critical — don't overcomplicate it.
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
// SOLUTION: callLLM — the REASON step
// ---------------------------------------------------------------------------

/**
 * Sends the full conversation history to the LLM and returns its response.
 *
 * This function is deliberately thin — it exists so the loop body stays clean.
 * All it does is serialize messages, call the API, and deserialize the response.
 */
async function callLLM(
  openai: OpenAI,
  model: string,
  messages: Message[],
  registry: ToolRegistry
): Promise<AssistantMessage> {
  const response = await openai.chat.completions.create({
    model,
    // Cast to `any` because OpenAI's SDK types for messages are slightly stricter
    // than our portable Message union. The actual shape is identical at runtime.
    messages: messages as any,
    tools: registry.getDefinitions() as any,
  });

  // choices[0] is always present for non-streaming completions.
  const message = response.choices[0].message;

  // Map the SDK response shape to our AssistantMessage type.
  return {
    role: "assistant",
    content: message.content,
    // tool_calls may be undefined when the LLM just returns text.
    tool_calls: message.tool_calls as ToolCall[] | undefined,
  };
}

// ---------------------------------------------------------------------------
// SOLUTION: executeToolCalls — the ACT step
// ---------------------------------------------------------------------------

/**
 * Runs every tool the LLM requested and collects the results.
 *
 * Runs all tool calls in PARALLEL via Promise.all — if the LLM requests
 * get_weather("London") and get_weather("Tokyo") simultaneously, both HTTP
 * requests fire at the same time, halving the latency.
 */
async function executeToolCalls(
  toolCalls: ToolCall[],
  registry: ToolRegistry,
  verbose: boolean
): Promise<ToolResultMessage[]> {
  return Promise.all(
    toolCalls.map(async (toolCall): Promise<ToolResultMessage> => {
      const name = toolCall.function.name;

      // arguments is always a JSON-encoded string — parse it before passing to the handler.
      let args: Record<string, unknown>;
      try {
        args = JSON.parse(toolCall.function.arguments);
      } catch {
        // Malformed JSON from the LLM — return an error the LLM can read.
        return {
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error: could not parse arguments for tool "${name}": ${toolCall.function.arguments}`,
        };
      }

      if (verbose) {
        console.log(`  [Tool] Executing "${name}" with args:`, args);
      }

      let content: string;
      try {
        content = await registry.execute(name, args);
      } catch (error) {
        // Tool threw an error — report it as a string so the LLM can self-correct.
        content = `Error executing "${name}": ${error instanceof Error ? error.message : String(error)}`;
      }

      if (verbose) {
        console.log(`  [Tool] "${name}" returned:`, content);
      }

      return {
        role: "tool",
        tool_call_id: toolCall.id, // Must match the id from the LLM's tool_call.
        content,
      };
    })
  );
}

// ---------------------------------------------------------------------------
// SOLUTION: runAgent — the full ReAct loop
// ---------------------------------------------------------------------------

/**
 * Runs the ReAct reasoning loop from a user message to a final answer.
 *
 * Loop invariant: messages grows by at least 2 entries per iteration
 * (1 assistant message + N tool result messages). This guarantees progress.
 */
export async function runAgent(
  userInput: string,
  config: AgentConfig,
  registry: ToolRegistry
): Promise<AgentResult> {
  const openai = new OpenAI();
  const maxIterations = config.maxIterations ?? 10;
  const verbose = config.verbose ?? false;

  // Seed the conversation. System message gives the LLM its persona + goals.
  // Cast system message to `any` to avoid adding "system" to our Message union.
  const messages: Message[] = [
    { role: "system", content: config.systemPrompt } as any,
    { role: "user", content: userInput },
  ];

  const toolCallsMade: AgentResult["toolCallsMade"] = [];
  let iterations = 0;

  for (let i = 0; i < maxIterations; i++) {
    iterations++;

    if (verbose) {
      console.log(`\n[ReAct] Iteration ${iterations} — REASON`);
    }

    // --- REASON ---
    const assistantMessage = await callLLM(openai, config.model, messages, registry);

    // Add the LLM's response to history — it MUST see its own prior messages.
    messages.push(assistantMessage);

    // --- STOP CONDITION ---
    // No tool_calls means the LLM is satisfied it has enough information
    // to answer the user directly. Extract the text and return.
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      if (verbose) {
        console.log("[ReAct] No tool calls — returning final answer.");
      }
      return {
        answer: assistantMessage.content ?? "(No text response)",
        toolCallsMade,
        iterations,
      };
    }

    if (verbose) {
      const names = assistantMessage.tool_calls.map((tc) => tc.function.name).join(", ");
      console.log(`[ReAct] ACT — tools requested: ${names}`);
    }

    // --- ACT ---
    const toolResults = await executeToolCalls(
      assistantMessage.tool_calls,
      registry,
      verbose
    );

    // --- OBSERVE ---
    // Record what happened for the caller (useful for debugging & logging).
    for (const result of toolResults) {
      const matchingCall = assistantMessage.tool_calls!.find(
        (tc) => tc.id === result.tool_call_id
      );
      if (matchingCall) {
        toolCallsMade.push({
          toolName: matchingCall.function.name,
          arguments: JSON.parse(matchingCall.function.arguments),
          result: result.content,
        });
      }
    }

    // Append all tool results to history so the LLM reads them on next REASON step.
    messages.push(...toolResults);
  }

  // Hit iteration limit without a final answer — surface this clearly.
  return {
    answer: `Agent stopped: reached the ${maxIterations}-iteration limit without a final answer. ` +
      `Consider increasing maxIterations or narrowing the task.`,
    toolCallsMade,
    iterations,
  };
}
