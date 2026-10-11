import type { JevMeaningPayload, JevMeaningResponse } from "../../shared/jev-search.js";

export class JevError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "JevError";
  }
}

export class JevClient {
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  async judge(payload: JevMeaningPayload, signal?: AbortSignal): Promise<JevMeaningResponse> {
    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/v1/systemone`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal,
      });
    } catch (error) {
      if (signal?.aborted) throw error;
      throw new JevError("JEV_UPSTREAM_UNAVAILABLE", "Jev search could not reach its judgment service.");
    }

    if (!response.ok) {
      try { await response.body?.cancel(); } catch { /* the response status is sufficient */ }
      const code = response.status === 401 || response.status === 403
        ? "JEV_UPSTREAM_AUTH"
        : `JEV_UPSTREAM_${response.status}`;
      throw new JevError(code, response.status === 401 || response.status === 403
        ? "Jev search authentication failed at its judgment service."
        : "Jev search judgment service returned an error.");
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new JevError("JEV_BAD_RESPONSE", "Jev search judgment service returned an invalid response.");
    }
    if (!isJevMeaningResponse(body)) {
      throw new JevError("JEV_BAD_RESPONSE", "Jev search judgment service returned an invalid response.");
    }
    return body;
  }
}

function isJevMeaningResponse(value: unknown): value is JevMeaningResponse {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const body = value as Record<string, unknown>;
  const usage = body["usage"];
  return typeof body["model"] === "string"
    && body["answers"] !== null
    && typeof body["answers"] === "object"
    && !Array.isArray(body["answers"])
    && !!usage
    && typeof usage === "object"
    && typeof (usage as Record<string, unknown>)["input_tokens"] === "number";
}
