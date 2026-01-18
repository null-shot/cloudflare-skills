# Streaming Patterns

Complete guide to implementing streaming responses with Workers AI for real-time, token-by-token text generation.

## Why Stream?

Streaming provides better user experience by:
- **Reducing perceived latency** - Users see output immediately
- **Showing progress** - Visual feedback that work is happening
- **Handling long responses** - Display partial results before completion
- **Improving engagement** - Users can read while AI generates

## OpenAI SDK Streaming

### Basic Streaming Pattern

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

    // Enable streaming
    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'user', content: 'Write a short story about the edge.' }
      ],
      stream: true, // Enable streaming
    });

    // Convert to ReadableStream for Response
    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const content = chunk.choices[0]?.delta?.content;
            if (content) {
              // Send as Server-Sent Events
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
              );
            }
          }
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }
}
```

### Streaming with Function Calls

```typescript
const stream = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [
    { role: 'user', content: 'What is the weather in San Francisco?' }
  ],
  tools: [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'Get the current weather',
        parameters: {
          type: 'object',
          properties: {
            location: { type: 'string' }
          }
        }
      }
    }
  ],
  stream: true,
});

const readable = new ReadableStream({
  async start(controller) {
    const encoder = new TextEncoder();
    
    for await (const chunk of stream) {
      const delta = chunk.choices[0]?.delta;
      
      // Stream text content
      if (delta?.content) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ 
            type: 'content', 
            content: delta.content 
          })}\n\n`)
        );
      }
      
      // Stream function call
      if (delta?.tool_calls) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ 
            type: 'tool_call', 
            tool_call: delta.tool_calls[0] 
          })}\n\n`)
        );
      }
    }
    
    controller.enqueue(encoder.encode('data: [DONE]\n\n'));
    controller.close();
  }
});
```

## Vercel AI SDK Streaming

For advanced streaming features, use the Vercel AI SDK:

```bash
npm install ai @ai-sdk/openai
```

### Using streamText

```typescript
import { streamText } from 'ai';
import { openai } from '@ai-sdk/openai';

interface Env {
  OPENAI_API_KEY: string;
}

export default {
  async fetch(request: Request, env: Env) {
    const { messages } = await request.json();

    const result = streamText({
      model: openai('gpt-4o', {
        apiKey: env.OPENAI_API_KEY,
      }),
      messages,
    });

    // Returns a Response with proper streaming headers
    return result.toDataStreamResponse();
  }
}
```

### Streaming with Tools

```typescript
import { streamText, tool } from 'ai';
import { openai } from '@ai-sdk/openai';
import { z } from 'zod';

export default {
  async fetch(request: Request, env: Env) {
    const { messages } = await request.json();

    const result = streamText({
      model: openai('gpt-4o', { apiKey: env.OPENAI_API_KEY }),
      messages,
      tools: {
        get_weather: tool({
          description: 'Get weather for a location',
          parameters: z.object({
            location: z.string(),
          }),
          execute: async ({ location }) => {
            // Call weather API
            const weather = await fetchWeather(location);
            return weather;
          },
        }),
      },
    });

    return result.toDataStreamResponse();
  }
}
```

## Server-Sent Events (SSE)

SSE is the standard protocol for streaming text from server to client.

### SSE Format

```
data: {"content": "Hello"}\n\n
data: {"content": " world"}\n\n
data: [DONE]\n\n
```

**Rules:**
- Each message starts with `data: `
- Each message ends with `\n\n` (two newlines)
- Messages must be on a single line (escape newlines in JSON)
- Use `[DONE]` to signal completion

### SSE Response Headers

```typescript
{
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Connection': 'keep-alive',
  'X-Accel-Buffering': 'no', // Disable nginx buffering
}
```

## Client-Side Integration

### Vanilla JavaScript

```javascript
const eventSource = new EventSource('/api/chat');

eventSource.onmessage = (event) => {
  if (event.data === '[DONE]') {
    eventSource.close();
    return;
  }
  
  const data = JSON.parse(event.data);
  displayMessage(data.content);
};

eventSource.onerror = (error) => {
  console.error('SSE error:', error);
  eventSource.close();
};
```

### Fetch API with ReadableStream

```javascript
const response = await fetch('/api/chat', {
  method: 'POST',
  body: JSON.stringify({ message: 'Hello' }),
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  
  const text = decoder.decode(value);
  const lines = text.split('\n');
  
  for (const line of lines) {
    if (line.startsWith('data: ')) {
      const data = line.slice(6);
      if (data === '[DONE]') break;
      
      const json = JSON.parse(data);
      displayMessage(json.content);
    }
  }
}
```

### React with useChat (Vercel AI SDK)

```tsx
'use client';

import { useChat } from 'ai/react';

export default function Chat() {
  const { messages, input, handleInputChange, handleSubmit } = useChat({
    api: '/api/chat',
  });

  return (
    <div>
      {messages.map(message => (
        <div key={message.id}>
          <strong>{message.role}:</strong> {message.content}
        </div>
      ))}
      
      <form onSubmit={handleSubmit}>
        <input value={input} onChange={handleInputChange} />
        <button type="submit">Send</button>
      </form>
    </div>
  );
}
```

## Anthropic Streaming

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

    const stream = client.messages.stream({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 1024,
      messages: [
        { role: 'user', content: 'Tell me a story.' }
      ],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        try {
          // Listen to text deltas
          stream.on('text', (text) => {
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content: text })}\n\n`)
            );
          });

          // Wait for completion
          await stream.finalMessage();
          
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        } catch (error) {
          controller.error(error);
        }
      },
    });

    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
      },
    });
  }
}
```

## Streaming with AI Gateway

AI Gateway supports streaming - just set the `baseUrl`:

```typescript
const client = new OpenAI({
  apiKey: env.OPENAI_API_KEY,
  baseUrl: `https://gateway.ai.cloudflare.com/v1/${env.ACCOUNT_ID}/${env.GATEWAY_ID}/openai`
});

// Streaming works the same way
const stream = await client.chat.completions.create({
  model: 'gpt-4o',
  messages: [...],
  stream: true,
});
```

**Benefits:**
- Analytics on streaming requests
- Caching of identical streaming requests
- Rate limiting per user/endpoint

## Handling Streaming Errors

```typescript
const readable = new ReadableStream({
  async start(controller) {
    const encoder = new TextEncoder();
    
    try {
      for await (const chunk of stream) {
        const content = chunk.choices[0]?.delta?.content;
        if (content) {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
          );
        }
      }
      controller.enqueue(encoder.encode('data: [DONE]\n\n'));
      controller.close();
    } catch (error) {
      // Send error to client
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ 
          error: error.message,
          type: 'error' 
        })}\n\n`)
      );
      controller.close();
    }
  },
});
```

**Client-side error handling:**
```javascript
eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  
  if (data.type === 'error') {
    console.error('Streaming error:', data.error);
    eventSource.close();
    return;
  }
  
  displayMessage(data.content);
};
```

## Streaming Best Practices

1. **Always set proper headers**: `text/event-stream`, `no-cache`, `keep-alive`
2. **Use SSE format**: Prefix with `data: `, end with `\n\n`
3. **Signal completion**: Send `[DONE]` marker when finished
4. **Handle errors gracefully**: Send error messages in stream before closing
5. **Test with slow networks**: Ensure streaming works under poor conditions
6. **Close streams**: Always close EventSource/ReadableStream when done
7. **Implement timeouts**: Set reasonable timeouts for streaming requests
8. **Buffer messages**: Consider buffering short chunks to reduce overhead
9. **Monitor latency**: Track time-to-first-token and tokens-per-second

## Streaming with Durable Objects

For persistent chat sessions with streaming:

```typescript
import { DurableObject } from 'cloudflare:workers';
import { OpenAI } from 'openai';

export class ChatSession extends DurableObject {
  async fetch(request: Request) {
    const { message } = await request.json();
    
    // Get message history from storage
    const history = await this.ctx.storage.get('messages') || [];
    history.push({ role: 'user', content: message });
    
    const client = new OpenAI({
      apiKey: this.env.OPENAI_API_KEY,
    });
    
    const stream = await client.chat.completions.create({
      model: 'gpt-4o',
      messages: history,
      stream: true,
    });
    
    const encoder = new TextEncoder();
    let assistantMessage = '';
    
    const readable = new ReadableStream({
      async start(controller) {
        for await (const chunk of stream) {
          const content = chunk.choices[0]?.delta?.content;
          if (content) {
            assistantMessage += content;
            controller.enqueue(
              encoder.encode(`data: ${JSON.stringify({ content })}\n\n`)
            );
          }
        }
        
        // Save complete assistant message
        history.push({ role: 'assistant', content: assistantMessage });
        await this.ctx.storage.put('messages', history);
        
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
      },
    });
    
    return new Response(readable, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
    });
  }
}
```

## Performance Optimization

### Chunking Strategy

```typescript
let buffer = '';
const CHUNK_SIZE = 20; // Send every 20 characters

for await (const chunk of stream) {
  const content = chunk.choices[0]?.delta?.content;
  if (content) {
    buffer += content;
    
    // Flush buffer when it reaches chunk size
    if (buffer.length >= CHUNK_SIZE) {
      controller.enqueue(
        encoder.encode(`data: ${JSON.stringify({ content: buffer })}\n\n`)
      );
      buffer = '';
    }
  }
}

// Flush remaining buffer
if (buffer) {
  controller.enqueue(
    encoder.encode(`data: ${JSON.stringify({ content: buffer })}\n\n`)
  );
}
```

### Connection Keep-Alive

```typescript
// Send periodic heartbeat to keep connection alive
const heartbeatInterval = setInterval(() => {
  controller.enqueue(encoder.encode(': heartbeat\n\n'));
}, 30000); // Every 30 seconds

// Clear interval when done
stream.on('end', () => {
  clearInterval(heartbeatInterval);
});
```

## Testing Streaming Locally

```bash
# Use wrangler dev
wrangler dev

# Test with curl
curl -N http://localhost:8787/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello"}'
```

**Note:** The `-N` flag disables curl's buffering for real-time streaming.

## Common Issues

### Issue: Buffering by Proxy/CDN

**Solution:** Set `X-Accel-Buffering: no` header

```typescript
headers: {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'X-Accel-Buffering': 'no',
}
```

### Issue: Connection Timeout

**Solution:** Implement heartbeat

```typescript
const heartbeat = setInterval(() => {
  controller.enqueue(encoder.encode(': ping\n\n'));
}, 15000);
```

### Issue: Client Not Receiving Events

**Solution:** Ensure proper SSE format and CORS headers

```typescript
headers: {
  'Content-Type': 'text/event-stream',
  'Cache-Control': 'no-cache',
  'Access-Control-Allow-Origin': '*',
}
```

## Advanced: Streaming with Retry

```javascript
function connectWithRetry(url, maxRetries = 3) {
  let retries = 0;
  
  function connect() {
    const eventSource = new EventSource(url);
    
    eventSource.onerror = (error) => {
      console.error('Connection error:', error);
      eventSource.close();
      
      if (retries < maxRetries) {
        retries++;
        setTimeout(() => {
          console.log(`Retrying... (${retries}/${maxRetries})`);
          connect();
        }, 1000 * retries); // Exponential backoff
      }
    };
    
    return eventSource;
  }
  
  return connect();
}
```

## Summary

- **OpenAI SDK**: Use `stream: true` and convert AsyncIterable to ReadableStream
- **Vercel AI SDK**: Use `streamText()` for simplified streaming
- **SSE Format**: `data: {json}\n\n` for each message, `[DONE]` to finish
- **Headers**: Set `text/event-stream`, `no-cache`, `keep-alive`
- **Error Handling**: Send errors in stream, implement retry on client
- **Performance**: Buffer small chunks, implement heartbeat for long connections
