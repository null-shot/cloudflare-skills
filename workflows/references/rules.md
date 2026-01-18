# Rules of Workflows

Comprehensive guide to building resilient and correct Workflows. A Workflow contains one or more steps, each being a self-contained, individually retriable component.

## Critical Rules Summary

| Rule | Why It Matters |
|------|----------------|
| Ensure API calls are idempotent | Steps may retry multiple times |
| Make steps granular | Enables individual retry and better durability |
| Don't rely on state outside steps | Memory is lost during hibernation |
| No side effects outside `step.do` | Code outside steps may execute multiple times |
| Don't mutate incoming events | Changes aren't persisted |
| Name steps deterministically | Non-deterministic names prevent caching |
| Wrap `Promise.race()` in `step.do` | Ensures consistent caching behavior |
| Instance IDs must be unique | IDs are permanent identifiers |
| Always `await` your steps | Prevents dangling promises and lost state |
| Use conditional logic carefully | Must be based on deterministic values |
| Batch multiple invocations | Reduces API calls and improves throughput |
| Keep step returns under 1 MiB | Per-step state limit |

---

## Rule 1: Ensure API/Binding Calls Are Idempotent

**Problem**: Steps may be retried multiple times due to failures, timeouts, or infrastructure restarts.

**Solution**: Always check if an operation has already been completed before executing non-idempotent operations.

### Example: Payment Processing

```typescript
export class MyWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const customer_id = 123456;
    
    // ✅ Good: Check before charging
    await step.do(
      `charge ${customer_id} for its monthly subscription`,
      async () => {
        // Check if customer was already charged
        const subscription = await fetch(
          `https://payment.processor/subscriptions/${customer_id}`
        ).then((res) => res.json());
        
        // Return early if already charged
        if (subscription.charged) {
          return;
        }
        
        // Non-idempotent call - protected by check above
        return await fetch(
          `https://payment.processor/subscriptions/${customer_id}`,
          {
            method: 'POST',
            body: JSON.stringify({ amount: 10.0 }),
          }
        );
      }
    );
  }
}
```

**Why**: If the payment processor commits the charge but the connection fails before responding, a retry would double-charge without the check.

### Bad Example

```typescript
// 🔴 Bad: No idempotency check
await step.do('charge customer', async () => {
  // This could charge customer multiple times on retry
  return await fetch('https://payment.processor/charge', {
    method: 'POST',
    body: JSON.stringify({ amount: 10.0 }),
  });
});
```

---

## Rule 2: Make Your Steps Granular

**Problem**: Combining multiple unrelated operations in one step reduces durability.

**Solution**: Each step should do one logical unit of work. Separate unrelated API calls into individual steps.

### Good Example

```typescript
export class MyWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    // ✅ Good: Separate, self-contained steps
    const httpCat = await step.do('get cutest cat from KV', async () => {
      return await env.KV.get('cutest-http-cat');
    });
    
    const image = await step.do('fetch cat image from http.cat', async () => {
      return await fetch(`https://http.cat/${httpCat}`);
    });
  }
}
```

**Benefits**:
- If `http.cat` is down, only the second step retries (not the KV call)
- Different retry/timeout policies per step
- Better observability - see which step failed

### Bad Example

```typescript
// 🔴 Bad: Two service calls in one step
const image = await step.do('get cutest cat from KV', async () => {
  const httpCat = await env.KV.get('cutest-http-cat');
  return fetch(`https://http.cat/${httpCat}`); // If this fails, KV is called again
});
```

### Guidelines

**Do**:
- ✅ Minimize API/binding calls per step (1-2 max)
- ✅ Separate unrelated operations
- ✅ Each step = one transaction/unit of work

**Don't**:
- 🔴 Encapsulate entire logic in one step
- 🔴 Call separate services in same step
- 🔴 Too many service calls in one step
- 🔴 Too much CPU-intensive work in single step

---

## Rule 3: Don't Rely on State Outside of a Step

**Problem**: Workflows may hibernate and lose all in-memory state.

**Solution**: Build top-level state exclusively from `step.do` return values.

### Bad Example

```typescript
// 🔴 Bad: State stored outside steps is lost on hibernation
export class MyWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const imageList: string[] = []; // ⚠️ Lost on hibernation
    
    await step.do('get first cat', async () => {
      const httpCat = await env.KV.get('cutest-http-cat-1');
      imageList.push(httpCat); // This is lost!
    });
    
    await step.do('get second cat', async () => {
      const httpCat = await env.KV.get('cutest-http-cat-2');
      imageList.push(httpCat); // This is lost!
    });
    
    // Hibernation happens here
    await step.sleep('wait', '3 hours');
    
    // imageList is now empty - this will fail
    await step.do('download random cat', async () => {
      const randomCat = imageList[0]; // undefined!
      return await fetch(`https://http.cat/${randomCat}`);
    });
  }
}
```

### Good Example

```typescript
// ✅ Good: State built from step returns
export class MyWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    const imageList = await Promise.all([
      step.do('get first cat', async () => {
        return await env.KV.get('cutest-http-cat-1');
      }),
      step.do('get second cat', async () => {
        return await env.KV.get('cutest-http-cat-2');
      }),
    ]);
    
    // Hibernation happens here
    await step.sleep('wait', '3 hours');
    
    // imageList is reconstructed from step cache - this works!
    await step.do('download random cat', async () => {
      const randomCat = imageList[0]; // Defined!
      return await fetch(`https://http.cat/${randomCat}`);
    });
  }
}
```

**Key principle**: If you need it after a potential hibernation, it must come from a step return value.

---

## Rule 4: Avoid Doing Side Effects Outside of `step.do`

**Problem**: Code outside steps may execute multiple times if the engine restarts.

**Solution**: Wrap all side effects (API calls, instance creation, non-deterministic functions) in `step.do`.

### Bad Examples

```typescript
export class MyWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    // 🔴 Bad: Creating instances outside steps
    // Might create multiple instances if engine restarts
    const myNewInstance = await this.env.ANOTHER_WORKFLOW.create();
    
    // 🔴 Bad: Non-deterministic functions outside steps
    // Different results on restart = different code paths
    const myRandom = Math.random();
    if (myRandom > 0.5) {
      // This path might not be taken on restart
    }
    
    // ⚠️ Warning: This log may appear multiple times
    console.log('This might be logged more than once');
    
    await step.do('do stuff', async () => {
      // This log appears exactly once
      console.log('successfully did stuff');
    });
  }
}
```

### Good Examples

```typescript
export class MyWorkflow extends WorkflowEntrypoint {
  async run(event: WorkflowEvent<Params>, step: WorkflowStep) {
    // ✅ Good: Wrap non-deterministic function in step
    const myRandom = await step.do('create random number', async () => {
      return Math.random();
    });
    
    // ✅ Good: No side effects - safe outside steps
    const db = createDBConnection(this.env.DB_URL, this.env.DB_TOKEN);
    
    // ✅ Good: Side effects inside step
    const myNewInstance = await step.do(
      'create workflow instance',
      async () => {
        return await this.env.ANOTHER_WORKFLOW.create();
      }
    );
  }
}
```

**Rule of thumb**: If it has a side effect or is non-deterministic, put it in a step.

---

## Rule 5: Don't Mutate Your Incoming Events

**Problem**: Changes to the `event` object are not persisted across steps or restarts.

**Solution**: Return data from steps and use that state in subsequent steps.

### Bad Example

```typescript
// 🔴 Bad: Mutating event
await step.do('bad step', async () => {
  let userData = await env.KV.get(event.payload.user);
  event.payload = userData; // Lost on next step!
});
```

### Good Example

```typescript
// ✅ Good: Return state from step
let userData = await step.do('good step', async () => {
  return await env.KV.get(event.payload.user);
});

let someOtherData = await step.do('following step', async () => {
  // Access userData here - always available
  console.log(userData.name);
});
```

---

## Rule 6: Name Steps Deterministically

**Problem**: Non-deterministic step names prevent caching, causing unnecessary re-execution.

**Solution**: Use static strings or deterministically constructed names based on step inputs.

### Bad Examples

```typescript
// 🔴 Bad: Timestamp in name
await step.do(`step #1 running at: ${Date.now()}`, async () => {
  // This step re-runs every time
});

// 🔴 Bad: Random value in name
await step.do(`step-${Math.random()}`, async () => {
  // This step re-runs every time
});
```

### Good Examples

```typescript
// ✅ Good: Static, deterministic name
let state = await step.do('fetch user data from KV', async () => {
  let userData = await env.KV.get(event.payload.user);
  console.log(`fetched at ${Date.now()}`); // Log dynamic values instead
  return userData;
});

// ✅ Good: Deterministically dynamic names
let catList = await step.do('get cat list from KV', async () => {
  return await env.KV.get('cat-list');
});

// catList is stable step output, so this is deterministic
for (const cat of catList) {
  await step.do(`get cat: ${cat}`, async () => {
    return await env.KV.get(cat);
  });
}
```

**Key**: Step names act as cache keys. Same name = retrieve cached result instead of re-running.

---

## Rule 7: Take Care with `Promise.race()` and `Promise.any()`

**Problem**: Steps inside `Promise.race()` may cache inconsistently across restarts.

**Solution**: Wrap `Promise.race()` or `Promise.any()` in a `step.do` for deterministic caching.

### Bad Example

```typescript
// 🔴 Bad: Promise.race not wrapped in step
const race_return = await Promise.race([
  step.do('Promise first race', async () => {
    await sleep(1000);
    return 'first';
  }),
  step.do('Promise second race', async () => {
    return 'second';
  }),
]);

await step.sleep('Sleep step', '2 hours');

// After hibernation, race_return might have different value!
```

### Good Example

```typescript
// ✅ Good: Promise.race wrapped in step
const race_return = await step.do('Promise step', async () => {
  return await Promise.race([
    step.do('Promise first race', async () => {
      await sleep(1000);
      return 'first';
    }),
    step.do('Promise second race', async () => {
      return 'second';
    }),
  ]);
});

await step.sleep('Sleep step', '2 hours');

// race_return has consistent cached value
```

---

## Rule 8: Instance IDs Are Unique

**Problem**: Reusing IDs makes it hard to track individual workflow runs.

**Solution**: Use unique IDs (transaction IDs, composite IDs, or UUIDs).

### Bad Example

```typescript
// 🔴 Bad: User ID as instance ID
let userId = getUserId(req);
let badInstance = await env.MY_WORKFLOW.create({
  id: userId, // Not unique across multiple runs!
  params: payload,
});
```

### Good Examples

```typescript
// ✅ Good: Transaction ID (naturally unique)
let instanceId = getTransactionId();
let goodInstance = await env.MY_WORKFLOW.create({
  id: instanceId,
  params: payload,
});

// ✅ Good: Composite ID with random component
instanceId = `${getUserId(req)}-${crypto.randomUUID().slice(0, 6)}`;
await addNewInstanceToDB(userId, instanceId); // Track mapping
let goodInstance = await env.MY_WORKFLOW.create({
  id: instanceId,
  params: payload,
});
```

**Why**: Instance IDs are permanent. They associate logs, metrics, state, and status to a specific run, even after completion.

---

## Rule 9: `await` Your Steps

**Problem**: Not awaiting steps creates dangling Promises, causing lost state and swallowed errors.

**Solution**: Always use `await` with `step.do` and `step.sleep`.

### Bad Example

```typescript
// 🔴 Bad: No await
const issues = step.do('fetch issues from GitHub', async () => {
  // Return happens before this completes
  let issues = await getIssues(event.payload.repoName);
  return issues;
});
// issues is a Promise, not the actual data!
```

### Good Example

```typescript
// ✅ Good: Properly awaited
const issues = await step.do('fetch issues from GitHub', async () => {
  let issues = await getIssues(event.payload.repoName);
  return issues;
});
// issues is the actual data
```

**Consequences of forgetting `await`**:
- Subsequent code runs before step completes
- Errors are silently swallowed
- Return values (state) are lost
- Workflow may complete before step finishes

---

## Rule 10: Use Conditional Logic Carefully

**Problem**: Non-deterministic conditions outside steps can behave differently on restart.

**Solution**: Base conditions on deterministic values (event payload or step outputs).

### Bad Example

```typescript
// 🔴 Bad: Non-deterministic condition outside step
if (Math.random() > 0.5) {
  await step.do('maybe do something', async () => {});
}
// On restart, might take different path!
```

### Good Examples

```typescript
// ✅ Good: Condition based on step output
const config = await step.do('fetch config', async () => {
  return await this.env.KV.get('feature-flags', { type: 'json' });
});

if (config.enableEmailNotifications) {
  await step.do('send email', async () => {
    // Send email logic
  });
}

// ✅ Good: Condition based on event payload
if (event.payload.userType === 'premium') {
  await step.do('premium processing', async () => {
    // Premium-only logic
  });
}

// ✅ Good: Wrap non-deterministic value in step
const shouldProcess = await step.do('decide randomly', async () => {
  return Math.random() > 0.5;
});

if (shouldProcess) {
  await step.do('conditionally do something', async () => {});
}
```

---

## Rule 11: Batch Multiple Workflow Invocations

**Problem**: Creating instances one-by-one is slow and more likely to hit rate limits.

**Solution**: Use `createBatch()` to create multiple instances in one request.

### Bad Example

```typescript
// 🔴 Bad: Create one by one
let instances = [
  { id: 'user1', params: { name: 'John' } },
  { id: 'user2', params: { name: 'Jane' } },
  { id: 'user3', params: { name: 'Alice' } },
];

for (let instance of instances) {
  await env.MY_WORKFLOW.create({
    id: instance.id,
    params: instance.params,
  });
}
```

### Good Example

```typescript
// ✅ Good: Batch creation
let instances = [
  { id: 'user1', params: { name: 'John' } },
  { id: 'user2', params: { name: 'Jane' } },
  { id: 'user3', params: { name: 'Alice' } },
];

let createdInstances = await env.MY_WORKFLOW.createBatch(instances);
```

**Benefits**:
- Higher throughput
- Less likely to hit rate limits
- Faster overall execution

---

## Rule 12: Keep Step Return Values Under 1 MiB

**Problem**: Each step can persist only 1 MiB of state. Exceeding this causes step failure.

**Solution**: Store large data in R2/KV and return only a reference.

### Bad Example

```typescript
// 🔴 Bad: Returning large response (may exceed 1 MiB)
const largeData = await step.do('fetch large dataset', async () => {
  const response = await fetch('https://api.example.com/large-dataset');
  return await response.json(); // Could exceed 1 MiB
});
```

### Good Example

```typescript
// ✅ Good: Store large data externally, return reference
const dataRef = await step.do('fetch and store large dataset', async () => {
  const response = await fetch('https://api.example.com/large-dataset');
  const data = await response.json();
  
  // Store in R2
  const key = crypto.randomUUID();
  await this.env.MY_BUCKET.put(key, JSON.stringify(data));
  
  return { key }; // Small reference
});

// Retrieve when needed
const data = await step.do('process dataset', async () => {
  const stored = await this.env.MY_BUCKET.get(dataRef.key);
  return processData(await stored.json());
});
```

**Limit**: 1 MiB (2^20 bytes = 1,048,576 bytes) per step return value.

---

## Summary Table

| Rule | Bad Pattern | Good Pattern |
|------|-------------|--------------|
| Idempotency | Charge without checking | Check if charged first |
| Granularity | Multiple APIs in one step | One API per step |
| State | Store in variables | Return from steps |
| Side effects | `Math.random()` outside step | Wrap in `step.do` |
| Events | Mutate `event.payload` | Return new state |
| Step names | `step-${Date.now()}` | `"fetch-user-data"` |
| Promise.race | Race at top level | Wrap race in step |
| Instance IDs | Use user ID | Use transaction ID |
| Await | `step.do(...)` | `await step.do(...)` |
| Conditions | `if (Math.random())` outside | Wrap random in step |
| Batching | Loop with `create()` | Use `createBatch()` |
| State size | Return 10MB object | Store in R2, return key |

---

## Additional Best Practices

### Hibernation is Automatic

Workflows hibernate during:
- `step.sleep()` calls
- Long retry delays
- Waiting for events (`step.waitForEvent()`)

**Implication**: Any in-memory state is lost. Only step return values persist.

### Engine Restarts Are Normal

The workflow engine may restart:
- During maintenance
- To rebalance load
- After crashes

**Implication**: Code outside steps may run multiple times. Steps that completed are not re-run (cached).

### Step Names Are Cache Keys

- Same step name = retrieve cached result
- Different step name = run the step
- Changing step name invalidates cache

**Use case**: To force re-execution, change the step name (e.g., append version: `"fetch-data-v2"`).

### Total Instance State Limit

- Per-step limit: 1 MiB
- Total instance state limit: 100 MB (Free) / 1 GB (Paid)

**Plan accordingly**: If you have many steps returning max size, you could hit the total limit.
