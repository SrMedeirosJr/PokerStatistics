import type {
  CustomRange,
  CustomRangeInput,
  EquityResponse,
  ImportResult,
  LookupResponse,
  ParsedRange,
  RangeResponse,
  SpotQuery,
  SpotsResponse,
} from '../types.ts'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(path, init)
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ApiError(0, 'Não foi possível conectar à API. O backend está rodando?')
  }
  if (!response.ok) {
    // A API sempre responde erros como {"detail": "<mensagem em português>"}.
    const body: unknown = await response.json().catch(() => null)
    const detail =
      body && typeof body === 'object' && 'detail' in body && typeof body.detail === 'string'
        ? body.detail
        : `A API respondeu com erro ${response.status}.`
    throw new ApiError(response.status, detail)
  }
  if (response.status === 204) return null as T
  return (await response.json()) as T
}

function spotParams(query: SpotQuery): URLSearchParams {
  const params = new URLSearchParams({
    players: String(query.players),
    position: query.position,
    scenario: query.scenario,
  })
  for (const [key, value] of Object.entries(query.stack)) params.set(key, String(value))
  return params
}

export interface HealthResponse {
  status: string
}

export function getHealth(signal?: AbortSignal): Promise<HealthResponse> {
  return request<HealthResponse>('/api/health', { signal })
}

export function getSpots(signal?: AbortSignal): Promise<SpotsResponse> {
  return request<SpotsResponse>('/api/spots', { signal })
}

export function getRange(query: SpotQuery, signal?: AbortSignal): Promise<RangeResponse> {
  return request<RangeResponse>(`/api/ranges?${spotParams(query)}`, { signal })
}

export function lookupHand(
  query: SpotQuery,
  hand: string,
  signal?: AbortSignal,
): Promise<LookupResponse> {
  const params = spotParams(query)
  params.set('hand', hand)
  return request<LookupResponse>(`/api/lookup?${params}`, { signal })
}

export interface EquityRequest {
  hero: string
  villain_range: string
  board?: string[]
  iterations?: number
  seed?: number
}

function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return request<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })
}

export function postEquity(body: EquityRequest, signal?: AbortSignal): Promise<EquityResponse> {
  return postJson<EquityResponse>('/api/equity', body, signal)
}

/** Expande uma string de range ('22+,A2s+,KTo+:0.5') nas classes que ela cobre. */
export function parseRangeText(text: string): Promise<ParsedRange> {
  return postJson<ParsedRange>('/api/ranges/parse', { text })
}

export const CUSTOM_RANGES_EXPORT_URL = '/api/custom-ranges/export'

export function listCustomRanges(signal?: AbortSignal): Promise<CustomRange[]> {
  return request<CustomRange[]>('/api/custom-ranges', { signal })
}

/** Grava o range do spot; se já existir um para o mesmo spot, ele é substituído. */
export function saveCustomRange(body: CustomRangeInput): Promise<CustomRange> {
  return postJson<CustomRange>('/api/custom-ranges', body)
}

export async function deleteCustomRange(id: number): Promise<void> {
  await request<null>(`/api/custom-ranges/${id}`, { method: 'DELETE' })
}

/** Importa um JSON exportado por `CUSTOM_RANGES_EXPORT_URL`. */
export function importCustomRanges(document: unknown): Promise<ImportResult> {
  return postJson<ImportResult>('/api/custom-ranges/import', document)
}
