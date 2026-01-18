# Testing Workers AI

Workers AI requires **remote bindings** or **mocking** for testing since models don't run locally.

## Testing Strategies

### 1. Use Remote Bindings (Integration Tests)

Connect to real Workers AI in tests:

```typescript
// vitest.config.ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
        // Enable remote bindings for AI
        experimental_remoteBindings: true,
      },
    },
  },
});
```

### 2. Mock AI Responses (Unit Tests)

For fast, free unit tests:

```typescript
import { vi } from "vitest";

function createMockAI() {
  return {
    run: vi.fn(),
  };
}
```

## Setup

### Install Dependencies

```bash
npm i -D vitest@~3.2.0 @cloudflare/vitest-pool-workers
```

### wrangler.jsonc

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "ai": {
    "binding": "AI"
  }
}
```

## Unit Tests with Mocks

### Text Generation

```typescript
import { describe, it, expect, vi } from "vitest";

describe("Text generation", () => {
  const mockAI = createMockAI();

  it("generates text completion", async () => {
    mockAI.run.mockResolvedValue({
      response: "The capital of France is Paris.",
    });

    const result = await mockAI.run("@cf/meta/llama-2-7b-chat-int8", {
      prompt: "What is the capital of France?",
    });

    expect(result.response).toContain("Paris");
    expect(mockAI.run).toHaveBeenCalledWith(
      "@cf/meta/llama-2-7b-chat-int8",
      expect.objectContaining({ prompt: expect.any(String) })
    );
  });

  it("handles streaming responses", async () => {
    const mockStream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("Hello"));
        controller.enqueue(new TextEncoder().encode(" World"));
        controller.close();
      },
    });

    mockAI.run.mockResolvedValue(mockStream);

    const result = await mockAI.run("@cf/meta/llama-2-7b-chat-int8", {
      prompt: "Say hello",
      stream: true,
    });

    expect(result).toBeInstanceOf(ReadableStream);
  });
});
```

### Text Embeddings

```typescript
describe("Embeddings", () => {
  const mockAI = createMockAI();

  it("generates embeddings for text", async () => {
    const mockEmbedding = new Array(384).fill(0).map(() => Math.random());

    mockAI.run.mockResolvedValue({
      data: [mockEmbedding],
    });

    const result = await mockAI.run("@cf/baai/bge-base-en-v1.5", {
      text: ["Sample text for embedding"],
    });

    expect(result.data).toHaveLength(1);
    expect(result.data[0]).toHaveLength(384);
  });

  it("handles batch embeddings", async () => {
    const mockEmbeddings = [
      new Array(384).fill(0.1),
      new Array(384).fill(0.2),
    ];

    mockAI.run.mockResolvedValue({ data: mockEmbeddings });

    const result = await mockAI.run("@cf/baai/bge-base-en-v1.5", {
      text: ["Text 1", "Text 2"],
    });

    expect(result.data).toHaveLength(2);
  });
});
```

### Image Classification

```typescript
describe("Image classification", () => {
  const mockAI = createMockAI();

  it("classifies image", async () => {
    mockAI.run.mockResolvedValue([
      { label: "cat", score: 0.95 },
      { label: "animal", score: 0.88 },
    ]);

    const imageData = new Uint8Array([/* image bytes */]);
    const result = await mockAI.run("@cf/microsoft/resnet-50", imageData);

    expect(result).toContainEqual(
      expect.objectContaining({ label: "cat" })
    );
  });
});
```

### Image Generation

```typescript
describe("Image generation", () => {
  const mockAI = createMockAI();

  it("generates image from prompt", async () => {
    const mockImageData = new Uint8Array([0x89, 0x50, 0x4E, 0x47]); // PNG header

    mockAI.run.mockResolvedValue(mockImageData);

    const result = await mockAI.run("@cf/stabilityai/stable-diffusion-xl-base-1.0", {
      prompt: "A beautiful sunset",
    });

    expect(result).toBeInstanceOf(Uint8Array);
  });
});
```

### Speech to Text

```typescript
describe("Speech to text", () => {
  const mockAI = createMockAI();

  it("transcribes audio", async () => {
    mockAI.run.mockResolvedValue({
      text: "Hello, this is a test transcription.",
    });

    const audioData = new Uint8Array([/* audio bytes */]);
    const result = await mockAI.run("@cf/openai/whisper", audioData);

    expect(result.text).toContain("Hello");
  });
});
```

## Integration Tests (via SELF)

```typescript
import { SELF } from "cloudflare:test";
import { describe, it, expect, vi, beforeAll } from "vitest";

// Mock AI at module level for SELF tests
vi.mock("../src/ai", () => ({
  generateResponse: vi.fn().mockResolvedValue("Mocked AI response"),
}));

describe("AI Worker endpoints", () => {
  it("generates text via API", async () => {
    const response = await SELF.fetch("http://example.com/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: "Tell me a joke" }),
    });

    expect(response.status).toBe(200);
    const data = await response.json();
    expect(data).toHaveProperty("response");
  });

  it("returns 400 for missing prompt", async () => {
    const response = await SELF.fetch("http://example.com/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });

    expect(response.status).toBe(400);
  });
});
```

## Testing Chat Completions

```typescript
describe("Chat completions", () => {
  const mockAI = createMockAI();

  it("handles multi-turn conversation", async () => {
    mockAI.run.mockResolvedValue({
      response: "I understand you want help with Python.",
    });

    const messages = [
      { role: "system", content: "You are a helpful assistant." },
      { role: "user", content: "I need help with Python." },
    ];

    const result = await mockAI.run("@cf/meta/llama-2-7b-chat-int8", {
      messages,
    });

    expect(mockAI.run).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ messages })
    );
  });
});
```

## Testing Error Handling

```typescript
describe("Error handling", () => {
  const mockAI = createMockAI();

  it("handles model errors", async () => {
    mockAI.run.mockRejectedValue(new Error("Model unavailable"));

    await expect(
      mockAI.run("@cf/meta/llama-2-7b-chat-int8", { prompt: "test" })
    ).rejects.toThrow("Model unavailable");
  });

  it("handles rate limiting", async () => {
    mockAI.run.mockRejectedValue(new Error("Rate limit exceeded"));

    await expect(
      mockAI.run("@cf/meta/llama-2-7b-chat-int8", { prompt: "test" })
    ).rejects.toThrow("Rate limit");
  });
});
```

## Testing Streaming Responses

```typescript
describe("Streaming", () => {
  it("processes streamed tokens", async () => {
    const tokens = ["Hello", " ", "World", "!"];
    let tokenIndex = 0;

    const mockStream = new ReadableStream({
      pull(controller) {
        if (tokenIndex < tokens.length) {
          const data = `data: ${JSON.stringify({ response: tokens[tokenIndex] })}\n\n`;
          controller.enqueue(new TextEncoder().encode(data));
          tokenIndex++;
        } else {
          controller.close();
        }
      },
    });

    const collectedTokens: string[] = [];
    const reader = mockStream.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const text = new TextDecoder().decode(value);
      const match = text.match(/data: (.+)\n/);
      if (match) {
        const json = JSON.parse(match[1]);
        collectedTokens.push(json.response);
      }
    }

    expect(collectedTokens.join("")).toBe("Hello World!");
  });
});
```

## Running Tests

```bash
npx vitest        # Watch mode
npx vitest run    # Single run
```

## Known Limitations

- **No local AI execution** - Models require remote bindings
- **Rate limits** - Remote tests may hit rate limits
- **Cost** - Remote tests incur AI usage costs
- **Latency** - Remote tests are slower than mocked tests

## Best Practices

1. **Use mocks for unit tests** - Fast and free
2. **Use remote bindings sparingly** - For integration validation
3. **Mock response structure** - Match real API responses
4. **Test error scenarios** - Rate limits, model errors
5. **Test streaming** - If using stream: true
6. **Validate input formatting** - Messages, prompts
7. **Test different models** - Each may have different behavior
8. **Cache expensive calls** - Consider caching in tests
