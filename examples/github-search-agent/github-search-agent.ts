/**
 * EXAMPLE: GitHub File Search Agent
 * ==================================
 *
 * An agent that searches GitHub repositories and reads file contents
 * to answer questions about codebases.
 *
 * Tools:
 *   1. search_github_code  — searches code across GitHub using the search API
 *   2. get_file_contents   — fetches the raw content of a specific file
 *   3. list_repo_files     — lists files in a repository path (like `ls`)
 *
 * This example demonstrates:
 *   - Tool chaining: agent searches → finds a file path → reads the file
 *   - Multi-step reasoning: the LLM decides WHAT to search for and HOW to use results
 *   - Error handling: graceful fallback when API calls fail or repos are private
 *   - State persistence integration: each conversation is saved to a thread
 *
 * SETUP:
 *   1. Copy .env.example to .env
 *   2. Add GITHUB_TOKEN=ghp_... (personal access token with `repo` scope)
 *      Without a token, GitHub API has a 60 req/hour rate limit (usually enough for demos).
 *   3. Add MISTRAL_API_KEY=...
 *
 * RUN: npx ts-node examples/github-search-agent/github-search-agent.ts
 * OR:  npm run example:github
 */

import * as dotenv from "dotenv";
dotenv.config();

import { AgentConfig } from "../../shared/types";
import { buildTool, ToolRegistry } from "../../solutions/01-tool-schema/tool-schema";
import { InMemoryThreadStore, runTurn } from "../../solutions/04-state-persistence/state-persistence";

// ---------------------------------------------------------------------------
// GitHub API helpers
// ---------------------------------------------------------------------------

const GITHUB_API = "https://api.github.com";

/** Build headers for GitHub API requests. */
function githubHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github.v3+json",
    "User-Agent": "tool-calling-workshop",
  };
  // Token dramatically raises rate limits and enables access to private repos.
  if (process.env.GITHUB_TOKEN) {
    headers["Authorization"] = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

/** Fetches JSON from the GitHub API. Throws on non-2xx status. */
async function githubFetch<T>(endpoint: string): Promise<T> {
  const url = endpoint.startsWith("http") ? endpoint : `${GITHUB_API}${endpoint}`;
  const response = await fetch(url, { headers: githubHeaders() });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`GitHub API error ${response.status}: ${body}`);
  }

  return response.json() as Promise<T>;
}

// ---------------------------------------------------------------------------
// Tool 1: Search GitHub code
// ---------------------------------------------------------------------------

const searchCodeTool = buildTool({
  name: "search_github_code",
  description:
    "Search for code across GitHub repositories using GitHub's code search. " +
    "Use this to find which files contain a specific function, class, pattern, or string. " +
    "Returns file paths, repository names, and a snippet of matching code.",
  parameters: {
    type: "object",
    properties: {
      query: {
        type: "string",
        description:
          "GitHub code search query. Supports qualifiers like:\n" +
          '  - "language:typescript" to filter by language\n' +
          '  - "repo:owner/name" to search within a repo\n' +
          '  - "filename:package.json" to search specific file types\n' +
          'Example: "useState hook language:typescript repo:facebook/react"',
      },
      perPage: {
        type: "number",
        description: "Number of results to return (1–30). Default 5.",
      },
    },
    required: ["query"],
  },
  handler: async ({ query, perPage }) => {
    const limit = Math.min(Math.max(1, (perPage as number) ?? 5), 30);
    const encoded = encodeURIComponent(query as string);

    interface SearchResult {
      total_count: number;
      items: Array<{
        name: string;
        path: string;
        repository: { full_name: string };
        html_url: string;
      }>;
    }

    const data = await githubFetch<SearchResult>(
      `/search/code?q=${encoded}&per_page=${limit}`
    );

    if (data.items.length === 0) {
      return `No results found for query: "${query}"`;
    }

    // Return a concise summary — not the full API response.
    const results = data.items.map((item) => ({
      file: item.name,
      path: item.path,
      repo: item.repository.full_name,
      url: item.html_url,
    }));

    return JSON.stringify(
      { totalResults: data.total_count, shown: results.length, results },
      null,
      2
    );
  },
});

// ---------------------------------------------------------------------------
// Tool 2: Get file contents
// ---------------------------------------------------------------------------

const getFileTool = buildTool({
  name: "get_file_contents",
  description:
    "Fetches the raw text content of a specific file from a GitHub repository. " +
    "Use this after finding a file path with search_github_code to read its contents. " +
    "Works on public repos; private repos require GITHUB_TOKEN.",
  parameters: {
    type: "object",
    properties: {
      owner: {
        type: "string",
        description: 'GitHub username or organization. Example: "microsoft"',
      },
      repo: {
        type: "string",
        description: 'Repository name (without owner). Example: "TypeScript"',
      },
      path: {
        type: "string",
        description: 'File path within the repository. Example: "src/compiler/checker.ts"',
      },
      ref: {
        type: "string",
        description: 'Branch, tag, or commit SHA. Default: the repo\'s default branch.',
      },
    },
    required: ["owner", "repo", "path"],
  },
  handler: async ({ owner, repo, path: filePath, ref }) => {
    interface FileContent {
      type: string;
      encoding: string;
      content: string;
      size: number;
      name: string;
    }

    let endpoint = `/repos/${owner}/${repo}/contents/${filePath}`;
    if (ref) endpoint += `?ref=${ref}`;

    const data = await githubFetch<FileContent>(endpoint);

    if (data.type !== "file") {
      return `"${filePath}" is not a file (it's a ${data.type}). Use list_repo_files to browse directories.`;
    }

    // GitHub returns file content as base64 — decode it.
    const decoded = Buffer.from(data.content, "base64").toString("utf8");

    // Truncate very large files to avoid exceeding token limits.
    const maxChars = 8_000;
    const truncated = decoded.length > maxChars;
    const content = truncated
      ? decoded.slice(0, maxChars) + `\n\n[... truncated at ${maxChars} chars. File is ${data.size} bytes total]`
      : decoded;

    return `File: ${owner}/${repo}/${filePath} (${data.size} bytes)\n\n${content}`;
  },
});

// ---------------------------------------------------------------------------
// Tool 3: List repository files
// ---------------------------------------------------------------------------

const listFilesTool = buildTool({
  name: "list_repo_files",
  description:
    "Lists files and directories at a specific path in a GitHub repository. " +
    "Use this to explore repository structure before reading specific files. " +
    'Similar to running "ls" in a directory.',
  parameters: {
    type: "object",
    properties: {
      owner: {
        type: "string",
        description: 'GitHub username or organization.',
      },
      repo: {
        type: "string",
        description: 'Repository name.',
      },
      path: {
        type: "string",
        description: 'Directory path to list. Use "" or "/" for the root.',
      },
    },
    required: ["owner", "repo"],
  },
  handler: async ({ owner, repo, path: dirPath }) => {
    const cleanPath = (dirPath as string | undefined) ?? "";
    const endpoint = cleanPath
      ? `/repos/${owner}/${repo}/contents/${cleanPath}`
      : `/repos/${owner}/${repo}/contents`;

    interface ContentItem {
      name: string;
      path: string;
      type: "file" | "dir" | "symlink" | "submodule";
      size: number;
    }

    const items = await githubFetch<ContentItem[]>(endpoint);

    if (!Array.isArray(items)) {
      return `"${cleanPath}" is a file, not a directory. Use get_file_contents to read it.`;
    }

    const formatted = items.map((item) => ({
      name: item.name,
      type: item.type,
      size: item.type === "file" ? `${item.size} bytes` : null,
    }));

    return JSON.stringify(
      { repo: `${owner}/${repo}`, path: cleanPath || "/", entries: formatted },
      null,
      2
    );
  },
});

// ---------------------------------------------------------------------------
// Build the agent
// ---------------------------------------------------------------------------

async function main() {
  const registry = new ToolRegistry();
  registry.register(searchCodeTool.definition, searchCodeTool.handler);
  registry.register(getFileTool.definition, getFileTool.handler);
  registry.register(listFilesTool.definition, listFilesTool.handler);

  const config: AgentConfig = {
    model: process.env.MISTRAL_MODEL ?? "mistral-small-latest",
    systemPrompt: `You are a senior developer assistant specialized in exploring codebases on GitHub.

When asked to find or explain code:
1. Start with search_github_code to locate relevant files.
2. Use get_file_contents to read specific files in detail.
3. Use list_repo_files to understand directory structure if needed.
4. Always cite the exact file path and repository in your answer.
5. If a file is large, focus on the most relevant sections.

Be concise but precise — developers care about accuracy over verbosity.`,
    tools: registry.getDefinitions(),
    maxIterations: 8, // More iterations needed for search → read → synthesize chains
    verbose: true,
  };

  // Use a thread store so multi-turn conversations remember prior context.
  const store = new InMemoryThreadStore();
  let currentThreadId: string | null = null;

  console.log("GitHub Code Search Agent");
  console.log("========================\n");

  // Demonstration conversation — multi-turn, with context carryover.
  const turns = [
    // Turn 1: broad question — agent will search and read
    "In the microsoft/vscode repository, how is the command palette implemented? Which file should I look at?",
    // Turn 2: follow-up using context from Turn 1
    "Can you show me a snippet of the actual implementation code from that file?",
  ];

  for (const userInput of turns) {
    console.log("\n" + "=".repeat(70));
    console.log("USER:", userInput);
    console.log("=".repeat(70));

    const result = await runTurn(currentThreadId, userInput, config, registry, store);
    currentThreadId = result.threadId; // Carry thread across turns.

    console.log("\nAGENT:", result.answer);
    console.log(`\n[Thread: ${currentThreadId}]`);
  }
}

main().catch(console.error);
