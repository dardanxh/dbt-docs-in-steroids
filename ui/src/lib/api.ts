// Thin typed fetch wrapper. Paths are relative to the origin; Vite proxies /api
// to the backend in dev. Generated OpenAPI types live in api-types.gen.ts for
// reference and future codegen-driven clients.

const BASE = "/api/v1";

export function extractErrorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  if (err instanceof Error) return err.message;
  return "Something went wrong.";
}

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code?: string,
  ) {
    super(message);
  }
}

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = res.statusText;
    let code: string | undefined;
    try {
      const body = await res.json();
      code = body.code;
      message = typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail);
    } catch {
      /* non-JSON error body */
    }
    throw new ApiError(message, res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function apiGet<T>(path: string): Promise<T> {
  return handle<T>(await fetch(`${BASE}${path}`));
}

export async function apiPost<T>(path: string, body?: unknown): Promise<T> {
  return handle<T>(
    await fetch(`${BASE}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    }),
  );
}

export async function apiPostForm<T>(path: string, form: FormData): Promise<T> {
  return handle<T>(await fetch(`${BASE}${path}`, { method: "POST", body: form }));
}

export async function apiDelete(path: string): Promise<void> {
  await handle<void>(await fetch(`${BASE}${path}`, { method: "DELETE" }));
}
