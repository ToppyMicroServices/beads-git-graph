import { describe, expect, it, vi } from "vitest";

import {
  AgentProviderError,
  type AgentProviderRequest,
  ANTHROPIC_MESSAGES_ENDPOINT,
  HUGGING_FACE_CHAT_COMPLETIONS_ENDPOINT,
  normalizeOllamaBaseUrl,
  OPENAI_RESPONSES_ENDPOINT,
  requestAgentProviderResponse
} from "../src/agentProviderClient";

const baseRequest: Omit<AgentProviderRequest, "provider"> = {
  model: "selected-model",
  prompt: "Work on the task",
  apiKey: "secret-canary",
  maxOutputTokens: 321,
  timeoutMs: 1_000
};

function responseJson(value: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
    ...init
  });
}

describe("agent provider HTTP adapters", () => {
  it("calls local Ollama chat without credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      responseJson({ model: "local-confirmed", message: { content: "local answer" } })
    );

    const result = await requestAgentProviderResponse(
      {
        ...baseRequest,
        provider: "ollama",
        apiKey: undefined,
        ollamaBaseUrl: "http://localhost:11434/"
      },
      fetchMock
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://localhost:11434/api/chat");
    expect(init?.headers).toEqual({ "content-type": "application/json" });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "selected-model",
      messages: [{ role: "user", content: "Work on the task" }],
      stream: false
    });
    expect(result).toEqual({
      provider: "ollama",
      requestedModel: "selected-model",
      confirmedModel: "local-confirmed",
      text: "local answer"
    });
  });

  it("calls the Hugging Face OpenAI-compatible chat endpoint", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      responseJson({
        model: "hf-confirmed",
        choices: [{ message: { content: "HF answer" } }]
      })
    );

    await requestAgentProviderResponse({ ...baseRequest, provider: "huggingface" }, fetchMock);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(HUGGING_FACE_CHAT_COMPLETIONS_ENDPOINT);
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      authorization: "Bearer secret-canary"
    });
    expect(init?.redirect).toBe("error");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      model: "selected-model",
      max_tokens: 321,
      stream: false
    });
  });

  it("calls OpenAI Responses with server-side storage disabled", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      responseJson({
        model: "openai-confirmed",
        output: [
          {
            type: "message",
            content: [{ type: "output_text", text: "OpenAI answer secret-canary" }]
          }
        ]
      })
    );

    const result = await requestAgentProviderResponse(
      { ...baseRequest, provider: "openai" },
      fetchMock
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(OPENAI_RESPONSES_ENDPOINT);
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "selected-model",
      input: "Work on the task",
      max_output_tokens: 321,
      store: false
    });
    expect(result.text).toBe("OpenAI answer [REDACTED]");
    expect(JSON.stringify(result)).not.toContain("secret-canary");
  });

  it("calls Anthropic Messages with its required version header", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      responseJson({
        model: "claude-confirmed",
        content: [{ type: "text", text: "Claude answer" }]
      })
    );

    const result = await requestAgentProviderResponse(
      { ...baseRequest, provider: "anthropic" },
      fetchMock
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(ANTHROPIC_MESSAGES_ENDPOINT);
    expect(init?.headers).toEqual({
      "content-type": "application/json",
      "x-api-key": "secret-canary",
      "anthropic-version": "2023-06-01"
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      model: "selected-model",
      max_tokens: 321,
      messages: [{ role: "user", content: "Work on the task" }]
    });
    expect(result.text).toBe("Claude answer");
  });

  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [404, "model-not-found"],
    [429, "rate-limited"],
    [500, "provider-unavailable"]
  ] as const)("maps HTTP %s to a redacted %s error", async (status, code) => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      responseJson({ error: "secret-canary provider detail" }, { status })
    );

    const thrown = await requestAgentProviderResponse(
      { ...baseRequest, provider: "openai" },
      fetchMock
    ).catch((error: unknown) => error);
    expect(thrown).toBeInstanceOf(AgentProviderError);
    expect((thrown as AgentProviderError).code).toBe(code);
    expect(String(thrown)).not.toContain("secret-canary");
  });

  it("rejects malformed success responses without exposing raw data", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () =>
      responseJson({ output: [{ secret: "secret-canary" }] })
    );
    const thrown = await requestAgentProviderResponse(
      { ...baseRequest, provider: "openai" },
      fetchMock
    ).catch((error: unknown) => error);

    expect((thrown as AgentProviderError).code).toBe("unexpected-response");
    expect(String(thrown)).not.toContain("secret-canary");
  });

  it("rejects an oversized response before parsing it", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () =>
        new Response("{}", {
          status: 200,
          headers: { "content-length": String(2 * 1024 * 1024 + 1) }
        })
    );
    const thrown = await requestAgentProviderResponse(
      { ...baseRequest, provider: "openai" },
      fetchMock
    ).catch((error: unknown) => error);

    expect((thrown as AgentProviderError).code).toBe("unexpected-response");
    expect(String(thrown)).toContain("size limit");
  });

  it("cancels a chunked response that exceeds the size limit without Content-Length", async () => {
    const cancel = vi.fn();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(1024 * 1024));
        controller.enqueue(new Uint8Array(1024 * 1024 + 1));
      },
      cancel
    });
    let requestSignal: AbortSignal | null | undefined;
    const fetchMock = vi.fn<typeof fetch>(async (_url, init) => {
      requestSignal = init?.signal;
      const response = new Response(stream, {
        status: 200,
        headers: { "content-type": "application/json" }
      });
      expect(response.headers.get("content-length")).toBeNull();
      return response;
    });

    const thrown = await requestAgentProviderResponse(
      { ...baseRequest, provider: "openai" },
      fetchMock
    ).catch((error: unknown) => error);

    expect((thrown as AgentProviderError).code).toBe("unexpected-response");
    expect(String(thrown)).toContain("size limit");
    expect(cancel).toHaveBeenCalledOnce();
    expect(requestSignal?.aborted).toBe(true);
  });

  it("does not call a cloud provider without a credential", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const thrown = await requestAgentProviderResponse(
      { ...baseRequest, provider: "anthropic", apiKey: undefined },
      fetchMock
    ).catch((error: unknown) => error);

    expect((thrown as AgentProviderError).code).toBe("authentication");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts a provider request at the configured timeout", async () => {
    const fetchMock = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("aborted"), { name: "AbortError" }));
          });
        })
    );

    const thrown = await requestAgentProviderResponse(
      { ...baseRequest, provider: "openai", timeoutMs: 5 },
      fetchMock
    ).catch((error: unknown) => error);
    expect((thrown as AgentProviderError).code).toBe("timeout");
  });

  it("accepts only loopback Ollama endpoints", () => {
    expect(normalizeOllamaBaseUrl("http://127.12.34.56:11434/")).toBe("http://127.12.34.56:11434");
    expect(() => normalizeOllamaBaseUrl("https://example.com")).toThrow(
      "Ollama endpoint must use HTTP or HTTPS on localhost"
    );
    expect(() => normalizeOllamaBaseUrl("http://localhost:11434?redirect=1")).toThrow(
      "Ollama endpoint must use HTTP or HTTPS on localhost"
    );
  });
});
