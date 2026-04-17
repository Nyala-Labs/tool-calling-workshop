/**
 * MODULE 3 — SOLUTION: Tool Orchestrator
 * =======================================
 *
 * KEY INSIGHTS from this module:
 *
 * 1. VALIDATION AS A FIRST-CLASS CONCERN
 *    LLMs occasionally pass wrong types or omit required args.
 *    Catching this before execution gives a clean error the LLM can read
 *    and self-correct, rather than a cryptic internal crash.
 *
 * 2. TIMEOUTS PROTECT THE LOOP
 *    A single hanging HTTP call would freeze the entire agent indefinitely.
 *    Promise.race() is the canonical JS pattern to add timeout to any async op.
 *
 * 3. RETRY IS TRANSPARENT
 *    The reasoning loop doesn't know retries happened. The orchestrator
 *    absorbs transient failures silently, returning a result on eventual success.
 *
 * 4. THE LOG IS OBSERVABILITY
 *    Every execution record is appended to executionLog regardless of success/failure.
 *    This gives you a full audit trail of everything the agent did — invaluable for debugging.
 *
 * 5. FACTORY FUNCTION FOR RETRY
 *    withRetry takes () => Promise<T>, not Promise<T>.
 *    A Promise starts executing the moment it's created — to retry, you need a
 *    new Promise each time, which means a factory function.
 */

import { ToolCall, ToolDefinition, ToolResultMessage } from "../../shared/types";
import { ToolRegistry } from "../01-tool-schema/tool-schema";

export interface ExecutionRecord {
  callId: string;
  toolName: string;
  arguments: Record<string, unknown>;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "success" | "error";
  result?: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// SOLUTION: Argument validation
// ---------------------------------------------------------------------------

export interface ValidationResult {
  valid: boolean;
  errors?: string[];
}

/**
 * Lightweight JSON Schema validator.
 * Checks required fields and basic type matching for primitive types.
 */
export function validateArguments(
  definition: ToolDefinition,
  args: Record<string, unknown>
): ValidationResult {
  const { required = [], properties } = definition.function.parameters;
  const errors: string[] = [];

  // Check all required fields are present and non-null.
  for (const field of required) {
    if (args[field] === undefined || args[field] === null) {
      errors.push(`Missing required argument: "${field}"`);
    }
  }

  // Check type compatibility for provided fields.
  for (const [key, value] of Object.entries(args)) {
    const schema = properties[key];
    if (!schema) continue; // Unknown properties are allowed (the LLM may add extras).

    const expectedType = schema.type;
    const actualType = typeof value;

    // JSON Schema uses "number" but typeof uses "number" too — they match directly
    // for string, number, boolean. "array" needs a special check.
    if (expectedType === "array" && !Array.isArray(value)) {
      errors.push(`Argument "${key}": expected array, got ${actualType}`);
    } else if (
      expectedType !== "array" &&
      expectedType !== "object" &&
      expectedType !== "null" &&
      actualType !== expectedType
    ) {
      errors.push(`Argument "${key}": expected ${expectedType}, got ${actualType}`);
    }

    // Validate enum constraint if present.
    if (schema.enum && typeof value === "string" && !schema.enum.includes(value)) {
      errors.push(
        `Argument "${key}": "${value}" is not one of [${schema.enum.map((e) => `"${e}"`).join(", ")}]`
      );
    }
  }

  return {
    valid: errors.length === 0,
    errors: errors.length > 0 ? errors : undefined,
  };
}

// ---------------------------------------------------------------------------
// SOLUTION: Timeout wrapper
// ---------------------------------------------------------------------------

/**
 * Races a promise against a deadline.
 *
 * Implementation note: we do NOT cancel the original promise on timeout —
 * JS Promises are not cancellable. The timeout just stops us from waiting.
 * In production you'd use AbortController for HTTP calls.
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string
): Promise<T> {
  const timeoutPromise = new Promise<never>((_, reject) =>
    setTimeout(
      () => reject(new Error(`Timeout: "${label}" exceeded ${timeoutMs}ms`)),
      timeoutMs
    )
  );

  return Promise.race([promise, timeoutPromise]);
}

// ---------------------------------------------------------------------------
// SOLUTION: Retry with exponential backoff
// ---------------------------------------------------------------------------

/**
 * Retries `fn` up to `maxAttempts` times with exponential backoff.
 *
 * Delay sequence (baseDelayMs=500): 500ms, 1000ms, 2000ms...
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3,
  baseDelayMs = 500
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (attempt < maxAttempts - 1) {
        // Exponential backoff: 500ms, 1s, 2s, 4s...
        const delay = baseDelayMs * Math.pow(2, attempt);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw lastError;
}

// ---------------------------------------------------------------------------
// SOLUTION: ToolOrchestrator
// ---------------------------------------------------------------------------

export interface OrchestratorConfig {
  toolTimeoutMs?: number;
  maxRetries?: number;
  verbose?: boolean;
}

export class ToolOrchestrator {
  private registry: ToolRegistry;
  private config: Required<OrchestratorConfig>;
  private executionLog: ExecutionRecord[] = [];

  constructor(registry: ToolRegistry, config: OrchestratorConfig = {}) {
    this.registry = registry;
    this.config = {
      toolTimeoutMs: config.toolTimeoutMs ?? 10_000,
      maxRetries: config.maxRetries ?? 2,
      verbose: config.verbose ?? false,
    };
  }

  async execute(toolCall: ToolCall): Promise<ToolResultMessage> {
    const name = toolCall.function.name;
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    // --- Step 1: Parse arguments ---
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(toolCall.function.arguments);
    } catch {
      return this.errorResult(toolCall.id, name, {}, startedAt, startMs,
        `Could not parse arguments JSON: ${toolCall.function.arguments}`);
    }

    // --- Step 2: Look up tool definition ---
    const definitions = this.registry.getDefinitions();
    const definition = definitions.find((d) => d.function.name === name);
    if (!definition) {
      return this.errorResult(toolCall.id, name, args, startedAt, startMs,
        `Unknown tool: "${name}". Available: ${definitions.map((d) => d.function.name).join(", ")}`);
    }

    // --- Step 3: Validate arguments ---
    const validation = validateArguments(definition, args);
    if (!validation.valid) {
      return this.errorResult(toolCall.id, name, args, startedAt, startMs,
        `Validation failed: ${validation.errors!.join("; ")}`);
    }

    if (this.config.verbose) {
      console.log(`[Orchestrator] Executing "${name}"`, args);
    }

    // --- Step 4: Execute with retry + timeout ---
    try {
      const result = await withRetry(
        // Factory function — creates a new promise on each retry attempt.
        () => withTimeout(
          this.registry.execute(name, args),
          this.config.toolTimeoutMs,
          name
        ),
        this.config.maxRetries
      );

      const record: ExecutionRecord = {
        callId: toolCall.id,
        toolName: name,
        arguments: args,
        startedAt,
        finishedAt: new Date().toISOString(),
        durationMs: Date.now() - startMs,
        status: "success",
        result,
      };
      this.executionLog.push(record);

      if (this.config.verbose) {
        console.log(`[Orchestrator] "${name}" succeeded in ${record.durationMs}ms`);
      }

      return { role: "tool", tool_call_id: toolCall.id, content: result };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      return this.errorResult(toolCall.id, name, args, startedAt, startMs, errorMsg);
    }
  }

  async executeAll(toolCalls: ToolCall[]): Promise<ToolResultMessage[]> {
    // Parallel execution — all tools fire simultaneously.
    return Promise.all(toolCalls.map((tc) => this.execute(tc)));
  }

  getExecutionLog(): ExecutionRecord[] {
    return [...this.executionLog];
  }

  getErrors(): ExecutionRecord[] {
    return this.executionLog.filter((r) => r.status === "error");
  }

  /** Internal helper to build an error result + log entry. */
  private errorResult(
    callId: string,
    toolName: string,
    args: Record<string, unknown>,
    startedAt: string,
    startMs: number,
    error: string
  ): ToolResultMessage {
    const record: ExecutionRecord = {
      callId,
      toolName,
      arguments: args,
      startedAt,
      finishedAt: new Date().toISOString(),
      durationMs: Date.now() - startMs,
      status: "error",
      error,
    };
    this.executionLog.push(record);

    if (this.config.verbose) {
      console.error(`[Orchestrator] "${toolName}" failed: ${error}`);
    }

    return {
      role: "tool",
      tool_call_id: callId,
      content: `Error: ${error}`,
    };
  }
}
