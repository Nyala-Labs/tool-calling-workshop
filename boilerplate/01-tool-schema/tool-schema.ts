/**
 * MODULE 1 — BOILERPLATE: Tool Schema Definition & Registration
 * ============================================================
 *
 * LEARNING GOAL:
 * Understand how to describe functions to an LLM using JSON Schema so it
 * can decide WHEN to call them and WHAT arguments to pass.
 *
 * THE CORE PROBLEM:
 * An LLM cannot import your TypeScript functions — it only sees text.
 * To bridge this gap, you write a JSON Schema "contract" for each function.
 * The LLM reads this contract and generates valid function calls at runtime.
 *
 * WHAT IS JSON SCHEMA?
 * A standard (json-schema.org) for describing the shape of a JSON object.
 * It specifies: field names, types, descriptions, and which fields are required.
 * The LLM treats the `description` fields as instructions — write them imperatively.
 *
 * TIME: ~30 minutes
 */

import { ToolDefinition, ToolFunction, ToolParameters } from "../../shared/types";

// ---------------------------------------------------------------------------
// EXERCISE 1: Define a tool schema manually
//
// Below is the skeleton of a "get_weather" tool.
// Fill in the TODO sections to make this a valid ToolDefinition.
//
// HINTS:
//   - The `description` on the function should say WHEN to use it, not just WHAT it does.
//   - The `description` on each parameter helps the LLM know what value to supply.
//   - `required` lists parameter names that have no sensible default.
// ---------------------------------------------------------------------------

export const getWeatherTool: ToolDefinition = {
  type: "function",
  function: {
    // TODO: Give this tool a snake_case name (e.g. "get_current_weather")
    name: "TODO",

    // TODO: Write a description that tells the LLM *when* to call this tool.
    // Think: "Use this when the user asks about..."
    description: "TODO",

    parameters: {
      type: "object",
      properties: {
        // TODO: Add a "location" property with:
        //   - type: "string"
        //   - a description explaining what format the location should be in
        //   (e.g. city name, "City, Country", lat/lon?)

        // TODO: Add a "unit" property with:
        //   - type: "string"
        //   - an enum restricting it to ["celsius", "fahrenheit"]
        //   - a description explaining what it controls
      },

      // TODO: Mark "location" as required (unit should be optional — give a default later)
      required: [],
    },
  },
};

// ---------------------------------------------------------------------------
// EXERCISE 2: Build a ToolRegistry class
//
// A registry is a central map of tool name → (definition + handler function).
// The reasoning loop will use this to:
//   1. Collect all ToolDefinitions to send to the LLM.
//   2. Look up which function to run when the LLM calls a tool by name.
//
// TODO: Implement the methods marked below.
// ---------------------------------------------------------------------------

/**
 * A registered tool: the schema the LLM sees, paired with the function to run.
 */
interface RegisteredTool {
  definition: ToolDefinition;
  // A handler is a function that accepts any object of arguments and returns
  // a Promise resolving to a string (the result to send back to the LLM).
  handler: (args: Record<string, unknown>) => Promise<string>;
}

export class ToolRegistry {
  // TODO: Declare a private Map<string, RegisteredTool> to store tools by name.
  // private tools = ...

  /**
   * Registers a tool definition alongside its implementation.
   *
   * @param definition - The JSON Schema contract shown to the LLM.
   * @param handler    - The actual function to execute when the LLM calls this tool.
   */
  register(
    definition: ToolDefinition,
    handler: (args: Record<string, unknown>) => Promise<string>
  ): void {
    // TODO: Store the definition and handler in the map, keyed by definition.function.name
    throw new Error("TODO: implement register()");
  }

  /**
   * Returns all tool definitions — this is what you pass to the LLM in the `tools` array.
   */
  getDefinitions(): ToolDefinition[] {
    // TODO: Return an array of all ToolDefinition objects stored in the map.
    throw new Error("TODO: implement getDefinitions()");
  }

  /**
   * Looks up and executes a tool by name with the given arguments.
   *
   * @param name - Tool name from the LLM's tool_call.
   * @param args - Parsed arguments from the LLM's tool_call.arguments (already JSON.parsed).
   * @returns The string result to send back to the LLM.
   * @throws If no tool with that name is registered.
   */
  async execute(name: string, args: Record<string, unknown>): Promise<string> {
    // TODO:
    //   1. Look up the tool by name.
    //   2. If not found, throw a descriptive error (the LLM may hallucinate tool names).
    //   3. Call the handler with args and return the result.
    throw new Error("TODO: implement execute()");
  }
}

// ---------------------------------------------------------------------------
// EXERCISE 3: Helper function — buildTool
//
// Writing ToolDefinition objects by hand is verbose. Build a helper that
// makes defining tools feel more ergonomic.
//
// TODO: Implement buildTool so the test below compiles and passes.
// ---------------------------------------------------------------------------

/**
 * Convenience wrapper that builds a ToolDefinition from a plain config object,
 * so you don't have to repeat `type: "function"` and the nested `function:` key.
 *
 * Usage:
 *   const myTool = buildTool({
 *     name: "search_web",
 *     description: "Search the web for current information.",
 *     parameters: { type: "object", properties: { query: { type: "string" } }, required: ["query"] },
 *     handler: async ({ query }) => { ... }
 *   });
 */
export function buildTool(config: {
  name: string;
  description: string;
  parameters: ToolParameters;
  handler: (args: Record<string, unknown>) => Promise<string>;
}): { definition: ToolDefinition; handler: (args: Record<string, unknown>) => Promise<string> } {
  // TODO: Return an object with:
  //   - definition: a ToolDefinition wrapping config.name, config.description, config.parameters
  //   - handler: config.handler
  throw new Error("TODO: implement buildTool()");
}

// ---------------------------------------------------------------------------
// EXERCISE 4: Register a real tool and test your registry
//
// Uncomment and complete the code below once Exercise 2 & 3 are done.
// ---------------------------------------------------------------------------

/*
const registry = new ToolRegistry();

// TODO: Use buildTool() to create a "calculate" tool that:
//   - takes two numbers: "a" and "b"
//   - takes an "operation" string with enum: ["add", "subtract", "multiply", "divide"]
//   - returns the result as a string
//   - handles division by zero gracefully

const calculateTool = buildTool({
  name: "calculate",
  description: "TODO",
  parameters: {
    type: "object",
    properties: {
      // TODO: fill in a, b, and operation
    },
    required: ["a", "b", "operation"],
  },
  handler: async (args) => {
    const { a, b, operation } = args as { a: number; b: number; operation: string };
    // TODO: implement the math
    return "TODO";
  },
});

registry.register(calculateTool.definition, calculateTool.handler);

// This should print all registered tool definitions:
console.log("Registered tools:", JSON.stringify(registry.getDefinitions(), null, 2));

// This should print "5":
registry.execute("calculate", { a: 3, b: 2, operation: "add" }).then(console.log);
*/
