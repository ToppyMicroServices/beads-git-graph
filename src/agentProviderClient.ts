import { type AgentProviderId } from "./agentProvider";

export const HUGGING_FACE_CHAT_COMPLETIONS_ENDPOINT =
  "https://router.huggingface.co/v1/chat/completions";
export const OPENAI_RESPONSES_ENDPOINT = "https://api.openai.com/v1/responses";
export const ANTHROPIC_MESSAGES_ENDPOINT = "https://api.anthropic.com/v1/messages";
const MAX_PROVIDER_RESPONSE_BYTES = 2 * 1024 * 1024;

export type TextResponseProviderId = Exclude<AgentProviderId, "copilot">;

export interface AgentProviderRequest {
  provider: TextResponseProviderId;
  model: string;
  prompt: string;
  apiKey?: string;
  ollamaBaseUrl?: string;
  maxOutputTokens: number;
  timeoutMs: number;
}

export interface AgentProviderResponse {
  provider: TextResponseProviderId;
  requestedModel: string;
  confirmedModel: string;
  text: string;
}

export type AgentProviderErrorCode =
  | "authentication"
  | "invalid-endpoint"
  | "model-not-found"
  | "provider-unavailable"
  | "rate-limited"
  | "timeout"
  | "unexpected-response";

export class AgentProviderError extends Error {
  constructor(
    public readonly code: AgentProviderErrorCode,
    message: string
  ) {
    super(message);
    this.name = "AgentProviderError";
  }
}

type FetchLike = typeof fetch;

function requireApiKey(provider: TextResponseProviderId, apiKey: string | undefined) {
  const normalized = apiKey?.trim();
  if (normalized) {
    return normalized;
  }
  throw new AgentProviderError(
    "authentication",
    `No credential is available for the ${provider} provider.`
  );
}

function isLoopbackHostname(hostname: string) {
  const normalized = hostname.toLowerCase();
  if (normalized === "localhost" || normalized === "[::1]" || normalized === "::1") {
    return true;
  }
  const ipv4 = normalized.match(/^127\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  return ipv4 !== null && ipv4.slice(1).every((part) => Number(part) <= 255);
}

export function normalizeOllamaBaseUrl(value: string | undefined) {
  const input = value?.trim() || "http://127.0.0.1:11434";
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new AgentProviderError(
      "invalid-endpoint",
      "Ollama endpoint must be a valid loopback HTTP or HTTPS URL."
    );
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !isLoopbackHostname(url.hostname) ||
    url.username !== "" ||
    url.password !== "" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new AgentProviderError(
      "invalid-endpoint",
      "Ollama endpoint must use HTTP or HTTPS on localhost or 127.0.0.0/8."
    );
  }
  url.pathname = url.pathname.replace(/\/+$/, "");
  return url.toString().replace(/\/$/, "");
}

function endpointFor(request: AgentProviderRequest) {
  switch (request.provider) {
    case "ollama":
      return `${normalizeOllamaBaseUrl(request.ollamaBaseUrl)}/api/chat`;
    case "huggingface":
      return HUGGING_FACE_CHAT_COMPLETIONS_ENDPOINT;
    case "openai":
      return OPENAI_RESPONSES_ENDPOINT;
    case "anthropic":
      return ANTHROPIC_MESSAGES_ENDPOINT;
  }
}

function requestInitFor(request: AgentProviderRequest, signal: AbortSignal): RequestInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  let body: Record<string, unknown>;

  switch (request.provider) {
    case "ollama":
      body = {
        model: request.model,
        messages: [{ role: "user", content: request.prompt }],
        stream: false
      };
      break;
    case "huggingface":
      headers.authorization = `Bearer ${requireApiKey(request.provider, request.apiKey)}`;
      body = {
        model: request.model,
        messages: [{ role: "user", content: request.prompt }],
        max_tokens: request.maxOutputTokens,
        stream: false
      };
      break;
    case "openai":
      headers.authorization = `Bearer ${requireApiKey(request.provider, request.apiKey)}`;
      body = {
        model: request.model,
        input: request.prompt,
        max_output_tokens: request.maxOutputTokens,
        store: false
      };
      break;
    case "anthropic":
      headers["x-api-key"] = requireApiKey(request.provider, request.apiKey);
      headers["anthropic-version"] = "2023-06-01";
      body = {
        model: request.model,
        max_tokens: request.maxOutputTokens,
        messages: [{ role: "user", content: request.prompt }]
      };
      break;
  }

  return {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
    redirect: "error"
  };
}

function statusError(status: number) {
  if (status === 401 || status === 403) {
    return new AgentProviderError(
      "authentication",
      "The provider rejected the configured credential."
    );
  }
  if (status === 404) {
    return new AgentProviderError(
      "model-not-found",
      "The provider endpoint or requested model was not found."
    );
  }
  if (status === 429) {
    return new AgentProviderError(
      "rate-limited",
      "The provider rate limit was reached. Try again later."
    );
  }
  return new AgentProviderError("provider-unavailable", "The provider did not accept the request.");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function readOllamaResponse(parsed: unknown) {
  const root = asRecord(parsed);
  const message = asRecord(root?.message);
  const text = message?.content;
  const model = root?.model;
  return {
    text: typeof text === "string" ? text.trim() : "",
    model: typeof model === "string" ? model.trim() : ""
  };
}

function readChatCompletionResponse(parsed: unknown) {
  const root = asRecord(parsed);
  const choice = Array.isArray(root?.choices) ? asRecord(root.choices[0]) : null;
  const message = asRecord(choice?.message);
  const text = message?.content;
  const model = root?.model;
  return {
    text: typeof text === "string" ? text.trim() : "",
    model: typeof model === "string" ? model.trim() : ""
  };
}

function readOpenAIResponse(parsed: unknown) {
  const root = asRecord(parsed);
  const model = root?.model;
  const texts: string[] = [];
  if (Array.isArray(root?.output)) {
    for (const outputItem of root.output) {
      const output = asRecord(outputItem);
      if (!Array.isArray(output?.content)) {
        continue;
      }
      for (const contentItem of output.content) {
        const content = asRecord(contentItem);
        if (content?.type === "output_text" && typeof content.text === "string") {
          texts.push(content.text);
        }
      }
    }
  }
  return {
    text: texts.join("\n").trim(),
    model: typeof model === "string" ? model.trim() : ""
  };
}

function readAnthropicResponse(parsed: unknown) {
  const root = asRecord(parsed);
  const model = root?.model;
  const texts = Array.isArray(root?.content)
    ? root.content.flatMap((item) => {
        const content = asRecord(item);
        return content?.type === "text" && typeof content.text === "string" ? [content.text] : [];
      })
    : [];
  return {
    text: texts.join("\n").trim(),
    model: typeof model === "string" ? model.trim() : ""
  };
}

function readProviderResponse(provider: TextResponseProviderId, parsed: unknown) {
  switch (provider) {
    case "ollama":
      return readOllamaResponse(parsed);
    case "huggingface":
      return readChatCompletionResponse(parsed);
    case "openai":
      return readOpenAIResponse(parsed);
    case "anthropic":
      return readAnthropicResponse(parsed);
  }
}

function redactCredential(value: string, credential: string | undefined) {
  const normalized = credential?.trim();
  return normalized ? value.split(normalized).join("[REDACTED]") : value;
}

function oversizedResponseError() {
  return new AgentProviderError(
    "unexpected-response",
    "The provider response exceeded the supported size limit."
  );
}

async function cancelOversizedResponse(
  controller: AbortController,
  cancelBody: () => Promise<void>
): Promise<never> {
  const cancellation = cancelBody();
  controller.abort();
  try {
    await cancellation;
  } catch {
    // The abort may make the underlying response stream reject its cancellation.
  }
  throw oversizedResponseError();
}

async function readResponseText(response: Response, controller: AbortController) {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_RESPONSE_BYTES) {
    return cancelOversizedResponse(controller, async () => {
      await response.body?.cancel();
    });
  }

  if (response.body === null) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const parts: string[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      byteLength += value.byteLength;
      if (byteLength > MAX_PROVIDER_RESPONSE_BYTES) {
        return cancelOversizedResponse(controller, () => reader.cancel());
      }
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    return parts.join("");
  } catch (error) {
    if (error instanceof AgentProviderError || controller.signal.aborted) {
      throw error;
    }
    throw new AgentProviderError("unexpected-response", "The provider response could not be read.");
  } finally {
    reader.releaseLock();
  }
}

export async function requestAgentProviderResponse(
  request: AgentProviderRequest,
  fetchImpl: FetchLike = fetch
): Promise<AgentProviderResponse> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeoutMs);
  try {
    const response = await fetchImpl(
      endpointFor(request),
      requestInitFor(request, controller.signal)
    );
    if (!response.ok) {
      throw statusError(response.status);
    }

    let responseText: string;
    try {
      responseText = await readResponseText(response, controller);
    } catch (error) {
      if (error instanceof AgentProviderError || controller.signal.aborted) {
        throw error;
      }
      throw new AgentProviderError(
        "unexpected-response",
        "The provider response could not be read."
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(responseText);
    } catch {
      throw new AgentProviderError(
        "unexpected-response",
        "The provider returned a response that was not valid JSON."
      );
    }
    const result = readProviderResponse(request.provider, parsed);
    if (result.text === "") {
      throw new AgentProviderError(
        "unexpected-response",
        "The provider response did not contain generated text."
      );
    }
    return {
      provider: request.provider,
      requestedModel: request.model,
      confirmedModel: redactCredential(result.model || request.model, request.apiKey),
      text: redactCredential(result.text, request.apiKey)
    };
  } catch (error) {
    if (error instanceof AgentProviderError) {
      throw error;
    }
    if (controller.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw new AgentProviderError("timeout", "The provider request timed out.");
    }
    throw new AgentProviderError("provider-unavailable", "The provider could not be reached.");
  } finally {
    clearTimeout(timeout);
  }
}
