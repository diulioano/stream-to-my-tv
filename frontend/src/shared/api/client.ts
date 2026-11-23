import { z } from "zod";
import { apiUrl } from "./baseUrl";

export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

const errorBodySchema = z.object({
  error: z.string().optional(),
  message: z.string().optional(),
  detail: z.string().optional()
});

async function readJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function errorMessage(status: number, body: unknown): string {
  const parsed = errorBodySchema.safeParse(body);
  if (parsed.success) {
    const message = parsed.data.error ?? parsed.data.message ?? parsed.data.detail;
    if (message) return message;
  }
  return `HTTP ${status}`;
}

export async function requestJson<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const response = await fetch(apiUrl(path), init);
  const body = await readJson(response);
  if (!response.ok) throw new ApiError(response.status, errorMessage(response.status, body));
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(response.status, `Resposta inválida de ${path}: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export function getJson<T>(path: string, schema: z.ZodType<T>): Promise<T> {
  return requestJson(path, schema);
}

export function postJson<T>(path: string, schema: z.ZodType<T>, body: unknown = {}): Promise<T> {
  return requestJson(path, schema, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
}

export function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
