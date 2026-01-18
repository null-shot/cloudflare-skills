# Dynamic Model Discovery

Learn how to programmatically discover available models and their capabilities at runtime.

## Overview

While OpenAI provides a models API endpoint to list available models, it returns limited metadata. This guide covers:

1. **OpenAI Models API** - List models you have access to
2. **Model Capabilities** - Get detailed information about models
3. **Building a Model Registry** - Create your own capability database
4. **Best Practices** - When and how to use dynamic discovery

## OpenAI Models API

### Listing Available Models

The OpenAI SDK provides `models.list()` to enumerate models accessible to your API key:

```typescript
import { OpenAI } from "openai";

interface Env {
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const client = new OpenAI({
      apiKey: env.OPENAI_API_KEY,
    });

    // List all models
    const modelsList = await client.models.list();
    
    const models = [];
    for await (const model of modelsList) {
      models.push({
        id: model.id,
        created: model.created,
        owned_by: model.owned_by,
      });
    }

    return Response.json({
      total: models.length,
      models: models.sort((a, b) => a.id.localeCompare(b.id)),
    });
  }
}
```

**Response fields:**
- `id`: Model identifier (e.g., "gpt-4o", "gpt-4o-mini")
- `object`: Always "model"
- `created`: Unix timestamp when model was created
- `owned_by`: Organization that owns the model (e.g., "openai", "system")

**Important:** The models API does NOT return:
- Token limits (context window, max output tokens)
- Capabilities (streaming, function calling, vision support)
- Pricing information
- Parameter constraints

### Retrieving a Specific Model

Get metadata for a single model:

```typescript
const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
});

// Get specific model
const model = await client.models.retrieve("gpt-4o");

console.log(model);
// Output: { id: "gpt-4o", object: "model", created: 1686935002, owned_by: "openai" }
```

### Filtering Models

Filter by prefix to find specific model families:

```typescript
export default {
  async fetch(request: Request, env: Env) {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const modelsList = await client.models.list();
    
    const models = [];
    for await (const model of modelsList) {
      models.push(model);
    }

    // Filter by prefix
    const gpt4Models = models
      .filter(m => m.id.startsWith('gpt-4'))
      .map(m => m.id)
      .sort();

    const gpt3Models = models
      .filter(m => m.id.startsWith('gpt-3'))
      .map(m => m.id)
      .sort();

    const embeddingModels = models
      .filter(m => m.id.includes('embedding'))
      .map(m => m.id)
      .sort();

    return Response.json({
      'gpt-4': gpt4Models,
      'gpt-3': gpt3Models,
      'embeddings': embeddingModels,
    });
  }
}
```

## Static Model Capabilities Database

Since the models API doesn't return detailed capabilities, maintain a local database:

```typescript
interface ModelCapabilities {
  id: string;
  contextWindow: number;
  maxOutputTokens: number;
  supportsStreaming: boolean;
  supportsJsonSchema: boolean;
  supportsFunctionCalling: boolean;
  supportsVision: boolean;
  inputModalities: string[];
  outputModalities: string[];
  pricing?: {
    input: number;  // $ per million tokens
    output: number; // $ per million tokens
  };
}

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'gpt-4o': {
    id: 'gpt-4o',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsStreaming: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    pricing: {
      input: 2.50,
      output: 10.00,
    },
  },
  'gpt-4o-mini': {
    id: 'gpt-4o-mini',
    contextWindow: 128000,
    maxOutputTokens: 16384,
    supportsStreaming: true,
    supportsJsonSchema: true,
    supportsFunctionCalling: true,
    supportsVision: true,
    inputModalities: ['text', 'image'],
    outputModalities: ['text'],
    pricing: {
      input: 0.15,
      output: 0.60,
    },
  },
  'gpt-3.5-turbo': {
    id: 'gpt-3.5-turbo',
    contextWindow: 16384,
    maxOutputTokens: 4096,
    supportsStreaming: true,
    supportsJsonSchema: false,
    supportsFunctionCalling: true,
    supportsVision: false,
    inputModalities: ['text'],
    outputModalities: ['text'],
    pricing: {
      input: 0.50,
      output: 1.50,
    },
  },
  'text-embedding-3-small': {
    id: 'text-embedding-3-small',
    contextWindow: 8192,
    maxOutputTokens: 0,
    supportsStreaming: false,
    supportsJsonSchema: false,
    supportsFunctionCalling: false,
    supportsVision: false,
    inputModalities: ['text'],
    outputModalities: ['embedding'],
    pricing: {
      input: 0.02,
      output: 0,
    },
  },
  'text-embedding-3-large': {
    id: 'text-embedding-3-large',
    contextWindow: 8192,
    maxOutputTokens: 0,
    supportsStreaming: false,
    supportsJsonSchema: false,
    supportsFunctionCalling: false,
    supportsVision: false,
    inputModalities: ['text'],
    outputModalities: ['embedding'],
    pricing: {
      input: 0.13,
      output: 0,
    },
  },
};

export function getModelCapabilities(modelId: string): ModelCapabilities {
  const capabilities = MODEL_CAPABILITIES[modelId];
  if (!capabilities) {
    throw new Error(`Unknown model: ${modelId}`);
  }
  return capabilities;
}
```

### Using the Capabilities Database

```typescript
interface Env {
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const modelId = url.searchParams.get('model') || 'gpt-4o';

    try {
      // Get capabilities
      const capabilities = getModelCapabilities(modelId);

      // Verify model exists in OpenAI
      const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
      await client.models.retrieve(modelId);

      return Response.json({
        model: modelId,
        capabilities,
        status: 'available',
      });
    } catch (error) {
      return Response.json({
        error: error.message,
        model: modelId,
      }, { status: 404 });
    }
  }
}
```

## Hybrid Approach: Dynamic + Static

Combine the models API with your static database:

```typescript
interface Env {
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

    // Get available models from API
    const modelsList = await client.models.list();
    const availableModels = [];
    for await (const model of modelsList) {
      availableModels.push(model.id);
    }

    // Enrich with capabilities from our database
    const enrichedModels = availableModels
      .filter(id => MODEL_CAPABILITIES[id]) // Only known models
      .map(id => ({
        ...MODEL_CAPABILITIES[id],
        available: true,
      }));

    // Find models in our DB that aren't available to this API key
    const unavailableModels = Object.keys(MODEL_CAPABILITIES)
      .filter(id => !availableModels.includes(id))
      .map(id => ({
        ...MODEL_CAPABILITIES[id],
        available: false,
      }));

    return Response.json({
      available: enrichedModels,
      unavailable: unavailableModels,
    });
  }
}
```

## Parameter Validation

Validate parameters before sending to the API:

```typescript
interface ParameterConstraints {
  min?: number;
  max?: number;
  allowed?: any[];
}

const PARAMETER_CONSTRAINTS: Record<string, Record<string, ParameterConstraints>> = {
  'gpt-4o': {
    temperature: { min: 0, max: 2 },
    top_p: { min: 0, max: 1 },
    frequency_penalty: { min: -2, max: 2 },
    presence_penalty: { min: -2, max: 2 },
    max_tokens: { min: 1, max: 16384 },
  },
  'gpt-4o-mini': {
    temperature: { min: 0, max: 2 },
    top_p: { min: 0, max: 1 },
    frequency_penalty: { min: -2, max: 2 },
    presence_penalty: { min: -2, max: 2 },
    max_tokens: { min: 1, max: 16384 },
  },
};

export function validateParameter(
  modelId: string,
  paramName: string,
  value: any
): { valid: boolean; error?: string } {
  const modelConstraints = PARAMETER_CONSTRAINTS[modelId];
  if (!modelConstraints) {
    return { valid: false, error: `No constraints defined for model: ${modelId}` };
  }

  const constraint = modelConstraints[paramName];
  if (!constraint) {
    return { valid: false, error: `Unknown parameter: ${paramName}` };
  }

  // Check min/max
  if (typeof value === 'number') {
    if (constraint.min !== undefined && value < constraint.min) {
      return { valid: false, error: `${paramName} must be >= ${constraint.min}` };
    }
    if (constraint.max !== undefined && value > constraint.max) {
      return { valid: false, error: `${paramName} must be <= ${constraint.max}` };
    }
  }

  // Check allowed values
  if (constraint.allowed && !constraint.allowed.includes(value)) {
    return { valid: false, error: `${paramName} must be one of: ${constraint.allowed.join(', ')}` };
  }

  return { valid: true };
}

// Usage
const validation = validateParameter('gpt-4o', 'temperature', 0.7);
if (!validation.valid) {
  console.error(validation.error);
}
```

## Complete Example: Model Selection API

Build an API endpoint that helps users choose the right model:

```typescript
import { OpenAI } from "openai";

interface Env {
  OPENAI_API_KEY: string;
}

interface ModelRecommendation {
  model: string;
  reason: string;
  capabilities: ModelCapabilities;
  costEstimate?: number;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const useCase = url.searchParams.get('use_case');
    const maxCost = parseFloat(url.searchParams.get('max_cost') || '10');

    if (!useCase) {
      return Response.json({ error: 'Missing use_case parameter' }, { status: 400 });
    }

    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

    // Get available models
    const modelsList = await client.models.list();
    const availableIds = [];
    for await (const model of modelsList) {
      availableIds.push(model.id);
    }

    // Recommend based on use case
    const recommendations: ModelRecommendation[] = [];

    switch (useCase) {
      case 'structured_extraction':
        if (availableIds.includes('gpt-4o')) {
          recommendations.push({
            model: 'gpt-4o',
            reason: 'Best accuracy with json_schema support',
            capabilities: MODEL_CAPABILITIES['gpt-4o'],
          });
        }
        if (availableIds.includes('gpt-4o-mini')) {
          recommendations.push({
            model: 'gpt-4o-mini',
            reason: 'Cost-effective with json_schema support',
            capabilities: MODEL_CAPABILITIES['gpt-4o-mini'],
          });
        }
        break;

      case 'chat':
        if (availableIds.includes('gpt-4o')) {
          recommendations.push({
            model: 'gpt-4o',
            reason: 'Best conversational quality with streaming',
            capabilities: MODEL_CAPABILITIES['gpt-4o'],
          });
        }
        if (availableIds.includes('gpt-4o-mini')) {
          recommendations.push({
            model: 'gpt-4o-mini',
            reason: 'Fast responses at lower cost',
            capabilities: MODEL_CAPABILITIES['gpt-4o-mini'],
          });
        }
        break;

      case 'embeddings':
        if (availableIds.includes('text-embedding-3-small')) {
          recommendations.push({
            model: 'text-embedding-3-small',
            reason: 'Cost-effective for most semantic search use cases',
            capabilities: MODEL_CAPABILITIES['text-embedding-3-small'],
          });
        }
        if (availableIds.includes('text-embedding-3-large')) {
          recommendations.push({
            model: 'text-embedding-3-large',
            reason: 'Higher quality embeddings for precision-critical tasks',
            capabilities: MODEL_CAPABILITIES['text-embedding-3-large'],
          });
        }
        break;

      default:
        return Response.json({ 
          error: 'Unknown use_case. Try: structured_extraction, chat, embeddings' 
        }, { status: 400 });
    }

    // Filter by cost
    const affordable = recommendations.filter(r => {
      if (!r.capabilities.pricing) return true;
      return r.capabilities.pricing.input <= maxCost;
    });

    return Response.json({
      use_case: useCase,
      max_cost_per_1m_tokens: maxCost,
      recommendations: affordable.length > 0 ? affordable : recommendations,
    });
  }
}
```

**Usage:**
```bash
curl "https://your-worker.dev?use_case=structured_extraction&max_cost=5"
```

**Response:**
```json
{
  "use_case": "structured_extraction",
  "max_cost_per_1m_tokens": 5,
  "recommendations": [
    {
      "model": "gpt-4o",
      "reason": "Best accuracy with json_schema support",
      "capabilities": {
        "contextWindow": 128000,
        "maxOutputTokens": 16384,
        "supportsJsonSchema": true,
        "pricing": {
          "input": 2.50,
          "output": 10.00
        }
      }
    }
  ]
}
```

## Storing Capabilities in KV

For frequently updated model information, store capabilities in KV:

```typescript
interface Env {
  OPENAI_API_KEY: string;
  MODEL_REGISTRY: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);
    const modelId = url.searchParams.get('model') || 'gpt-4o';

    // Try to get from cache
    const cached = await env.MODEL_REGISTRY.get(
      `capabilities:${modelId}`,
      'json'
    );

    if (cached) {
      return Response.json({
        model: modelId,
        capabilities: cached,
        cached: true,
      });
    }

    // Get from database and cache
    const capabilities = MODEL_CAPABILITIES[modelId];
    if (!capabilities) {
      return Response.json({ error: 'Unknown model' }, { status: 404 });
    }

    // Cache for 1 hour
    await env.MODEL_REGISTRY.put(
      `capabilities:${modelId}`,
      JSON.stringify(capabilities),
      { expirationTtl: 3600 }
    );

    return Response.json({
      model: modelId,
      capabilities,
      cached: false,
    });
  }
}
```

**wrangler.jsonc:**
```jsonc
{
  "kv_namespaces": [
    {
      "binding": "MODEL_REGISTRY",
      "id": "your-kv-id"
    }
  ]
}
```

## Best Practices

### 1. Use Static Database for Capabilities

Don't rely on the models API for capabilities—it doesn't return them. Maintain your own database.

### 2. Verify Model Availability

Use `models.list()` to confirm a model exists before using it:

```typescript
const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });

async function isModelAvailable(modelId: string): Promise<boolean> {
  try {
    await client.models.retrieve(modelId);
    return true;
  } catch (error) {
    return false;
  }
}
```

### 3. Cache Model Lists

Cache the results of `models.list()` to reduce API calls:

```typescript
interface Env {
  OPENAI_API_KEY: string;
  CACHE: KVNamespace;
}

export default {
  async fetch(request: Request, env: Env) {
    // Try cache first
    const cached = await env.CACHE.get('available_models', 'json');
    if (cached) {
      return Response.json({ models: cached, cached: true });
    }

    // Fetch and cache
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const modelsList = await client.models.list();
    const models = [];
    for await (const model of modelsList) {
      models.push(model.id);
    }

    // Cache for 1 hour
    await env.CACHE.put('available_models', JSON.stringify(models), {
      expirationTtl: 3600,
    });

    return Response.json({ models, cached: false });
  }
}
```

### 4. Version Your Capabilities Database

Track when you last updated model capabilities:

```typescript
const MODEL_REGISTRY_VERSION = '2026-01-17';

const MODEL_CAPABILITIES = {
  _metadata: {
    version: MODEL_REGISTRY_VERSION,
    lastUpdated: '2026-01-17T00:00:00Z',
  },
  'gpt-4o': { /* ... */ },
  // ... other models
};
```

### 5. Handle Deprecated Models

Mark deprecated models and suggest alternatives:

```typescript
interface ModelCapabilities {
  id: string;
  deprecated?: boolean;
  deprecationDate?: string;
  replacement?: string;
  // ... other fields
}

const MODEL_CAPABILITIES: Record<string, ModelCapabilities> = {
  'gpt-3.5-turbo-0301': {
    id: 'gpt-3.5-turbo-0301',
    deprecated: true,
    deprecationDate: '2024-06-13',
    replacement: 'gpt-3.5-turbo',
    // ... capabilities
  },
};
```

### 6. Validate Before API Calls

Always validate parameters before making expensive API calls:

```typescript
async function safeCompletionCreate(
  client: OpenAI,
  modelId: string,
  params: any
) {
  // Validate model exists
  const capabilities = MODEL_CAPABILITIES[modelId];
  if (!capabilities) {
    throw new Error(`Unknown model: ${modelId}`);
  }

  // Validate parameters
  for (const [key, value] of Object.entries(params)) {
    const validation = validateParameter(modelId, key, value);
    if (!validation.valid) {
      throw new Error(`Invalid ${key}: ${validation.error}`);
    }
  }

  // Make API call
  return await client.chat.completions.create({
    model: modelId,
    ...params,
  });
}
```

## Limitations and Caveats

1. **No official capabilities API**: OpenAI doesn't provide a structured API for model capabilities
2. **Manual updates required**: You must update your database when models change
3. **Access-based listing**: `models.list()` only shows models your API key can access
4. **Rate limits**: Calling `models.list()` counts against your rate limit
5. **No pricing in API**: Pricing must be maintained separately
6. **Model versions**: Dated models (e.g., `gpt-4o-2024-08-06`) may not appear in some lists

## Future Improvements

Consider building:

1. **Automated updates**: Scrape OpenAI docs or use a community registry
2. **Capability detection**: Test models to discover capabilities programmatically
3. **Cost calculator**: Estimate costs based on input/output token counts
4. **Model health status**: Track model performance and availability
5. **A/B testing**: Compare model quality for your specific use cases

## Summary

- Use `models.list()` to check model availability for your API key
- Maintain a static database for detailed capabilities (token limits, features, pricing)
- Cache model lists to reduce API calls
- Validate parameters before making API requests
- Update your capabilities database regularly as OpenAI releases new models
- Consider using Workers KV to store and cache model metadata
