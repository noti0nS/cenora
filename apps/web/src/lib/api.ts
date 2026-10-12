export class RequestError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(path: string, options: RequestInit = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers: {
      ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      ...options.headers,
    },
  });
  const data = await res.json().catch(() => null);
  if (!res.ok)
    throw new RequestError(
      res.status,
      data?.error?.code || 'REQUEST_FAILED',
      data?.error?.message || 'Não foi possível concluir. Tente novamente.',
    );
  return data as T;
}
export const json = (method: string, data?: unknown): RequestInit => ({
  method,
  ...(data === undefined ? {} : { body: JSON.stringify(data) }),
});
export const score = (value: number | null | undefined) =>
  value == null
    ? '—'
    : value.toLocaleString('pt-BR', {
        maximumFractionDigits: 1,
        minimumFractionDigits: Number.isInteger(value) ? 0 : 1,
      });
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Algo deu errado. Tente novamente.';
}
