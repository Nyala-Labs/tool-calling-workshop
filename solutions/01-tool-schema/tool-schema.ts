/**
 * MODULE 1 — SOLUTION: Tool Schema Definition & Registration
 * ==========================================================
 *
 *
 * KEY INSIGHTS from this module:
 *
 * 1. DESCRIPTIONS ARE PROMPT ENGINEERING
 *    The LLM decides which tool to call based entirely on description text.
 *    "Gets weather" is bad. "Fetch current weather for a city — use when the
 *    user asks about temperature, rain, or forecast" is good.
 *
 * 2. REQUIRED vs OPTIONAL
 *    Put params in `required` only if the function literally cannot run without them.
 *    Optional params (with defaults) should be omitted from `required`.
 *
 * 3. ENUMS REDUCE HALLUCINATION
 *    Without an enum on `unit`, the LLM might pass "Celsius", "C", "metric",
 *    or "degrees centigrade". An enum collapses all of these to one correct value.
 *
 * 4. THE REGISTRY PATTERN
 *    Decouples the schema (what the LLM knows) from the implementation
 *    (what your code does). The reasoning loop only needs to call registry.execute()
 *    — it never needs to know what the tool actually does.
 */

import { ToolDefinition, ToolParameters } from "../../shared/types";

// ---------------------------------------------------------------------------
// SOLUTION: Tool schema for get_current_weather
// ---------------------------------------------------------------------------

export const getWeatherTool: ToolDefinition = {
  type: "function",
  function: {
    name: "get_current_weather",

    // Note: description tells the LLM WHEN to call this, not just what it returns.
    description:
      "Fetch current weather conditions for a city. Use this when the user " +
      "asks about temperature, weather, forecast, or climate in a location.",

    parameters: {
      type: "object",
      properties: {
        location: {
          type: "string",
          description:
            'City name, optionally with country code (e.g. "London, UK" or "Tokyo"). ' +
            "Be specific — avoid abbreviations.",
        },
        unit: {
          type: "string",
          // Enums constrain the LLM to valid values, preventing hallucination.
          enum: ["celsius", "fahrenheit"],
          description:
            'Temperature unit. Default to "celsius" unless the user specifies otherwise.',
        },
      },
      // "unit" is NOT required — the handler defaults it to "celsius" if omitted.
      required: ["location"],
    },
  },
};

// ---------------------------------------------------------------------------
// SOLUTION: ToolRegistry class
// ---------------------------------------------------------------------------

/**
 * Pairs a ToolDefinition (sent to the LLM) with its handler (run locally).
 */
interface RegisteredTool {
  definition: ToolDefinition;
  handler: (args: Record<string, unknown>) => Promise<string>;
}

/**
 * Central registry for all tools available to an agent.
 *
 * The reasoning loop asks the registry for two things:
 *   - getDefinitions() → array sent to the LLM in the `tools` param
 *   - execute(name, args) → runs the tool when the LLM requests it
 */
export class ToolRegistry {
  // A Map is O(1) lookup by name — important when you have many tools.
  private tools = new Map<string, RegisteredTool>();

  /**
   * Registers a tool. Call this once at startup for every tool the agent needs.
   */
  register(
    definition: ToolDefinition,
    handler: (args: Record<string, unknown>) => Promise<string>
  ): void {
    const name = definition.function.name;

    // Warn on duplicate registration — silently overwriting is a footgun.
    if (this.tools.has(name)) {
      console.warn(`[ToolRegistry] Overwriting existing tool: "${name}"`);
    }

    this.tools.set(name, { definition, handler });
  }

  /**
   * Returns all definitions — pass this directly to the OpenAI `tools` parameter.
   */
  getDefinitions(): ToolDefinition[] {
    // Spread the Map's values iterator into an array, then extract .definition.
    return Array.from(this.tools.values()).map((t) => t.definition);
  }

  /**
   * Executes a registered tool by name.
   *
   * Called by the reasoning loop each time the LLM emits a tool_call.
   */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    const tool = this.tools.get(name);

    if (!tool) {
      // LLMs occasionally hallucinate tool names — return a helpful error string
      // rather than crashing, so the LLM can self-correct on the next turn.
      throw new Error(
        `[ToolRegistry] Unknown tool: "${name}". ` +
          `Available tools: ${Array.from(this.tools.keys()).join(", ")}`
      );
    }

    return tool.handler(args);
  }

  /** Returns true if a tool with the given name is registered. */
  has(name: string): boolean {
    return this.tools.has(name);
  }
}

// ---------------------------------------------------------------------------
// SOLUTION: buildTool helper
// ---------------------------------------------------------------------------

/**
 * Ergonomic helper that constructs a {definition, handler} pair from flat config.
 *
 * Without this helper:
 *   { type: "function", function: { name: ..., description: ..., parameters: ... } }
 * With this helper:
 *   buildTool({ name, description, parameters, handler })
 */
export function buildTool(config: {
  name: string;
  description: string;
  parameters: ToolParameters;
  handler: (args: Record<string, unknown>) => Promise<string>;
}): { definition: ToolDefinition; handler: (args: Record<string, unknown>) => Promise<string> } {
  return {
    definition: {
      type: "function",
      function: {
        name: config.name,
        description: config.description,
        parameters: config.parameters,
      },
    },
    handler: config.handler,
  };
}

// ---------------------------------------------------------------------------
// Demo: Self-contained test you can run with `ts-node solutions/01-tool-schema/tool-schema.ts`
// ---------------------------------------------------------------------------

async function demo() {
  const registry = new ToolRegistry();

  // Build and register a calculator tool using the helper.
  const calculateTool = buildTool({
    name: "calculate",
    description:
      "Perform basic arithmetic. Use when the user asks to compute, calculate, " +
      "or do math with two numbers.",
    parameters: {
      type: "object",
      properties: {
        a: { type: "number", description: "The first operand." },
        b: { type: "number", description: "The second operand." },
        operation: {
          type: "string",
          enum: ["add", "subtract", "multiply", "divide"],
          description: "The arithmetic operation to perform.",
        },
      },
      required: ["a", "b", "operation"],
    },
    handler: async ({ a, b, operation }) => {
      const x = a as number;
      const y = b as number;
      const op = operation as string;

      if (op === "divide" && y === 0) return "Error: division by zero";

      const result =
        op === "add" ? x + y :
        op === "subtract" ? x - y :
        op === "multiply" ? x * y :
        x / y;

      return String(result);
    },
  });

  registry.register(calculateTool.definition, calculateTool.handler);

  console.log("=== Registered tools sent to LLM ===");
  console.log(JSON.stringify(registry.getDefinitions(), null, 2));

  console.log("\n=== Tool execution results ===");
  console.log("3 + 2 =", await registry.execute("calculate", { a: 3, b: 2, operation: "add" }));
  console.log("10 / 0 =", await registry.execute("calculate", { a: 10, b: 0, operation: "divide" }));
}

// Only run demo when this file is executed directly (not when imported).
if (require.main === module) {
  demo().catch(console.error);
}
