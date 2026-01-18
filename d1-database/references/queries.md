# Advanced Query Patterns

Advanced SQL patterns for D1 Database including aggregations, window functions, CTEs, and full-text search.

## Aggregations and GROUP BY

### Basic Aggregations

```typescript
type PostStats = {
  user_id: number;
  user_name: string;
  total_posts: number;
  published_posts: number;
  avg_length: number;
};

const { results } = await env.DB
  .prepare(`
    SELECT 
      u.id as user_id,
      u.name as user_name,
      COUNT(*) as total_posts,
      SUM(CASE WHEN p.published = 1 THEN 1 ELSE 0 END) as published_posts,
      AVG(LENGTH(p.content)) as avg_length
    FROM users u
    INNER JOIN posts p ON u.id = p.user_id
    GROUP BY u.id, u.name
    HAVING total_posts > ?
    ORDER BY total_posts DESC
  `)
  .bind(5)
  .all<PostStats>();
```

### Aggregation Functions

| Function | Description | Example |
|----------|-------------|---------|
| `COUNT(*)` | Count all rows | `SELECT COUNT(*) FROM users` |
| `COUNT(DISTINCT col)` | Count unique values | `SELECT COUNT(DISTINCT user_id) FROM posts` |
| `SUM(col)` | Sum numeric values | `SELECT SUM(price) FROM orders` |
| `AVG(col)` | Average of values | `SELECT AVG(rating) FROM reviews` |
| `MIN(col)` | Minimum value | `SELECT MIN(created_at) FROM posts` |
| `MAX(col)` | Maximum value | `SELECT MAX(price) FROM products` |
| `GROUP_CONCAT(col)` | Concatenate strings | `SELECT GROUP_CONCAT(tag) FROM tags` |

### HAVING Clause

Filter groups after aggregation:

```typescript
// Find users with more than 10 posts in the last month
const { results } = await env.DB
  .prepare(`
    SELECT 
      u.id,
      u.name,
      COUNT(*) as recent_posts
    FROM users u
    INNER JOIN posts p ON u.id = p.user_id
    WHERE p.created_at >= datetime('now', '-1 month')
    GROUP BY u.id, u.name
    HAVING recent_posts > 10
    ORDER BY recent_posts DESC
  `)
  .all();
```

## Window Functions

Window functions perform calculations across rows without collapsing them into groups.

### ROW_NUMBER

Assign sequential numbers to rows:

```typescript
type RankedPost = {
  id: number;
  title: string;
  user_id: number;
  row_num: number;
};

// Get row number for each post per user
const { results } = await env.DB
  .prepare(`
    SELECT 
      id,
      title,
      user_id,
      ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as row_num
    FROM posts
  `)
  .all<RankedPost>();

// Get only the latest post per user
const { results: latestPosts } = await env.DB
  .prepare(`
    WITH ranked_posts AS (
      SELECT 
        id,
        title,
        user_id,
        ROW_NUMBER() OVER (PARTITION BY user_id ORDER BY created_at DESC) as row_num
      FROM posts
    )
    SELECT id, title, user_id
    FROM ranked_posts
    WHERE row_num = 1
  `)
  .all();
```

### RANK and DENSE_RANK

```typescript
// Rank users by post count (with gaps for ties)
const { results } = await env.DB
  .prepare(`
    SELECT 
      u.name,
      COUNT(p.id) as post_count,
      RANK() OVER (ORDER BY COUNT(p.id) DESC) as rank
    FROM users u
    LEFT JOIN posts p ON u.id = p.user_id
    GROUP BY u.id, u.name
  `)
  .all();
```

### LEAD and LAG

Access next/previous row values:

```typescript
type PostWithPrevious = {
  id: number;
  title: string;
  created_at: string;
  previous_title: string | null;
  days_since_previous: number | null;
};

const { results } = await env.DB
  .prepare(`
    SELECT 
      id,
      title,
      created_at,
      LAG(title) OVER (ORDER BY created_at) as previous_title,
      JULIANDAY(created_at) - JULIANDAY(LAG(created_at) OVER (ORDER BY created_at)) as days_since_previous
    FROM posts
    ORDER BY created_at DESC
  `)
  .all<PostWithPrevious>();
```

### Running Totals

```typescript
type OrderWithRunningTotal = {
  id: number;
  amount: number;
  order_date: string;
  running_total: number;
};

const { results } = await env.DB
  .prepare(`
    SELECT 
      id,
      amount,
      order_date,
      SUM(amount) OVER (ORDER BY order_date) as running_total
    FROM orders
    ORDER BY order_date
  `)
  .all<OrderWithRunningTotal>();
```

## Common Table Expressions (CTEs)

CTEs make complex queries more readable and maintainable.

### Basic CTE

```typescript
// Find users and their engagement metrics
const { results } = await env.DB
  .prepare(`
    WITH user_stats AS (
      SELECT 
        u.id,
        u.name,
        COUNT(DISTINCT p.id) as post_count,
        COUNT(DISTINCT c.id) as comment_count
      FROM users u
      LEFT JOIN posts p ON u.id = p.user_id
      LEFT JOIN comments c ON u.id = c.user_id
      GROUP BY u.id, u.name
    )
    SELECT 
      id,
      name,
      post_count,
      comment_count,
      (post_count + comment_count) as total_engagement
    FROM user_stats
    WHERE total_engagement > ?
    ORDER BY total_engagement DESC
  `)
  .bind(10)
  .all();
```

### Recursive CTE

```typescript
type TreeNode = {
  id: number;
  parent_id: number | null;
  name: string;
  level: number;
  path: string;
};

// Get all descendants in a tree structure
const { results } = await env.DB
  .prepare(`
    WITH RECURSIVE descendants AS (
      -- Base case: start node
      SELECT id, parent_id, name, 0 as level, name as path
      FROM categories
      WHERE id = ?
      
      UNION ALL
      
      -- Recursive case: children
      SELECT c.id, c.parent_id, c.name, d.level + 1, d.path || ' > ' || c.name
      FROM categories c
      INNER JOIN descendants d ON c.parent_id = d.id
    )
    SELECT * FROM descendants
    ORDER BY level, name
  `)
  .bind(rootCategoryId)
  .all<TreeNode>();
```

### Multiple CTEs

```typescript
const { results } = await env.DB
  .prepare(`
    WITH 
    active_users AS (
      SELECT id, name
      FROM users
      WHERE last_login >= datetime('now', '-30 days')
    ),
    popular_posts AS (
      SELECT id, user_id, title
      FROM posts
      WHERE view_count > 1000
    )
    SELECT 
      u.name,
      COUNT(p.id) as popular_post_count
    FROM active_users u
    LEFT JOIN popular_posts p ON u.id = p.user_id
    GROUP BY u.id, u.name
    ORDER BY popular_post_count DESC
  `)
  .all();
```

## Subqueries

### IN Subquery

```typescript
// Find users who have published posts
const { results } = await env.DB
  .prepare(`
    SELECT id, name, email
    FROM users
    WHERE id IN (
      SELECT DISTINCT user_id 
      FROM posts 
      WHERE published = 1
    )
  `)
  .all<User>();
```

### EXISTS Subquery

More efficient than IN for checking existence:

```typescript
// Find users who have at least one published post
const { results } = await env.DB
  .prepare(`
    SELECT id, name, email
    FROM users u
    WHERE EXISTS (
      SELECT 1 
      FROM posts p 
      WHERE p.user_id = u.id AND p.published = 1
    )
  `)
  .all<User>();
```

### Scalar Subquery

Return single value from subquery:

```typescript
type UserWithStats = {
  id: number;
  name: string;
  email: string;
  post_count: number;
  latest_post_date: string | null;
};

const { results } = await env.DB
  .prepare(`
    SELECT 
      u.id,
      u.name,
      u.email,
      (SELECT COUNT(*) FROM posts WHERE user_id = u.id) as post_count,
      (SELECT MAX(created_at) FROM posts WHERE user_id = u.id) as latest_post_date
    FROM users u
    ORDER BY u.name
  `)
  .all<UserWithStats>();
```

## Full-Text Search

SQLite supports basic full-text search, but it's limited. For better search, consider using a dedicated search index.

### Basic LIKE Search

```typescript
// Case-insensitive search
const searchTerm = "%searchterm%";

const { results } = await env.DB
  .prepare(`
    SELECT id, title, content
    FROM posts
    WHERE 
      LOWER(title) LIKE LOWER(?) 
      OR LOWER(content) LIKE LOWER(?)
    ORDER BY created_at DESC
    LIMIT 20
  `)
  .bind(searchTerm, searchTerm)
  .all();
```

### Search with Ranking

```typescript
// Prioritize title matches over content matches
const { results } = await env.DB
  .prepare(`
    SELECT 
      id,
      title,
      content,
      CASE 
        WHEN LOWER(title) LIKE LOWER(?) THEN 2
        WHEN LOWER(content) LIKE LOWER(?) THEN 1
        ELSE 0
      END as relevance
    FROM posts
    WHERE relevance > 0
    ORDER BY relevance DESC, created_at DESC
    LIMIT 20
  `)
  .bind(`%${searchTerm}%`, `%${searchTerm}%`)
  .all();
```

## JSON Functions

SQLite has built-in JSON functions for working with JSON data in columns.

### Store and Query JSON

```typescript
// Store JSON data
await env.DB
  .prepare(`
    INSERT INTO settings (user_id, preferences) 
    VALUES (?, ?)
  `)
  .bind(userId, JSON.stringify({
    theme: "dark",
    notifications: true,
    language: "en"
  }))
  .run();

// Query JSON properties
type UserPreferences = {
  user_id: number;
  theme: string;
  notifications: boolean;
};

const { results } = await env.DB
  .prepare(`
    SELECT 
      user_id,
      json_extract(preferences, '$.theme') as theme,
      json_extract(preferences, '$.notifications') as notifications
    FROM settings
    WHERE json_extract(preferences, '$.theme') = ?
  `)
  .bind("dark")
  .all<UserPreferences>();
```

### JSON Array Operations

```typescript
// Store array in JSON column
await env.DB
  .prepare(`
    INSERT INTO users (name, tags) 
    VALUES (?, ?)
  `)
  .bind("Alice", JSON.stringify(["admin", "moderator", "verified"]))
  .run();

// Query JSON array contains value
const { results } = await env.DB
  .prepare(`
    SELECT id, name, tags
    FROM users
    WHERE EXISTS (
      SELECT 1 
      FROM json_each(tags) 
      WHERE value = ?
    )
  `)
  .bind("admin")
  .all();
```

## Date and Time Functions

SQLite has comprehensive date/time functions.

### Date Arithmetic

```typescript
// Posts from last 7 days
const { results } = await env.DB
  .prepare(`
    SELECT * FROM posts
    WHERE created_at >= datetime('now', '-7 days')
    ORDER BY created_at DESC
  `)
  .all();

// Posts from this month
const { results: thisMonth } = await env.DB
  .prepare(`
    SELECT * FROM posts
    WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now')
  `)
  .all();
```

### Date Formatting

```typescript
type PostWithFormattedDate = {
  id: number;
  title: string;
  date: string;          // YYYY-MM-DD
  datetime: string;      // YYYY-MM-DD HH:MM:SS
  day_of_week: string;   // Monday, Tuesday, etc.
};

const { results } = await env.DB
  .prepare(`
    SELECT 
      id,
      title,
      strftime('%Y-%m-%d', created_at) as date,
      datetime(created_at) as datetime,
      strftime('%w', created_at) as day_of_week
    FROM posts
  `)
  .all<PostWithFormattedDate>();
```

### Time-based Grouping

```typescript
type DailyStats = {
  date: string;
  post_count: number;
};

// Group by day
const { results } = await env.DB
  .prepare(`
    SELECT 
      strftime('%Y-%m-%d', created_at) as date,
      COUNT(*) as post_count
    FROM posts
    WHERE created_at >= datetime('now', '-30 days')
    GROUP BY date
    ORDER BY date DESC
  `)
  .all<DailyStats>();

// Group by hour of day
const { results: hourly } = await env.DB
  .prepare(`
    SELECT 
      strftime('%H', created_at) as hour,
      COUNT(*) as post_count
    FROM posts
    GROUP BY hour
    ORDER BY hour
  `)
  .all();
```

## UNION and Set Operations

### UNION

Combine results from multiple queries:

```typescript
// Get all activity (posts and comments)
type Activity = {
  type: string;
  id: number;
  user_id: number;
  content: string;
  created_at: string;
};

const { results } = await env.DB
  .prepare(`
    SELECT 'post' as type, id, user_id, title as content, created_at
    FROM posts
    
    UNION ALL
    
    SELECT 'comment' as type, id, user_id, content, created_at
    FROM comments
    
    ORDER BY created_at DESC
    LIMIT 50
  `)
  .all<Activity>();
```

### INTERSECT and EXCEPT

```typescript
// Users who posted but never commented
const { results } = await env.DB
  .prepare(`
    SELECT DISTINCT user_id FROM posts
    EXCEPT
    SELECT DISTINCT user_id FROM comments
  `)
  .all();

// Users who both posted and commented
const { results: active } = await env.DB
  .prepare(`
    SELECT DISTINCT user_id FROM posts
    INTERSECT
    SELECT DISTINCT user_id FROM comments
  `)
  .all();
```

## Complex JOINs

### Self-Join

```typescript
// Find user pairs who follow each other
const { results } = await env.DB
  .prepare(`
    SELECT 
      f1.follower_id as user1,
      f1.following_id as user2
    FROM follows f1
    INNER JOIN follows f2 
      ON f1.follower_id = f2.following_id 
      AND f1.following_id = f2.follower_id
    WHERE f1.follower_id < f1.following_id
  `)
  .all();
```

### Multiple JOINs

```typescript
type PostWithDetails = {
  post_id: number;
  post_title: string;
  author_name: string;
  category_name: string;
  tag_list: string;
  comment_count: number;
};

const { results } = await env.DB
  .prepare(`
    SELECT 
      p.id as post_id,
      p.title as post_title,
      u.name as author_name,
      c.name as category_name,
      GROUP_CONCAT(t.name) as tag_list,
      COUNT(DISTINCT cm.id) as comment_count
    FROM posts p
    INNER JOIN users u ON p.user_id = u.id
    LEFT JOIN categories c ON p.category_id = c.id
    LEFT JOIN post_tags pt ON p.id = pt.post_id
    LEFT JOIN tags t ON pt.tag_id = t.id
    LEFT JOIN comments cm ON p.id = cm.post_id
    WHERE p.published = 1
    GROUP BY p.id, p.title, u.name, c.name
    ORDER BY p.created_at DESC
  `)
  .all<PostWithDetails>();
```

## Query Optimization Tips

1. **Use EXPLAIN QUERY PLAN**: Understand query execution
   ```sql
   EXPLAIN QUERY PLAN SELECT * FROM users WHERE email = 'test@example.com';
   ```

2. **Create covering indexes**: Index all columns in WHERE, JOIN, and SELECT
   ```sql
   CREATE INDEX idx_posts_user_published ON posts(user_id, published, created_at);
   ```

3. **Avoid SELECT \***: Only select needed columns

4. **Use EXISTS instead of COUNT**: For checking existence
   ```sql
   -- Fast
   SELECT EXISTS(SELECT 1 FROM posts WHERE user_id = ?)
   
   -- Slow
   SELECT COUNT(*) FROM posts WHERE user_id = ?
   ```

5. **Limit result sets**: Always use LIMIT for potentially large results

6. **Use BETWEEN for ranges**: More efficient than >= AND <=
   ```sql
   WHERE created_at BETWEEN ? AND ?
   ```

7. **Denormalize when appropriate**: Store computed values if read-heavy
