import { describe, it, expect } from 'vitest'
import { extractSize, isHfPath, hfUrl, resolveServer, resolveRuntime, resolveUrlPort } from './modelMeta'

describe('extractSize', () => {
  it('extracts integer size', () => {
    expect(extractSize('mistral-7b-instruct')).toBe('7B')
  })
  it('extracts decimal size', () => {
    expect(extractSize('Qwen3.5-35B-A3B-NVFP4')).toBe('35B')
  })
  it('extracts from gemma-4-31b (lowercase b)', () => {
    expect(extractSize('gemma-4-31b')).toBe('31B')
  })
  it('returns ? when no size found', () => {
    expect(extractSize('nomic-embed-text')).toBe('?')
  })
})

describe('isHfPath', () => {
  it('returns true for org/model after stripping provider prefix', () => {
    expect(isHfPath('openai/Kbenkhaled/Qwen3.5-35B-A3B-NVFP4')).toBe(true)
  })
  it('returns false for plain model name after stripping (no slash in remainder)', () => {
    expect(isHfPath('openai/gpt-4o')).toBe(false)
  })
  it('returns false for ollama model with no slash in remainder', () => {
    expect(isHfPath('ollama/nomic-embed-text')).toBe(false)
  })
  it('returns true for openrouter org/model', () => {
    expect(isHfPath('openrouter/meta-llama/llama-3.3-70b-instruct')).toBe(true)
  })
})

describe('hfUrl', () => {
  it('returns correct HF URL', () => {
    expect(hfUrl('openai/Kbenkhaled/Qwen3.5-35B-A3B-NVFP4')).toBe(
      'https://huggingface.co/Kbenkhaled/Qwen3.5-35B-A3B-NVFP4'
    )
  })
})

describe('resolveServer', () => {
  it('resolves local IP to friendly name', () => {
    expect(resolveServer('http://192.168.50.73:8000/v1')).toBe('hintonator')
  })
  it('resolves docker-gpu hostname', () => {
    expect(resolveServer('http://docker-gpu.thelaljis.com:11434')).toBe('docker-gpu')
  })
  it('returns cloud for null', () => {
    expect(resolveServer(null)).toBe('cloud')
  })
  it('returns cloud for openai api base', () => {
    expect(resolveServer('https://api.openai.com/v1')).toBe('cloud')
  })
})

describe('resolveRuntime', () => {
  it('ollama provider → Ollama', () => {
    expect(resolveRuntime('ollama', 'http://docker-gpu.thelaljis.com:11434')).toBe('Ollama')
  })
  it('openai with local api_base → vLLM', () => {
    expect(resolveRuntime('openai', 'http://192.168.50.73:8000/v1')).toBe('vLLM')
  })
  it('openai with null api_base → OpenAI', () => {
    expect(resolveRuntime('openai', null)).toBe('OpenAI')
  })
  it('openrouter → OpenRouter', () => {
    expect(resolveRuntime('openrouter', null)).toBe('OpenRouter')
  })
  it('gemini → Google AI', () => {
    expect(resolveRuntime('gemini', null)).toBe('Google AI')
  })
  it('anthropic → Anthropic', () => {
    expect(resolveRuntime('anthropic', null)).toBe('Anthropic')
  })
  it('perplexity → Perplexity', () => {
    expect(resolveRuntime('perplexity', null)).toBe('Perplexity')
  })
})

describe('resolveUrlPort', () => {
  it('returns host:port for local api_base', () => {
    expect(resolveUrlPort('http://192.168.50.73:8000/v1')).toBe('192.168.50.73:8000')
  })
  it('returns null for null input', () => {
    expect(resolveUrlPort(null)).toBe(null)
  })
  it('returns null for cloud host', () => {
    expect(resolveUrlPort('https://api.openai.com/v1')).toBe(null)
  })
})
