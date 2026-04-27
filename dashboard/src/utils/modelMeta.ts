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
 * Returns e.g. "35B", "7B", or null if nothing matches.
 */
export function extractSize(backendModel: string): string | null {
  const m = backendModel.match(/(\d+(?:\.\d+)?)[Bb]/)
  if (!m) return null
  return `${m[1]}B`
}

/**
 * extractQuant — detect quantization scheme from model slug.
 * Matches NVFP4, FP8, FP16, BF16, Q4_K_M, Q8_0, AWQ, GPTQ, etc.
 * Returns the matched string or null.
 */
export function extractQuant(backendModel: string): string | null {
  const m = backendModel.match(/\b(NVFP4|FP8|FP16|BF16|INT8|INT4|Q\d+_\w+|AWQ|GPTQ|GGUF|GGML)\b/i)
  if (!m) return null
  return m[1].toUpperCase()
}

// Known cloud sub-namespaces that appear after stripping openrouter/ prefix —
// these are NOT HuggingFace paths.
const CLOUD_ORGS = new Set([
  'google', 'openai', 'anthropic', 'moonshotai', 'minimax', 'deepseek',
  'mistralai', 'meta-llama', 'cohere', 'perplexity', 'z-ai', 'nvidia',
  'qwen', 'x-ai', 'amazon',
])

/**
 * isHfPath — true if stripping the provider prefix leaves an org/model slug
 * that looks like a HuggingFace user/repo path (not a cloud provider sub-path).
 */
export function isHfPath(backendModel: string): boolean {
  const remainder = stripPrefix(backendModel)
  if (!remainder.includes('/')) return false
  const org = remainder.split('/')[0].toLowerCase()
  return !CLOUD_ORGS.has(org)
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
 * isPrivateHost — true for any host that is clearly on a local/private network:
 *   - No dots → Docker internal DNS (e.g. "ollama", "litellm-proxy")
 *   - RFC 1918: 10.x, 172.16-31.x, 192.168.x
 *   - Tailscale CGNAT: 100.64.0.0/10  (100.64–100.127)
 *   - localhost / loopback
 */
function isPrivateHost(host: string): boolean {
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1') return true
  if (!host.includes('.')) return true  // plain Docker service name
  if (/^10\./.test(host)) return true
  if (/^192\.168\./.test(host)) return true
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true
  // Tailscale: 100.64.0.0/10 → 100.64.x.x – 100.127.x.x
  const ts = host.match(/^100\.(\d+)\./)
  if (ts && +ts[1] >= 64 && +ts[1] <= 127) return true
  return false
}

/**
 * resolveServer — maps api_base to a friendly server name.
 * Prefers HOST_MAP for known nodes; falls back to network-range detection
 * so new local servers are not misclassified as cloud.
 */
export function resolveServer(apiBase: string | null): string {
  const host = parseHost(apiBase)
  if (!host) return 'cloud'
  if (CLOUD_HOSTS.has(host)) return 'cloud'
  if (HOST_MAP[host]) return HOST_MAP[host]
  if (isPrivateHost(host)) return 'local'
  return 'cloud'
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
