import type { ClawDB } from 'axonio';
import { createClawDBAgentTools } from '../tools/index.js';
import { ClawDBToolHandler } from '../handlers/index.js';

/**
 * A minimal representation of an OpenAI Agents SDK Agent for duck-typing.
 * The real type comes from `openai/agents` — we use an interface to avoid a hard dep.
 */
export interface Agent {
  tools?: unknown[];
  instructions?: string;
  run?: (input: string, ...rest: unknown[]) => Promise<unknown>;
  [key: string]: unknown;
}

/**
 * Higher-order function that wraps an OpenAI Agents runner with automatic
 * ClawDB memory persistence.
 *
 * - Adds clawdb tools to the agent's tool list.
 * - Returns an agent proxy that routes clawdb_* tool calls through ClawDBToolHandler.
 *
 * @example
 * ```ts
 * const myAgent = new Agent({ model: "gpt-4o", tools: [myOtherTool] });
 * const memAgent = withClawDBMemory(myAgent, db);
 * const result = await run(memAgent, "What do you remember about the project?");
 * ```
 */
export function withClawDBMemory(runner: Agent, client: ClawDB): Agent {
  const clawdbTools = createClawDBAgentTools(client, { enableBranching: true });
  const handler = new ClawDBToolHandler(client);

  const existingTools = Array.isArray(runner.tools) ? runner.tools : [];
  const existingInstructions = typeof runner.instructions === 'string' ? runner.instructions : '';

  return new Proxy(runner, {
    get(target, prop) {
      if (prop === 'tools') {
        return [...existingTools, ...clawdbTools];
      }

      if (prop === 'run') {
        const original = target.run;
        if (typeof original !== 'function') {
          return undefined;
        }
        return async (input: string, ...rest: unknown[]) => {
          const contextHits = await client.search(input, { topK: 5, semantic: true });
          const memoryContext = contextHits.length > 0
            ? `Relevant long-term memory:\n${contextHits.map((h, i) => `${i + 1}. ${h.content}`).join('\n')}`
            : '';
          const nextInstructions = [existingInstructions, memoryContext].filter(Boolean).join('\n\n');

          const previousInstructions = target.instructions;
          target.instructions = nextInstructions;
          try {
            const output = await original.call(target, input, ...rest);
            const assistantText = typeof output === 'string' ? output : JSON.stringify(output);
            await client.rememberTyped(input, { type: 'message', tags: ['role:user'] });
            await client.rememberTyped(assistantText, { type: 'message', tags: ['role:assistant'] });
            return output;
          } finally {
            target.instructions = previousInstructions;
          }
        };
      }

      if (prop === '__clawdbHandler') {
        return handler;
      }

      const val = target[prop as string];
      return typeof val === 'function' ? val.bind(target) : val;
    },
  });
}
