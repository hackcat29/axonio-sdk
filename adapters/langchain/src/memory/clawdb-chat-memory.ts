import type { ClawDB } from 'axonio';
import { BaseChatMessageHistory } from '@langchain/core/chat_history';
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages';

const SESSION_TAG_PREFIX = 'session:';
const MSG_MEMORY_TYPE = 'message' as const;

/**
 * LangChain BaseChatMessageHistory-compatible implementation backed by ClawDB.
 *
 * Each message is stored as a ClawDB memory record tagged with the session ID.
 *
 * @example
 * ```ts
 * const history = new ClawDBChatMessageHistory({ client: db, sessionId: "chat-123" });
 * await history.addMessage(new HumanMessage("Hello!"));
 * const messages = await history.getMessages();
 * ```
 */
export class ClawDBChatMessageHistory extends BaseChatMessageHistory {
  readonly lc_namespace = ['clawdb', 'chat_histories'];

  private readonly client: ClawDB;
  private readonly sessionId: string;
  private readonly maxMessages: number;

  constructor(fields: { client: ClawDB; sessionId: string; maxMessages?: number }) {
    super(fields);
    this.client = fields.client;
    this.sessionId = fields.sessionId;
    this.maxMessages = fields.maxMessages ?? 100;
  }

  /** Returns all messages for this session in chronological order. */
  async getMessages(): Promise<BaseMessage[]> {
    const page = await this.client.listMemories({
      type: MSG_MEMORY_TYPE,
      limit: this.maxMessages,
    });

    const sessionTag = `${SESSION_TAG_PREFIX}${this.sessionId}`;
    return page
      .filter(m => m.tags.includes(sessionTag))
      .map(m => {
        const role = m.tags.includes('ai') ? 'ai' : 'human';
        return role === 'ai' ? new AIMessage(m.content) : new HumanMessage(m.content);
      });
  }

  /** Stores a message as a ClawDB memory record. */
  async addMessage(message: BaseMessage): Promise<void> {
    const role = message._getType() === 'ai' ? 'ai' : 'human';
    const content = typeof message.content === 'string'
      ? message.content
      : JSON.stringify(message.content);

    await this.client.rememberTyped(content, {
      type: MSG_MEMORY_TYPE,
      tags: [`${SESSION_TAG_PREFIX}${this.sessionId}`, role],
    });
  }

  /** Adds a human message. */
  async addUserMessage(message: string): Promise<void> {
    return this.addMessage(new HumanMessage(message));
  }

  /** Adds an AI message. */
  async addAIChatMessage(message: string): Promise<void> {
    return this.addMessage(new AIMessage(message));
  }

  /** Deletes all messages for this session. */
  async clear(): Promise<void> {
    const memories = await this.client.listMemories({
      type: MSG_MEMORY_TYPE,
      limit: 10_000,
    });
    const sessionTag = `${SESSION_TAG_PREFIX}${this.sessionId}`;
    await Promise.all(
      memories
        .filter(m => m.tags.includes(sessionTag))
        .map(m => this.client.deleteMemory(m.id))
    );
  }
}
