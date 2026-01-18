# Model Selection Guide

Comprehensive guide to choosing and using AI models with Workers AI.

## Available Model Providers

Workers AI works with industry-standard SDKs, allowing you to use models from multiple providers:

- **OpenAI** - GPT-4o, GPT-4o-mini, GPT-3.5-turbo, embeddings
- **Anthropic** - Claude 3.5 Sonnet, Claude 3 Opus, Claude 3 Haiku
- **Azure OpenAI** - Enterprise OpenAI models
- **Custom endpoints** - Any OpenAI-compatible API

## OpenAI Models

### GPT-4o (Recommended)

**Model ID:** `gpt-4o` or `gpt-4o-2024-08-06`

**Best for:**
- Complex reasoning and analysis
- Structured data extraction
- Multi-step tasks
- Code generation
- Long-form content

**Key Features:**
- Supports `json_schema` response format
- 128K token context window
- Function calling
- Vision capabilities (multimodal)

**Use Cases:**
```typescript
// Structured extraction
const response = await client.chat.completions.create({
  model: 'gpt-4o-2024-08-06',
  messages: [
    { role: 'system', content: 'Extract invoice data.' },
    { role: 'user', content: invoiceText }
  ],
  response_format: {
    type: 'json_schema',
    schema: InvoiceSchema
  }
});

// Code generation
const response = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'system', content: 'You are an expert TypeScript developer.' },
    { role: 'user', content: 'Write a function to validate email addresses.' }
  ]
});
```

### GPT-4o-mini (Cost-Effective)

**Model ID:** `gpt-4o-mini`

**Best for:**
- High-volume applications
- Simple classification tasks
- Fast response requirements
- Cost-sensitive workloads

**Key Features:**
- 128K token context window
- Supports `json_schema`
- Significantly lower cost than GPT-4o
- Fast inference

**Use Cases:**
```typescript
// Content classification
const response = await client.chat.completions.create({
  model: 'gpt-4o-mini',
  messages: [
    { role: 'system', content: 'Classify sentiment as positive, negative, or neutral.' },
    { role: 'user', content: userComment }
  ],
  response_format: {
    type: 'json_schema',
    schema: { 
      type: 'object',
      properties: { sentiment: { type: 'string', enum: ['positive', 'negative', 'neutral'] } }
    }
  }
});
```

### GPT-3.5-turbo (Legacy)

**Model ID:** `gpt-3.5-turbo`

**Best for:**
- Simple completions
- Legacy applications
- Maximum throughput

**Limitations:**
- Limited structured output support
- Smaller context window (16K)
- Less capable reasoning

**Note:** Consider migrating to GPT-4o-mini for better performance and features.

## Anthropic Claude Models

Use the official Anthropic SDK for Claude models:

```bash
npm install @anthropic-ai/sdk
```

### Claude 3.5 Sonnet (Recommended)

**Model ID:** `claude-3-5-sonnet-20241022`

**Best for:**
- Long-form content generation
- Document analysis
- Creative writing
- Research tasks

**Key Features:**
- 200K token context window
- Excellent instruction following
- Strong reasoning capabilities
- Tool use (function calling)

**Usage:**
```typescript
import Anthropic from '@anthropic-ai/sdk';

interface Env {
  ANTHROPIC_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const client = new Anthropic({
      apiKey: env.ANTHROPIC_API_KEY,
    });

    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'Explain quantum computing.' }
      ]
    });

    return Response.json({ content: response.content[0].text });
  }
}
```

### Claude 3 Haiku (Fast)

**Model ID:** `claude-3-haiku-20240307`

**Best for:**
- High-speed responses
- Simple Q&A
- Real-time chat
- Cost optimization

**Key Features:**
- Fastest Claude model
- Lower cost
- Good for straightforward tasks

## Embedding Models

### OpenAI Embeddings

| Model | Dimensions | Best For | Cost |
|-------|------------|----------|------|
| text-embedding-3-small | 1536 | General purpose, cost-effective | Low |
| text-embedding-3-large | 3072 | High-quality semantic search | Medium |
| text-embedding-ada-002 | 1536 | Legacy (use small instead) | Low |

**Usage:**
```typescript
const response = await client.embeddings.create({
  model: 'text-embedding-3-small',
  input: 'Text to embed',
});

const vector = response.data[0].embedding;
// vector.length === 1536
```

**Choosing an embedding model:**
- **text-embedding-3-small**: Default choice for most use cases
- **text-embedding-3-large**: When you need maximum accuracy for similarity
- **Batch processing**: Send up to 2048 texts in one request for efficiency

## Model Comparison

### By Use Case

| Use Case | Primary Choice | Alternative |
|----------|---------------|-------------|
| Chat applications | GPT-4o | Claude 3.5 Sonnet |
| Structured extraction | GPT-4o (json_schema) | GPT-4o-mini |
| High-volume tasks | GPT-4o-mini | Claude 3 Haiku |
| Long-form content | Claude 3.5 Sonnet | GPT-4o |
| Code generation | GPT-4o | Claude 3.5 Sonnet |
| Embeddings | text-embedding-3-small | text-embedding-3-large |

### By Performance Characteristics

| Metric | Fastest | Best Quality | Most Cost-Effective |
|--------|---------|--------------|---------------------|
| Text Generation | Claude 3 Haiku | GPT-4o | GPT-4o-mini |
| Reasoning | GPT-4o-mini | GPT-4o | GPT-4o-mini |
| Context Length | Claude 3.5 Sonnet (200K) | Claude 3.5 Sonnet | GPT-4o-mini (128K) |

## Structured Output Support

| Model | json_schema | json_object | Notes |
|-------|-------------|-------------|-------|
| GPT-4o | ✅ | ✅ | Full support with validation |
| GPT-4o-mini | ✅ | ✅ | Full support with validation |
| GPT-3.5-turbo | ❌ | ✅ | Manual parsing required |
| Claude 3.5 | ❌ | ✅ | Use prompt engineering |
| Claude 3 Haiku | ❌ | ✅ | Use prompt engineering |

## Using Multiple Providers

Route to different providers based on requirements:

```typescript
interface Env {
  OPENAI_API_KEY: string;
  ANTHROPIC_API_KEY: string;
}

async function getCompletion(
  provider: 'openai' | 'anthropic',
  prompt: string,
  env: Env
) {
  if (provider === 'openai') {
    const client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: prompt }]
    });
    return response.choices[0].message.content;
  } else {
    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [{ role: 'user', content: prompt }]
    });
    return response.content[0].text;
  }
}
```

## Model Selection Decision Tree

```
Need structured JSON output?
├─ Yes → Use GPT-4o or GPT-4o-mini with json_schema
└─ No
   └─ Need long context (>128K tokens)?
      ├─ Yes → Use Claude 3.5 Sonnet (200K)
      └─ No
         └─ High volume / cost-sensitive?
            ├─ Yes → Use GPT-4o-mini or Claude 3 Haiku
            └─ No → Use GPT-4o for best quality
```

## Configuration Examples

### OpenAI with AI Gateway

```typescript
const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseUrl: `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/openai`
});
```

### Anthropic with AI Gateway

```typescript
const client = new Anthropic({
  apiKey: env.ANTHROPIC_API_KEY,
  baseURL: `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/anthropic`
});
```

### Azure OpenAI

```typescript
import { AzureOpenAI } from 'openai';

const client = new AzureOpenAI({
  apiKey: env.AZURE_OPENAI_KEY,
  endpoint: env.AZURE_OPENAI_ENDPOINT,
  apiVersion: '2024-02-01'
});
```

## Cost Optimization Strategies

1. **Use appropriate model tiers**: Don't use GPT-4o for simple tasks
2. **Cache responses**: Use AI Gateway caching for identical requests
3. **Batch embeddings**: Process multiple texts in a single API call
4. **Limit max_tokens**: Set reasonable token limits to control costs
5. **Truncate context**: Only send relevant context, not entire documents
6. **Monitor usage**: Use AI Gateway analytics to track spend

## Best Practices

1. **Start with cheaper models**: Test with GPT-4o-mini before moving to GPT-4o
2. **Use structured outputs**: Reduces post-processing and parsing errors
3. **Set timeouts**: Prevent long-running requests from blocking Workers
4. **Handle failures gracefully**: Always implement retry logic with exponential backoff
5. **Version pin models**: Use dated model versions (e.g., `gpt-4o-2024-08-06`) for consistency
6. **Test locally**: Use `wrangler dev` to test model integrations before deploying
7. **Monitor latency**: Track P95/P99 latencies via AI Gateway or observability

## Model Limitations

### Context Windows

- **GPT-4o**: 128K tokens (~300 pages)
- **GPT-4o-mini**: 128K tokens
- **Claude 3.5 Sonnet**: 200K tokens (~500 pages)
- **Claude 3 Haiku**: 200K tokens

### Output Token Limits

- **OpenAI models**: Depends on context, typically 4K-16K
- **Claude models**: Set via `max_tokens` parameter (required)

### Rate Limits

Rate limits vary by provider and account tier. Always:
- Implement exponential backoff
- Catch 429 status codes
- Use AI Gateway for rate limiting control

## Future-Proofing

1. **Abstract model calls**: Create a shared interface for different providers
2. **Use environment variables**: Make model selection configurable
3. **Version your prompts**: Track prompt changes alongside code
4. **Monitor model updates**: Subscribe to provider changelogs
5. **Test new models**: Evaluate new releases against your use cases
