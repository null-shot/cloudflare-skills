# Workflow Steps Reference

Complete reference for step execution, retry strategies, and error handling in Cloudflare Workflows.

## Step Execution

### Basic Step API

```typescript
const result = await step.do(
  stepName: string,
  stepFunction: () => Promise<T>
): Promise<T>
```

**Parameters**:
- `stepName` - Unique identifier for this step (used for caching and logging)
- `stepFunction` - Async function containing the step's logic

**Returns**: The result returned by `stepFunction`

**Key behaviors**:
- Steps are **idempotent** - re-running a completed step returns the cached result
- Step results are **automatically persisted** to durable storage
- Steps execute **sequentially** in the order they appear in `run()`
- Must **always await** step calls - forgetting breaks persistence

### Step with Configuration

```typescript
await step.do(
  stepName: string,
  config: {
    retries?: RetryConfig;
    timeout?: string;
  },
  stepFunction: () => Promise<T>
)
```

## Retry Configuration

### Retry Options

```typescript
type RetryConfig = {
  limit: number;        // Maximum retry attempts (default: 0)
  delay: string;        // Initial delay between retries
  backoff: 'constant' | 'linear' | 'exponential'; // Backoff strategy
}
```

### Backoff Strategies

| Strategy | Delay Pattern | Example (5s initial) |
|----------|---------------|----------------------|
| `constant` | Same delay each time | 5s, 5s, 5s, 5s |
| `linear` | Increases linearly | 5s, 10s, 15s, 20s |
| `exponential` | Doubles each time | 5s, 10s, 20s, 40s |

### Retry Examples

**Exponential backoff for API calls**:
```typescript
await step.do(
  'api call',
  {
    retries: {
      limit: 5,
      delay: '2 second',
      backoff: 'exponential',
    },
  },
  async () => {
    const response = await fetch('https://api.example.com/data');
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    return await response.json();
  },
);
// Retry delays: 2s, 4s, 8s, 16s, 32s
```

**Linear backoff for rate-limited APIs**:
```typescript
await step.do(
  'rate limited call',
  {
    retries: {
      limit: 3,
      delay: '10 second',
      backoff: 'linear',
    },
  },
  async () => {
    // API with rate limits
  },
);
// Retry delays: 10s, 20s, 30s
```

**Constant delay for transient failures**:
```typescript
await step.do(
  'database write',
  {
    retries: {
      limit: 10,
      delay: '1 second',
      backoff: 'constant',
    },
  },
  async () => {
    // Database operation
  },
);
// Retry delays: 1s, 1s, 1s, ... (10 times)
```

## Timeouts

### Timeout Configuration

Set maximum execution time for a step:

```typescript
await step.do(
  'long operation',
  {
    timeout: '15 minutes', // Max time for this step
  },
  async () => {
    // Long-running work
  },
);
```

**Supported time formats**:
- `'30 second'` or `'30 seconds'`
- `'5 minute'` or `'5 minutes'`
- `'2 hour'` or `'2 hours'`

**Timeout behavior**:
- Step throws error when timeout is exceeded
- Can be combined with retries
- Timeout applies to each retry attempt individually

### Combining Retries and Timeouts

```typescript
await step.do(
  'complex operation',
  {
    retries: {
      limit: 3,
      delay: '5 second',
      backoff: 'exponential',
    },
    timeout: '5 minutes', // Per-attempt timeout
  },
  async () => {
    // Each attempt has 5 minutes max
    // If it times out, will retry up to 3 times
  },
);
```

## Sleep Step

Pause workflow execution for a duration:

```typescript
await step.sleep(
  name: string,
  duration: string
): Promise<void>
```

**Example**:
```typescript
await step.sleep('wait for processing', '30 minute');
```

**Use cases**:
- Rate limiting between API calls
- Polling intervals
- Human-in-the-loop workflows waiting for external input
- Scheduled delays in processing pipeline

**Important notes**:
- Sleep does NOT consume compute time - workflow is suspended
- Workflow resumes automatically after duration expires
- Much more efficient than using `setTimeout` or busy-waiting

## Error Handling

### Step-Level Error Handling

```typescript
try {
  await step.do('risky operation', async () => {
    throw new Error('Something went wrong');
  });
} catch (error) {
  // Handle error from the step
  console.error('Step failed:', error);
  
  // Can continue with workflow or throw
  await step.do('fallback operation', async () => {
    // Alternative logic
  });
}
```

### Retry with Error Context

```typescript
await step.do(
  'api with detailed errors',
  {
    retries: { limit: 3, delay: '5 second', backoff: 'exponential' },
  },
  async () => {
    try {
      const response = await fetch('https://api.example.com/data');
      if (!response.ok) {
        const error = await response.text();
        throw new Error(`API error ${response.status}: ${error}`);
      }
      return await response.json();
    } catch (err) {
      // Log error details before rethrowing
      console.error('API call failed:', err);
      throw err; // Retry will happen
    }
  },
);
```

### Graceful Degradation

```typescript
async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
  let result = null;
  
  // Try primary service
  try {
    result = await step.do(
      'primary service',
      { retries: { limit: 2 }, timeout: '10 second' },
      async () => {
        const resp = await fetch('https://primary.example.com/api');
        return await resp.json();
      },
    );
  } catch (error) {
    console.error('Primary service failed:', error);
  }
  
  // Fallback to secondary service
  if (!result) {
    result = await step.do('secondary service', async () => {
      const resp = await fetch('https://secondary.example.com/api');
      return await resp.json();
    });
  }
  
  // Use result...
}
```

## Step Result Persistence

### How Results Are Cached

```typescript
// First execution - runs the function
const data = await step.do('fetch data', async () => {
  console.log('This runs once');
  return { value: 42 };
});

// If workflow is restarted or step is re-executed
const data2 = await step.do('fetch data', async () => {
  console.log('This does NOT run - returns cached result');
  return { value: 42 };
});

console.log(data === data2); // Same cached result
```

**Key points**:
- Step results are identified by step name
- Changing step name creates a new step (will re-execute)
- Results persist for the lifetime of the workflow instance
- Large results (>1MB) may impact performance

### Conditional Steps

```typescript
const shouldProcess = await step.do('check condition', async () => {
  return Math.random() > 0.5;
});

if (shouldProcess) {
  // This step only executes if condition is true
  await step.do('conditional processing', async () => {
    // Work here
  });
}
```

**Important**: Step names must be unique even in conditional branches. If the same step name appears in different branches, use descriptive names:

```typescript
if (condition) {
  await step.do('process-branch-a', async () => { /* ... */ });
} else {
  await step.do('process-branch-b', async () => { /* ... */ });
}
```

## Performance Considerations

### Step Granularity

**Too fine-grained** (many small steps):
```typescript
// ❌ Bad - too many steps
const a = await step.do('add-1', async () => 1);
const b = await step.do('add-2', async () => 2);
const c = await step.do('sum', async () => a + b);
```

**Appropriate granularity**:
```typescript
// ✅ Good - logical units of work
const config = await step.do('fetch config', async () => {
  return await this.env.KV.get('config', 'json');
});

const data = await step.do('process data', async () => {
  // Multiple operations that logically belong together
  const items = await fetchItems();
  const filtered = items.filter(condition);
  return filtered.map(transform);
});
```

### Guidelines

- Group related operations into single steps
- Create separate steps for:
  - Different external API calls
  - Operations that might fail independently
  - Long-running operations that benefit from retry
  - Operations that need different retry/timeout configs

### Result Size Limits

- Keep step results under **1MB** when possible
- Large results increase workflow state size
- Consider storing large data in KV/R2 and passing references:

```typescript
const fileId = await step.do('process large file', async () => {
  const data = await generateLargeData();
  const key = crypto.randomUUID();
  
  // Store in R2, return reference
  await this.env.BUCKET.put(key, data);
  return key; // Small result
});

// Later steps use the reference
await step.do('use file', async () => {
  const data = await this.env.BUCKET.get(fileId);
  // Process data...
});
```

## Advanced Patterns

### Dynamic Step Generation

```typescript
async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
  const items = await step.do('fetch items', async () => {
    return ['item1', 'item2', 'item3'];
  });
  
  // Create steps dynamically based on data
  for (let i = 0; i < items.length; i++) {
    await step.do(`process-item-${i}`, async () => {
      return await processItem(items[i]);
    });
  }
}
```

**Important**: Step names must be deterministic. Don't use random values or timestamps in step names.

### Parallel-Like Processing

While steps execute sequentially, you can batch operations within a step:

```typescript
await step.do('batch process', async () => {
  const results = await Promise.all([
    fetch('https://api1.example.com'),
    fetch('https://api2.example.com'),
    fetch('https://api3.example.com'),
  ]);
  return results;
});
```

**Trade-offs**:
- Faster execution (parallel within step)
- No individual retry per operation
- All-or-nothing - if one fails, entire step retries

### Rate Limiting Pattern

```typescript
async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
  const items = ['a', 'b', 'c', 'd', 'e'];
  
  for (let i = 0; i < items.length; i++) {
    await step.do(`process-${i}`, async () => {
      // Process item
    });
    
    // Rate limit: sleep between items
    if (i < items.length - 1) {
      await step.sleep(`rate-limit-${i}`, '5 second');
    }
  }
}
```
