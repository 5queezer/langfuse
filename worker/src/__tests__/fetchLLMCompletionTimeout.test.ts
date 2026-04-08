import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const invokeMock = vi.fn();
const chatVertexAIConstructorMock = vi.fn().mockImplementation(() => ({
  invoke: invokeMock,
}));
const VERTEXAI_USE_DEFAULT_CREDENTIALS = "__VERTEXAI_DEFAULT_CREDENTIALS__";

process.env.CLICKHOUSE_URL ??= "http://localhost:8123";
process.env.CLICKHOUSE_USER ??= "default";
process.env.CLICKHOUSE_PASSWORD ??= "password";
process.env.LANGFUSE_S3_EVENT_UPLOAD_BUCKET ??= "test-bucket";
process.env.ENCRYPTION_KEY ??=
  "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

vi.mock("@langchain/google-vertexai", () => ({
  ChatVertexAI: chatVertexAIConstructorMock,
}));

vi.mock("../../../packages/shared/src/server/llm/errors", () => ({
  LLMCompletionError: class MockLLMCompletionError extends Error {
    responseStatusCode: number;
    isRetryable: boolean;
    blockReason: null;

    constructor(params: {
      message: string;
      responseStatusCode?: number;
      isRetryable?: boolean;
    }) {
      super(params.message);
      this.name = "LLMCompletionError";
      this.responseStatusCode = params.responseStatusCode ?? 500;
      this.isRetryable = params.isRetryable ?? false;
      this.blockReason = null;
    }

    shouldBlockConfig() {
      return false;
    }

    getEvaluatorBlockReason() {
      return null;
    }
  },
}));

describe("fetchLLMCompletion runtime timeouts", () => {
  let originalTimeout: number;
  let env: typeof import("../../../packages/shared/src/env").env;
  let encrypt: typeof import("../../../packages/shared/src/encryption").encrypt;
  let fetchLLMCompletion: typeof import("../../../packages/shared/src/server/llm/fetchLLMCompletion").fetchLLMCompletion;

  beforeEach(async () => {
    vi.useFakeTimers();
    invokeMock.mockReset();
    chatVertexAIConstructorMock.mockClear();
    vi.resetModules();

    ({ env } = await import("../../../packages/shared/src/env"));
    ({ encrypt } = await import("../../../packages/shared/src/encryption"));
    ({ fetchLLMCompletion } =
      await import("../../../packages/shared/src/server/llm/fetchLLMCompletion"));

    originalTimeout = env.LANGFUSE_FETCH_LLM_COMPLETION_TIMEOUT_MS;
  });

  afterEach(() => {
    env.LANGFUSE_FETCH_LLM_COMPLETION_TIMEOUT_MS = originalTimeout;
    vi.useRealTimers();
  });

  it("times out VertexAI requests instead of hanging indefinitely", async () => {
    env.LANGFUSE_FETCH_LLM_COMPLETION_TIMEOUT_MS = 25;

    invokeMock.mockImplementation(() => new Promise(() => {}));

    const completionPromise = fetchLLMCompletion({
      streaming: false,
      messages: [
        {
          role: "user",
          content: "What is 2+2? Answer only with the number.",
          type: "public-api-created",
        },
      ],
      modelParams: {
        provider: "google-vertex-ai",
        adapter: "google-vertex-ai",
        model: "gemini-2.0-flash",
        temperature: 0,
        max_tokens: 10,
      },
      llmConnection: {
        secretKey: encrypt(VERTEXAI_USE_DEFAULT_CREDENTIALS),
        config: null,
      },
    });

    const completionRejection = expect(completionPromise).rejects.toThrow(
      "Request timed out after 25ms",
    );

    await vi.runOnlyPendingTimersAsync();
    await completionRejection;
  });
});
