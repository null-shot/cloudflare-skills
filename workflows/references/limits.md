# Workflow Limits

Complete reference for Cloudflare Workflows limits, including compute, state, concurrency, and rate limits.

## Limit Categories

- **Compute Limits** - CPU time and duration per step
- **State Limits** - Data storage per step and per instance
- **Concurrency Limits** - Simultaneous running instances
- **Rate Limits** - Instance creation rate
- **Structural Limits** - Steps per workflow, configuration sizes
- **Retention Limits** - How long instance state is stored

---

## Compute Limits

### CPU Time per Step

| Plan | Default | Maximum | Notes |
|------|---------|---------|-------|
| Free | 10ms | 10ms | Active CPU time only |
| Paid | 30s | 5 minutes | Configurable via `limits.cpu_ms` |

**Important**: CPU time = active processing time. Time spent waiting on I/O (fetch, KV, D1, etc.) does **not** count.

#### Increasing CPU Limit

Set `limits.cpu_ms` in `wrangler.jsonc`:

```jsonc
{
  "name": "my-workflow",
  "main": "src/index.ts",
  "compatibility_date": "2025-02-11",
  "limits": {
    "cpu_ms": 300000  // 300,000ms = 5 minutes
  },
  "workflows": [
    {
      "name": "my-workflow",
      "binding": "MY_WORKFLOW",
      "class_name": "MyWorkflow"
    }
  ]
}
```

Or in `wrangler.toml`:

```toml
[limits]
cpu_ms = 300_000
```

**Use cases for higher CPU limits**:
- CPU-intensive data processing
- Complex calculations
- Large-scale parsing or transformation

### Duration (Wall Clock) per Step

| Plan | Limit |
|------|-------|
| Free | Unlimited |
| Paid | Unlimited |

**Explanation**: A step can run for hours or days as long as it's waiting on I/O. Only active CPU time counts toward the limit.

**Example**:
```typescript
await step.do('long running', async () => {
  // CPU: ~1ms
  const response = await fetch('https://slow-api.com');
  // Waiting 10 seconds - NOT counted as CPU time
  
  // CPU: ~5ms
  const data = await response.json();
  
  // CPU: ~10ms
  const processed = processData(data);
  
  return processed;
  // Total CPU: ~16ms
  // Total duration: ~10 seconds
});
```

---

## State Limits

### Maximum Persisted State per Step

| Plan | Limit | Notes |
|------|-------|-------|
| Free | 1 MiB | 2^20 bytes = 1,048,576 bytes |
| Paid | 1 MiB | 2^20 bytes = 1,048,576 bytes |

**Critical**: This is the **return value size** of a single `step.do()`. If exceeded, the step fails.

#### Workaround for Large Data

Store large data in R2 or KV and return a reference:

```typescript
// 🔴 Bad: May exceed 1 MiB
const largeData = await step.do('fetch large dataset', async () => {
  const response = await fetch('https://api.example.com/dataset');
  return await response.json(); // Could be 10 MB
});

// ✅ Good: Store externally, return reference
const dataKey = await step.do('fetch and store dataset', async () => {
  const response = await fetch('https://api.example.com/dataset');
  const data = await response.text();
  
  const key = `dataset-${crypto.randomUUID()}`;
  await this.env.BUCKET.put(key, data);
  
  return { key, size: data.length }; // Small reference (<1 KiB)
});

// Later: retrieve when needed
const processed = await step.do('process dataset', async () => {
  const data = await this.env.BUCKET.get(dataKey.key);
  const content = await data.text();
  return processLargeData(content);
});
```

### Maximum State per Workflow Instance

| Plan | Limit |
|------|-------|
| Free | 100 MB |
| Paid | 1 GB |

**This is the total** of all step return values combined across the entire workflow instance.

**Example calculation**:
```typescript
// Step 1 returns 5 MB
const data1 = await step.do('step1', async () => ({ /* 5 MB */ }));

// Step 2 returns 10 MB
const data2 = await step.do('step2', async () => ({ /* 10 MB */ }));

// Step 3 returns 15 MB
const data3 = await step.do('step3', async () => ({ /* 15 MB */ }));

// Total instance state: 30 MB (within 100 MB free limit)
```

**Planning**:
- Free: ~100 steps × 1 MB each
- Paid: ~1000 steps × 1 MB each

### Maximum Event Payload Size

| Plan | Limit |
|------|-------|
| Free | 1 MiB |
| Paid | 1 MiB |

**This is the `params` passed to `create()`**:

```typescript
await env.MY_WORKFLOW.create({
  id: 'instance-123',
  params: {
    // This entire object must be < 1 MiB
    userId: '123',
    config: { /* ... */ },
  },
});
```

**Workaround**: Store large params in KV/D1 first, pass reference:

```typescript
// Store large config
const configKey = crypto.randomUUID();
await env.KV.put(configKey, JSON.stringify(largeConfig));

// Pass small reference
await env.MY_WORKFLOW.create({
  params: { configKey },
});

// In workflow: retrieve config
const config = await step.do('load config', async () => {
  return await this.env.KV.get(event.payload.configKey, 'json');
});
```

---

## Concurrency Limits

### Concurrent Workflow Instances

| Plan | Limit | Notes |
|------|-------|-------|
| Free | 100 | Only `running` instances count |
| Paid | 10,000 | Only `running` instances count |

**Key insight**: Instances in `waiting` state (sleeping, waiting for retry, waiting for event) do **not** count toward this limit.

#### `waiting` Instances

When a workflow is:
- Sleeping via `step.sleep()`
- Waiting for retry after failure
- Waiting for event via `step.waitForEvent()`

The instance transitions to `waiting` state and **does not count** toward concurrency limits.

**Implication**: You can have **millions** of workflows sleeping simultaneously, as long as only 10,000 are actively running at any moment.

#### Example Scenario

```typescript
export class MyWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    // CPU work - instance is 'running'
    await step.do('initial work', async () => {
      // Counts toward concurrency limit
    });
    
    // Sleep for 30 days - instance becomes 'waiting'
    await step.sleep('wait 30 days', '30 days');
    // Does NOT count toward concurrency limit during sleep
    
    // Wake up - instance becomes 'running' again
    await step.do('final work', async () => {
      // Counts toward concurrency limit again
    });
  }
}
```

**Scenario**: 1 million instances sleeping for 30 days
- All 1 million can sleep simultaneously (no concurrency limit)
- When they wake up, only 10,000 can run at once
- Others are queued until running instances complete

### Queued Instances

| Plan | Limit |
|------|-------|
| Free | 100,000 |
| Paid | 1,000,000 |

When concurrency limit is reached, new instances (or waking instances) are queued.

**Queue behavior**:
- Oldest queued instance runs first (best-effort)
- When a running instance completes or transitions to waiting, a queued instance runs

---

## Rate Limits

### Instance Creation Rate

| Plan | Limit |
|------|-------|
| Free | 100 per second |
| Paid | 100 per second |

**What counts**:
- New instance via `create()`
- Instance restarted after hibernation

**Response**: HTTP 429 (Too Many Requests) when exceeded

#### Best Practice: Batch Creation

Use `createBatch()` to improve throughput:

```typescript
// 🔴 Bad: 100 individual requests (may hit rate limit)
for (let i = 0; i < 100; i++) {
  await env.MY_WORKFLOW.create({ params: { id: i } });
}

// ✅ Good: 1 batch request with 100 instances
const instances = Array.from({ length: 100 }, (_, i) => ({
  id: `instance-${i}`,
  params: { id: i },
}));

await env.MY_WORKFLOW.createBatch(instances);
```

**Note**: Each instance in the batch still counts toward the rate limit, but batching improves throughput and reduces likelihood of hitting the limit.

---

## Structural Limits

### Maximum Steps per Workflow

| Plan | Limit | Notes |
|------|-------|-------|
| Free | 1024 | `step.sleep()` does NOT count |
| Paid | 1024 | `step.sleep()` does NOT count |

**Counts toward limit**:
- `step.do()` calls

**Does NOT count**:
- `step.sleep()` calls
- `step.sleepUntil()` calls

#### Handling Large Workflows

If you need more than 1024 steps, split into multiple workflows:

```typescript
// Parent workflow
export class ParentWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    // Orchestrate multiple child workflows
    const child1 = await step.do('start child 1', async () => {
      const instance = await this.env.CHILD_WORKFLOW.create({
        params: { task: 'part-1' },
      });
      return instance.id;
    });
    
    const child2 = await step.do('start child 2', async () => {
      const instance = await this.env.CHILD_WORKFLOW.create({
        params: { task: 'part-2' },
      });
      return instance.id;
    });
    
    // Wait for children to complete
    await step.do('wait for child 1', async () => {
      const instance = await this.env.CHILD_WORKFLOW.get(child1);
      const status = await instance.status();
      if (status.status !== 'complete') {
        throw new Error('Not ready');
      }
      return status.output;
    });
  }
}
```

### Maximum `step.sleep` Duration

| Plan | Limit |
|------|-------|
| Free | 365 days (1 year) |
| Paid | 365 days (1 year) |

**Example**:
```typescript
// Maximum
await step.sleep('wait one year', '365 days');

// ❌ Error: exceeds limit
await step.sleep('wait too long', '400 days');
```

### Workflow Class Definitions per Script

Inherits from Workers script size limits:

| Plan | Limit |
|------|-------|
| Free | 3 MB |
| Paid | 10 MB |

This is the total size of your Worker script including all workflow classes.

### Total Scripts per Account

| Plan | Limit |
|------|-------|
| Free | 100 |
| Paid | 500 |

Shared with Worker scripts limit.

### Maximum Length of Workflow Name

| Plan | Limit | Pattern |
|------|-------|---------|
| All | 64 characters | `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$` |

**Valid names**:
- `my-workflow`
- `user_onboarding`
- `order_processing_v2`

**Invalid names**:
- `-starts-with-dash` (must start with alphanumeric or `_`)
- `has spaces` (no spaces allowed)

### Maximum Length of Instance ID

| Plan | Limit | Pattern |
|------|-------|---------|
| All | 100 characters | `^[a-zA-Z0-9_][a-zA-Z0-9-_]*$` |

**Valid IDs**:
- `order-12345`
- `user_123_task_456`
- `txn-abc123-def456`

**Invalid IDs**:
- `-starts-with-dash`
- `has spaces`
- 101+ characters

### Maximum Subrequests per Instance

| Plan | Limit |
|------|-------|
| Free | 50 per request |
| Paid | 1000 per request |

**What counts as a subrequest**:
- `fetch()` calls to external URLs
- KV operations (`get`, `put`, `list`, etc.)
- D1 queries
- R2 operations
- Calls to other Workers (service bindings)

**Important**: This is per invocation of the workflow, not per step. If your workflow runs multiple times (due to restarts), each invocation gets a fresh subrequest quota.

---

## Retention Limits

### Completed Instance State Retention

| Plan | Limit |
|------|-------|
| Free | 3 days |
| Paid | 30 days |

After a workflow completes (successfully or with error), its state and logs are retained for this duration.

**Implications**:
- Can query instance status and output within retention period
- After retention expires, instance data is deleted
- Can't retrieve output or status after expiration

**Example**:
```typescript
// Instance completes on Jan 1
await env.MY_WORKFLOW.create({ id: 'my-instance' });

// Free plan:
// - Can query until Jan 4
// - After Jan 4: instance not found

// Paid plan:
// - Can query until Jan 31
// - After Jan 31: instance not found
```

---

## Workflow Executions

### Maximum Workflow Executions

| Plan | Limit |
|------|-------|
| Free | 100,000 per day |
| Paid | Unlimited |

**What counts**: Each workflow instance creation counts as one execution.

Shared with Workers daily request limit on Free plan.

---

## Planning for Limits

### Designing Within State Limits

**Scenario**: Processing large datasets

```typescript
// ❌ Bad: Store all data in steps (may hit limits)
const data1 = await step.do('fetch part 1', async () => {
  return await fetchLargeData(1); // 500 MB
});

// ✅ Good: Stream and process in chunks
const result = await step.do('process in chunks', async () => {
  const stream = await this.env.BUCKET.get('large-file').stream();
  const reader = stream.getReader();
  
  let processedCount = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    
    processChunk(value);
    processedCount++;
  }
  
  return { processedCount }; // Small result
});
```

### Designing Within CPU Limits

**Scenario**: CPU-intensive processing

```typescript
// Break into smaller steps
for (let i = 0; i < items.length; i += 100) {
  await step.do(`process batch ${i}`, async () => {
    const batch = items.slice(i, i + 100);
    return processBatch(batch); // Each batch < 30s CPU
  });
}
```

### Designing Within Concurrency Limits

**Scenario**: Processing millions of items

```typescript
// Use sleep to spread out work
export class ItemProcessor extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    // Quick processing
    await step.do('process item', async () => {
      return processItem(event.payload.item);
    });
    
    // Sleep to allow other instances to run
    await step.sleep('rate limit', '1 second');
    // During sleep, doesn't count toward concurrency
  }
}
```

---

## Requesting Limit Increases

Some limits can be increased by request. Complete the [Limit Increase Request Form](https://forms.gle/ukpeZVLWLnKeixDu7).

**Limits that can be increased**:
- Concurrent instances (Paid plan)
- Creation rate (case-by-case)
- Script size (case-by-case)

**Limits that cannot be increased**:
- Per-step state (1 MiB)
- Per-step CPU time (5 minutes max)
- Max steps per workflow (1024)
- Max sleep duration (365 days)

---

## Summary Table

| Limit | Free | Paid | Increasable |
|-------|------|------|-------------|
| **CPU per step** | 10ms | 30s (default) / 5min (max) | Via config |
| **State per step** | 1 MiB | 1 MiB | No |
| **State per instance** | 100 MB | 1 GB | No |
| **Event payload** | 1 MiB | 1 MiB | No |
| **Concurrent instances** | 100 | 10,000 | Via request |
| **Queued instances** | 100,000 | 1,000,000 | Via request |
| **Creation rate** | 100/s | 100/s | Via request |
| **Steps per workflow** | 1024 | 1024 | No |
| **Max sleep duration** | 365 days | 365 days | No |
| **Script size** | 3 MB | 10 MB | Via request |
| **Subrequests** | 50 | 1000 | No |
| **Retention** | 3 days | 30 days | No |
| **Daily executions** | 100k | Unlimited | N/A |

---

## Monitoring and Optimization

### Checking Step State Size

```typescript
await step.do('check size', async () => {
  const data = await fetchData();
  const size = new TextEncoder().encode(JSON.stringify(data)).length;
  
  console.log(`Step state size: ${size} bytes (${(size / 1024 / 1024).toFixed(2)} MiB)`);
  
  if (size > 1048576) {
    console.warn('Exceeds 1 MiB limit!');
  }
  
  return data;
});
```

### Checking CPU Time

Use Worker's CPU time tracking:

```typescript
await step.do('cpu intensive', async () => {
  const start = Date.now();
  
  // CPU work here
  processData();
  
  const duration = Date.now() - start;
  console.log(`Step duration: ${duration}ms`);
});
```

### Optimizing State Usage

**Pattern**: Progressive summarization

```typescript
// Instead of keeping all raw data
let summary = { count: 0, total: 0 };

for (let i = 0; i < 1000; i++) {
  summary = await step.do(`process item ${i}`, async () => {
    const item = await fetchItem(i);
    
    // Update summary, don't keep raw data
    return {
      count: summary.count + 1,
      total: summary.total + item.value,
    };
  });
}

// Final state: 2 numbers instead of 1000 items
```
