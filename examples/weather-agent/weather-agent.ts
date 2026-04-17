/**
 * EXAMPLE: Weather Agent
 * ======================
 *
 * A fully working agent that answers weather questions using two tools:
 *   1. get_current_weather  — fetches mock current conditions
 *   2. get_weather_forecast — fetches a multi-day mock forecast
 *
 * This example demonstrates:
 *   - End-to-end tool calling: from user question to final answer
 *   - Parallel tool calls: the LLM can call both tools in one response
 *   - Tool chaining: the LLM may call forecast AFTER checking current conditions
 *   - The ToolRegistry + runAgent pattern from modules 1–2
 *
 * NOTE ON THE MOCK API:
 * The weather data here is generated locally (no real API key needed).
 * In production you'd replace getMockWeather/getMockForecast with calls to
 * OpenWeatherMap, WeatherAPI, or similar.
 *
 * RUN: npx ts-node examples/weather-agent/weather-agent.ts
 * OR:  npm run example:weather
 */

import * as dotenv from "dotenv";
dotenv.config(); // Load OPENAI_API_KEY from .env

import { AgentConfig } from "../../shared/types";
import { buildTool, ToolRegistry } from "../../solutions/01-tool-schema/tool-schema";
import { runAgent } from "../../solutions/02-reasoning-loop/reasoning-loop";

// ---------------------------------------------------------------------------
// Mock weather data generators
// (Replace these with real API calls for a production agent)
// ---------------------------------------------------------------------------

/** Simulated weather conditions for demonstration purposes. */
interface WeatherConditions {
  location: string;
  temperature: number;
  unit: string;
  conditions: string;
  humidity: number;
  windSpeedKph: number;
  feelsLike: number;
}

interface ForecastDay {
  date: string;
  high: number;
  low: number;
  conditions: string;
  precipitationChance: number;
}

/**
 * Returns mock current weather for any city.
 * Real implementation: GET https://api.openweathermap.org/data/2.5/weather?q={city}
 */
function getMockWeather(location: string, unit: string): WeatherConditions {
  // Deterministic "randomness" based on city name length — reproducible for demos.
  const seed = location.length;
  const baseTemp = 15 + (seed % 20); // 15°C to 35°C range
  const temp = unit === "fahrenheit" ? Math.round(baseTemp * 9 / 5 + 32) : baseTemp;
  const feelsLike = unit === "fahrenheit" ? temp - 3 : baseTemp - 2;

  const conditionsList = ["Sunny", "Partly Cloudy", "Overcast", "Light Rain", "Clear"];
  const conditions = conditionsList[seed % conditionsList.length];

  return {
    location,
    temperature: temp,
    unit: unit === "fahrenheit" ? "°F" : "°C",
    conditions,
    humidity: 40 + (seed % 40),
    windSpeedKph: 5 + (seed % 25),
    feelsLike,
  };
}

/**
 * Returns a mock 5-day forecast.
 * Real implementation: GET https://api.openweathermap.org/data/2.5/forecast?q={city}
 */
function getMockForecast(location: string, days: number): ForecastDay[] {
  const seed = location.length;
  const conditionsList = ["Sunny", "Partly Cloudy", "Rainy", "Thunderstorms", "Clear", "Overcast"];

  return Array.from({ length: days }, (_, i) => {
    const date = new Date();
    date.setDate(date.getDate() + i + 1);
    return {
      date: date.toISOString().split("T")[0], // YYYY-MM-DD
      high: 18 + ((seed + i * 3) % 15),
      low: 10 + ((seed + i) % 8),
      conditions: conditionsList[(seed + i) % conditionsList.length],
      precipitationChance: (seed * 7 + i * 13) % 100,
    };
  });
}

// ---------------------------------------------------------------------------
// Tool definitions + handlers
// ---------------------------------------------------------------------------

/**
 * Tool 1: Get current weather conditions for a city.
 *
 * Notice how the description guides the LLM to use this for "right now"
 * questions, while the forecast tool is for future planning.
 */
const currentWeatherTool = buildTool({
  name: "get_current_weather",
  description:
    "Get the current weather conditions for a specific city. " +
    "Use this when the user asks about current temperature, today's weather, " +
    "or whether it's raining/sunny right now.",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: 'City name, optionally with country code. Example: "Paris, France" or "Tokyo".',
      },
      unit: {
        type: "string",
        enum: ["celsius", "fahrenheit"],
        description: 'Temperature unit. Default to "celsius" unless user specifies.',
      },
    },
    required: ["location"],
  },
  handler: async ({ location, unit }) => {
    // Simulate API latency.
    await new Promise((r) => setTimeout(r, 100));

    const weather = getMockWeather(
      location as string,
      (unit as string) ?? "celsius"
    );

    // Return as a formatted string — the LLM can read this and extract facts.
    return JSON.stringify(weather, null, 2);
  },
});

/**
 * Tool 2: Get a multi-day weather forecast.
 *
 * The LLM will choose this tool when the user asks about "tomorrow", "this week",
 * or "the next few days".
 */
const forecastTool = buildTool({
  name: "get_weather_forecast",
  description:
    "Get the weather forecast for the next 1–7 days for a city. " +
    "Use this when the user asks about future weather: tomorrow, this week, " +
    "weekend plans, or travel planning.",
  parameters: {
    type: "object",
    properties: {
      location: {
        type: "string",
        description: 'City name or "City, Country". Example: "Berlin, Germany".',
      },
      days: {
        type: "number",
        description: "Number of forecast days to return. Min 1, max 7. Default 3.",
      },
    },
    required: ["location"],
  },
  handler: async ({ location, days }) => {
    await new Promise((r) => setTimeout(r, 150));

    const numDays = Math.min(Math.max(1, (days as number) ?? 3), 7);
    const forecast = getMockForecast(location as string, numDays);

    return JSON.stringify({ location, forecast }, null, 2);
  },
});

// ---------------------------------------------------------------------------
// Build the registry and run the agent
// ---------------------------------------------------------------------------

async function main() {
  const registry = new ToolRegistry();
  registry.register(currentWeatherTool.definition, currentWeatherTool.handler);
  registry.register(forecastTool.definition, forecastTool.handler);

  const config: AgentConfig = {
    model: process.env.OPENAI_MODEL ?? "gpt-4o",
    systemPrompt: `You are a helpful weather assistant.
When answering weather questions:
- Always use the tools to get real data — don't guess temperatures.
- Present temperatures in a friendly, readable format.
- Mention relevant details like humidity or wind if they're noteworthy.
- For travel questions, compare the weather at both origin and destination.`,
    tools: registry.getDefinitions(),
    maxIterations: 5,
    verbose: true,
  };

  // Test prompts — each demonstrates a different tool-calling pattern.
  const prompts = [
    // Single tool call
    "What's the weather like in London right now?",
    // Parallel tool calls (LLM should call both in one response)
    "Compare the weather in Tokyo and Sydney today.",
    // Multi-step: current + forecast
    "I'm visiting Barcelona next week. What's the weather like there now, and what should I expect for the next 5 days?",
  ];

  for (const prompt of prompts) {
    console.log("\n" + "=".repeat(70));
    console.log("USER:", prompt);
    console.log("=".repeat(70));

    const result = await runAgent(prompt, config, registry);

    console.log("\nFINAL ANSWER:\n", result.answer);
    console.log(`\n[Stats] ${result.iterations} LLM call(s), ${result.toolCallsMade.length} tool call(s)`);
  }
}

main().catch(console.error);
