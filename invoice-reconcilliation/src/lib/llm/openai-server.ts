// High level: Wraps the OpenAI server client and requests strict structured JSON responses.
import "server-only";
import OpenAI from "openai";

type StructuredJsonRequest = {
  systemPrompt: string;
  userPrompt: string;
  schemaName: string;
  schema: Record<string, unknown>;
};

type StructuredJsonResponse =
  | {
      success: true;
      content: string;
      requestId?: string;
    }
  | {
      success: false;
      error: string;
    };

let cachedClient: OpenAI | null | undefined;

function getMatchingModel(): string {
  const configuredModel = process.env.OPENAI_MATCHING_MODEL?.trim();
  return configuredModel || "gpt-5.2";
}

function getOpenAIClient(): OpenAI | null {
  if (cachedClient !== undefined) {
    return cachedClient;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  cachedClient = apiKey
    ? new OpenAI({
        apiKey,
        maxRetries: 0,
        timeout: 20_000,
      })
    : null;

  return cachedClient;
}

function getStructuredResponseOverride(): string | null {
  if (process.env.NODE_ENV === "production") {
    return null;
  }

  const override = process.env.OPENAI_MATCHING_RESPONSE_OVERRIDE?.trim();
  return override ? override : null;
}

export async function createStructuredJsonResponse(
  input: StructuredJsonRequest
): Promise<StructuredJsonResponse> {
  const override = getStructuredResponseOverride();

  if (override) {
    return {
      success: true,
      content: override,
    };
  }

  const client = getOpenAIClient();

  if (!client) {
    return {
      success: false,
      error: "OPENAI_API_KEY is not configured.",
    };
  }

  try {
    const response = await client.responses.create({
      model: getMatchingModel(),
      instructions: input.systemPrompt,
      input: input.userPrompt,
      temperature: 0,
      max_output_tokens: 700,
      text: {
        format: {
          type: "json_schema",
          name: input.schemaName,
          strict: true,
          schema: input.schema,
        },
      },
    });

    const content = response.output_text.trim();

    if (!content) {
      return {
        success: false,
        error: "LLM returned an empty response.",
      };
    }

    return {
      success: true,
      content,
      requestId: response._request_id ?? undefined,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Unknown OpenAI server error";

    return {
      success: false,
      error: message,
    };
  }
}
