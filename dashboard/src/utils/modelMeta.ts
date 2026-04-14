/**
 * modelMeta.ts — pure, side-effect-free utilities for ModelCard enrichment.
 * All functions are tested in modelMeta.test.ts.
 * No external dependencies — static maps only (per D-07).
 */

const PROVIDER_PREFIXES = [
  'openai/', 'ollama/', 'openrouter/', 'gemini/', 'perplexity/', 'anthropic/',
]

/** Strip leading provider prefix from a backend_model string. */
function stripPrefix(model: string): string {
  for (const p of PROVIDER_PREFIXES) {
    if (model.startsWith(p)) return model.slice(p.length)
  }
  return model
}

/**
 * extractSize — regex scan for NN[Bb] in the model slug.
 * Returns e.g. "35B", "7B", or "?" if nothing matches.
 */
export function extractSize(backendModel: string): string {
  const m = backendModel.match(/(\d+(?:\.\d+)?)[Bb]/)
  if (!m) return '?'
  return `${m[1]}B`
}

/**
 * isHfPath — true if stripping the provider prefix leaves an org/model slug.
 * Used to decide whether to render a HuggingFace link.
 */
export function isHfPath(backendModel: string): boolean {
  const remainder = stripPrefix(backendModel)
  return remainder.includes('/')
}

/**
 * hfUrl — returns the HuggingFace URL for the org/model path.
 * Caller must check isHfPath first.
 */
export function hfUrl(backendModel: string): string {
  const remainder = stripPrefix(backendModel)
  return `https://huggingface.co/${remainder}`
}

// IP/hostname → friendly server name (D-07 static map)
const HOST_MAP: Record<string, string> = {
  '192.168.50.73':            'hintonator',
  '192.168.50.79':            'spark-002',
  '100.115.141.106':          'spark-001',
  '100.123.128.107':          'spark-003',
  'docker-gpu.thelaljis.com': 'docker-gpu',
  '192.168.50.117':           'docker-001',
}

const CLOUD_HOSTS = new Set([
  'api.openai.com',
  'openrouter.ai',
  'generativelanguage.googleapis.com',
  'api.anthropic.com',
  'api.perplexity.ai',
])

function parseHost(apiBase: string | null): string | null {
  if (!apiBase) return null
  try {
    return new URL(apiBase).hostname
  } catch {
    return null
  }
}

function parsePort(apiBase: string | null): string | null {
  if (!apiBase) return null
  try {
    const u = new URL(apiBase)
    return u.port || null
  } catch {
    return null
  }
}

/**
 * resolveServer — maps api_base to a friendly server name.
 * Returns "cloud" for null, cloud hostnames, or unknown hosts.
 */
export function resolveServer(apiBase: string | null): string {
  const host = parseHost(apiBase)
  if (!host) return 'cloud'
  if (CLOUD_HOSTS.has(host)) return 'cloud'
  return HOST_MAP[host] ?? 'cloud'
}

/**
 * resolveRuntime — maps provider prefix + api_base to runtime label.
 */
export function resolveRuntime(provider: string, apiBase: string | null): string {
  const host = parseHost(apiBase)
  switch (provider) {
    case 'ollama':     return 'Ollama'
    case 'openai':     return (host && !CLOUD_HOSTS.has(host)) ? 'vLLM' : 'OpenAI'
    case 'openrouter': return 'OpenRouter'
    case 'gemini':     return 'Google AI'
    case 'anthropic':  return 'Anthropic'
    case 'perplexity': return 'Perplexity'
    default:           return provider || 'Unknown'
  }
}

/**
 * resolveUrlPort — returns "host:port" for local api_base, null for cloud/missing.
 */
export function resolveUrlPort(apiBase: string | null): string | null {
  const host = parseHost(apiBase)
  if (!host || CLOUD_HOSTS.has(host)) return null
  const port = parsePort(apiBase)
  return port ? `${host}:${port}` : host
}
