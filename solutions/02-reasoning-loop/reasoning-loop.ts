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
 *    Modern LLMs (mistral-small-latest, mistral-large-latest, etc.) can request multiple tool calls
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

import { Mistral } from "@mistralai/mistralai";
import {
  AgentConfig,
  AgentResult,
  AssistantMessage,
  Message,
  ToolCall,
  ToolResultMessage,
} from "../../shared/types";
import { getWeatherTool, RegisteredTool, ToolRegistry } from "../01-tool-schema/tool-schema";
import "dotenv/config";

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
  mistral: Mistral,
  model: string,
  messages: Message[],
  registry: ToolRegistry
): Promise<AssistantMessage> {
  const response = await mistral.chat.complete({
    model,
    // Cast to `any` because the SDK types for messages are slightly stricter
    // than our portable Message union. The actual shape is identical at runtime.
    messages: messages as any,
    // pass in the entire tool registry, let llm choose which tools to call
    tools: registry.getDefinitions() as any
  });

  // choices[0] is always present for non-streaming completions.
  const message = response.choices![0].message!;

  // Map the SDK response shape to our AssistantMessage type.
  // Note: Mistral SDK uses camelCase `toolCalls`; content may be ContentChunk[] so cast to string.
  return {
    role: "assistant",
    content: (message.content ?? null) as string | null,
    // toolCalls may be undefined when the LLM just returns text.
    // llm would have parsed the user input, stored the tool args inside toolCall property
    tool_calls: (message as any).toolCalls as ToolCall[] | undefined,
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
        // Then move on to the next tool in the toolCalls
        return {
          role: "tool",
          tool_call_id: toolCall.id,
          content: `Error: could not parse arguments for tool "${name}": ${toolCall.function.arguments}`,
        };
      }

      // args are successfully parsed for that particular tool call, now execute tool
      if (verbose) {
        console.log(`  [Tool] Executing "${name}" with args:`, args);
      }

      let content: string;

      try {
        content = await registry.execute(name, args);
      } catch (error) {
        // Tool threw an error — report it as a string so the LLM can self-correct.
        // If  not string, must make it string
        content = `Error executing "${name}": ${error instanceof Error ? error.message : String(error)}`;
      }

      if (verbose) {
        console.log(`  [Tool] "${name}" returned:`, content);
      }

      // return ToolResultMessage
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
  // Mistral exposes an OpenAI-compatible endpoint — we reuse the openai SDK
  // by pointing it at Mistral's base URL with a MISTRAL_API_KEY.
  const mistral = new Mistral({
    apiKey: process.env.MISTRAL_API_KEY,
  });
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
    const assistantMessage = await callLLM(mistral, config.model, messages, registry);

    // Add the LLM's response to history — it MUST see its own prior messages.
    messages.push(assistantMessage);

    // --- STOP CONDITION ---
    // No tool_calls means the LLM is satisfied it has enough information
    // to answer the user directly. Extract the text and return.
    if (!assistantMessage.tool_calls || assistantMessage.tool_calls.length === 0) {
      if (verbose) { // user wants more detailed answer
        console.log("[ReAct] No tool calls — returning final answer.");
      }
      return {
        answer: assistantMessage.content ?? "(No text response)",
        toolCallsMade,
        iterations,
      };
    }

    // LLM has tool calls
    if (verbose) {
      const names = assistantMessage.tool_calls.map((tc) => tc.function.name).join(", ");
      console.log(`[ReAct] ACT — tools requested: ${names}`);
    }

    // --- ACT ---
    // it's a toolResultMessage array
    const toolResults = await executeToolCalls(
      assistantMessage.tool_calls,
      registry,
      verbose
    );

    // --- OBSERVE ---
    // Record what happened for the caller (useful for debugging & logging).
    // we passed the tool calls suggested by the llm, but not all might be called, maybe args or execute have error
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
    // these are all the tool result messages
    messages.push(...toolResults);
  }

  // iteration loop exited
  // Hit iteration limit without a final answer — surface this clearly.
  return {
    answer: `Agent stopped: reached the ${maxIterations}-iteration limit. `,
    toolCallsMade,
    iterations,
  };
}

// Only run demo when this file is executed directly (not when imported).
if (require.main === module) {
  const registry = new ToolRegistry();

  const BuildWeatherTool: RegisteredTool = {
    definition: getWeatherTool,
    handler: async (args: Record<string, unknown>) => {
      const location = args.location as string;
      const unit = (args.unit as string) || "celsius";
      
    // (In a production app, you would use fetch() to call an API like OpenWeatherMap here)
    const isFahrenheit = unit.toLowerCase() === "fahrenheit";
    let temp = 22; // Base temperature

    // Make the mock dynamic based on the city name
    const locLower = location.toLowerCase();
    if (locLower.includes("london")) temp = 12;
    if (locLower.includes("tokyo")) temp = 18;
    if (locLower.includes("dubai")) temp = 35;
    if (locLower.includes("new york")) temp = 15;

    // Convert to Fahrenheit if the LLM requested it
    if (isFahrenheit) {
      temp = Math.round((temp * 9/5) + 32);
    }

    const unitSymbol = isFahrenheit ? "°F" : "°C";

    // 3. Return the string result back to the LLM so it can formulate an answer
    return `The current weather in ${location} is ${temp}${unitSymbol} with partly cloudy skies.`;
  }
};

  registry.register(BuildWeatherTool.definition, BuildWeatherTool.handler);

  const config: AgentConfig = {
    model: "mistral-small-latest",
    systemPrompt: `You are a helpful assistant with access to tools. Use them to answer
                 user questions accurately. Think step-by-step before calling a tool.
                 When you have enough information, respond directly without calling more tools.`,
    maxIterations: 1,
    verbose: true
  };

  runAgent(
      "i want current weather of kuala lumpur in celsius",
      config,
      registry
  ).catch(console.error);
}