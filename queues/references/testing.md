# Testing Queues with Vitest

Use `@cloudflare/vitest-pool-workers` to test Workers that produce and consume Queue messages.

## Setup

### Install Dependencies

```bash
npm i -D vitest@~3.2.0 @cloudflare/vitest-pool-workers
```

### vitest.config.ts

```typescript
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.jsonc" },
      },
    },
  },
});
```

### wrangler.jsonc

```jsonc
{
  "name": "my-worker",
  "main": "src/index.ts",
  "compatibility_date": "2025-01-01",
  "queues": {
    "producers": [
      { "binding": "MY_QUEUE", "queue": "my-queue" }
    ],
    "consumers": [
      { "queue": "my-queue", "max_batch_size": 10 }
    ]
  }
}
```

## Testing Queue Handlers

Use `createMessageBatch()` and `getQueueResult()` from `cloudflare:test`:

```typescript
import { env, createMessageBatch, createExecutionContext, getQueueResult } from "cloudflare:test";
import { describe, it, expect } from "vitest";
import worker from "../src/index";

describe("Queue handler", () => {
  it("processes messages successfully", async () => {
    const batch = createMessageBatch("MY_QUEUE", [
      { id: "msg-1", timestamp: new Date(), body: { action: "process", data: "test" } },
      { id: "msg-2", timestamp: new Date(), body: { action: "process", data: "test2" } },
    ]);
    const ctx = createExecutionContext();

    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toContain("msg-1");
    expect(result.explicitAcks).toContain("msg-2");
    expect(result.explicitRetries).toHaveLength(0);
  });

  it("retries failed messages", async () => {
    const batch = createMessageBatch("MY_QUEUE", [
      { id: "msg-1", timestamp: new Date(), body: { action: "fail" } },
    ]);
    const ctx = createExecutionContext();

    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitRetries).toContain("msg-1");
    expect(result.explicitAcks).toHaveLength(0);
  });
});
```

## Testing Queue Producers

```typescript
import { SELF, env } from "cloudflare:test";
import { describe, it, expect } from "vitest";

describe("Queue producer", () => {
  it("sends message to queue via API", async () => {
    const response = await SELF.fetch("http://example.com/enqueue", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ task: "process-order", orderId: 123 }),
    });

    expect(response.status).toBe(202);
    const result = await response.json();
    expect(result).toHaveProperty("queued", true);
  });
});
```

## Testing Message Processing Logic

```typescript
describe("Message processing", () => {
  it("handles different message types", async () => {
    const messages = [
      { id: "order-1", timestamp: new Date(), body: { type: "order", orderId: 1 } },
      { id: "email-1", timestamp: new Date(), body: { type: "email", to: "test@example.com" } },
      { id: "notify-1", timestamp: new Date(), body: { type: "notification", userId: 123 } },
    ];

    const batch = createMessageBatch("MY_QUEUE", messages);
    const ctx = createExecutionContext();

    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);

    // All messages should be acknowledged
    expect(result.explicitAcks).toHaveLength(3);
  });

  it("handles malformed messages", async () => {
    const batch = createMessageBatch("MY_QUEUE", [
      { id: "bad-1", timestamp: new Date(), body: "invalid-not-json-object" },
    ]);
    const ctx = createExecutionContext();

    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);

    // Malformed messages should be acked to prevent infinite retries
    expect(result.explicitAcks).toContain("bad-1");
  });
});
```

## Testing with Side Effects

```typescript
describe("Queue with KV side effects", () => {
  it("updates KV on message processing", async () => {
    const batch = createMessageBatch("MY_QUEUE", [
      { id: "msg-1", timestamp: new Date(), body: { key: "test-key", value: "processed" } },
    ]);
    const ctx = createExecutionContext();

    await worker.queue(batch, env, ctx);
    await getQueueResult(batch, ctx);

    // Verify side effect
    const stored = await env.MY_KV.get("test-key");
    expect(stored).toBe("processed");
  });
});
```

## Testing Batch Processing

```typescript
describe("Batch processing", () => {
  it("processes large batches", async () => {
    const messages = Array.from({ length: 10 }, (_, i) => ({
      id: `msg-${i}`,
      timestamp: new Date(),
      body: { index: i },
    }));

    const batch = createMessageBatch("MY_QUEUE", messages);
    const ctx = createExecutionContext();

    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toHaveLength(10);
  });

  it("handles partial batch failures", async () => {
    const messages = [
      { id: "success-1", timestamp: new Date(), body: { shouldFail: false } },
      { id: "fail-1", timestamp: new Date(), body: { shouldFail: true } },
      { id: "success-2", timestamp: new Date(), body: { shouldFail: false } },
    ];

    const batch = createMessageBatch("MY_QUEUE", messages);
    const ctx = createExecutionContext();

    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);

    expect(result.explicitAcks).toContain("success-1");
    expect(result.explicitAcks).toContain("success-2");
    expect(result.explicitRetries).toContain("fail-1");
  });
});
```

## Testing Dead Letter Behavior

```typescript
describe("Dead letter handling", () => {
  it("moves to DLQ after max retries", async () => {
    const message = {
      id: "dlq-msg",
      timestamp: new Date(),
      body: { alwaysFails: true },
      attempts: 3, // Simulate max retries reached
    };

    const batch = createMessageBatch("MY_QUEUE", [message]);
    const ctx = createExecutionContext();

    await worker.queue(batch, env, ctx);
    const result = await getQueueResult(batch, ctx);

    // Message should be acked (moved to DLQ, not retried)
    expect(result.explicitAcks).toContain("dlq-msg");
  });
});
```

## Example Queue Handler

```typescript
// src/index.ts
interface Env {
  MY_QUEUE: Queue;
  MY_KV: KVNamespace;
}

interface QueueMessage {
  type: string;
  data: unknown;
}

export default {
  async queue(batch: MessageBatch<QueueMessage>, env: Env, ctx: ExecutionContext): Promise<void> {
    for (const message of batch.messages) {
      try {
        await processMessage(message.body, env);
        message.ack();
      } catch (error) {
        console.error("Message processing failed:", error);
        
        // Retry up to 3 times
        if (message.attempts < 3) {
          message.retry();
        } else {
          // Move to DLQ (ack to prevent infinite retries)
          await env.MY_KV.put(`dlq:${message.id}`, JSON.stringify(message.body));
          message.ack();
        }
      }
    }
  },
};

async function processMessage(body: QueueMessage, env: Env): Promise<void> {
  switch (body.type) {
    case "order":
      await processOrder(body.data, env);
      break;
    case "email":
      await sendEmail(body.data, env);
      break;
    default:
      console.log("Unknown message type:", body.type);
  }
}
```

## Running Tests

```bash
npx vitest        # Watch mode
npx vitest run    # Single run
```

## Local Development

```bash
# Run producer and consumer together
wrangler dev -c wrangler.jsonc

# Or run separately
wrangler dev -c producer.wrangler.jsonc -c consumer.wrangler.jsonc
```

## Known Issues

- **Pull-based consumers** not fully supported locally
- **Consumer concurrency** not simulated locally
- **`--remote` mode** doesn't simulate local queues
- **Retry backoffs** may behave differently locally

## Best Practices

1. **Test happy path and error cases** separately
2. **Use `getQueueResult()`** to verify acks/retries
3. **Test batch processing** with multiple messages
4. **Test partial failures** within batches
5. **Test dead letter logic** with max retries
6. **Use isolated storage** for test independence
7. **Test side effects** (KV writes, API calls, etc.)
8. **Handle unknown message types** gracefully
