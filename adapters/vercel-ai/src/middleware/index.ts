import type { ClawDB } from 'axonio';

export interface LanguageModelMiddleware {
  transformParams?: (params: Record<string, unknown>) => Promise<Record<string, unknown>>;
  wrapGenerate?: (options: {
    doGenerate: () => Promise<unknown>;
    params: Record<string, unknown>;
  }) => Promise<unknown>;
  wrapStream?: (options: {
    doStream: () => Promise<unknown>;
    params: Record<string, unknown>;
  }) => Promise<unknown>;
}

function extractLastUserMessage(params: Record<string, unknown>): string {
  const messages = params['messages'];
  if (!Array.isArray(messages)) return '';
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const item = messages[i] as Record<string, unknown>;
    if (item?.['role'] === 'user') {
      const content = item['content'];
      if (typeof content === 'string') return content;
    }
  }
  return '';
}

export function clawdbMiddleware(client: ClawDB): LanguageModelMiddleware {
  return {
    async transformParams(params) {
      const userMessage = extractLastUserMessage(params);
      if (!userMessage) {
        return params;
      }

      const hits = await client.search(userMessage, { topK: 5, semantic: true });
      if (hits.length === 0) {
        return params;
      }

      const memoryBlock = {
        role: 'system',
        content: `Relevant memory:\n${hits.map((hit, i) => `${i + 1}. ${hit.content}`).join('\n')}`
      };

      const messages = Array.isArray(params['messages']) ? (params['messages'] as unknown[]) : [];
      return {
        ...params,
        messages: [memoryBlock, ...messages]
      };
    },

    async wrapGenerate({ doGenerate, params }) {
      const result = await doGenerate();
      const userMessage = extractLastUserMessage(params);
      const assistantMessage = typeof (result as { text?: unknown })?.text === 'string'
        ? String((result as { text: string }).text)
        : '';

      if (userMessage) {
        await client.rememberTyped(userMessage, { type: 'message', tags: ['role:user'] });
      }
      if (assistantMessage) {
        await client.rememberTyped(assistantMessage, { type: 'message', tags: ['role:assistant'] });
      }

      return result;
    },

    async wrapStream({ doStream, params }) {
      const streamResult = await doStream();
      const userMessage = extractLastUserMessage(params);
      if (userMessage) {
        await client.rememberTyped(userMessage, { type: 'message', tags: ['role:user'] });
      }
      return streamResult;
    }
  };
}
