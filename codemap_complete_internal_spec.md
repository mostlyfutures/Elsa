# Codemap: Complete Internal Specification

## 1. Core Architecture

### 1.1 On-Disk Format (`~/.winsurf/cache/codemap.v2.*`)
- **File Structure**:
  - `codemap.v2.index`: Primary symbol index (SQLite)
  - `codemap.v2.blobs`: Compressed binary blobs (custom format)
  - `codemap.v2.transactions`: Write-ahead log for crash recovery

### 1.2 Symbol Index (SQLite Schema)
```sql
CREATE TABLE symbols (
  id INTEGER PRIMARY KEY,
  name TEXT COLLATE NOCASE,
  kind INTEGER,  -- enum: function, class, variable, etc.
  scope TEXT,    -- fully qualified scope
  file_id INTEGER,
  line INTEGER,
  col INTEGER,
  flags INTEGER  -- visibility, static, etc.
);

CREATE TABLE files (
  id INTEGER PRIMARY KEY,
  path TEXT UNIQUE,
  mtime INTEGER,
  size INTEGER,
  hash BLOB(32)  -- blake3 hash
);

-- Roaring Bitmap Index
CREATE TABLE symbol_occurrences (
  symbol_id INTEGER,
  file_id INTEGER,
  bitset BLOB,
  PRIMARY KEY (symbol_id, file_id)
);
```

## 2. Roaring Bitmap Implementation

### 2.1 Bitmap Layout
```
[Header: 16 bytes]
  - Magic: 0xBA5EBA11 (4 bytes)
  - Version: 2 (2 bytes)
  - Container Count (2 bytes)
  - Reserved (8 bytes)

[Container 0]
  - Type (2 bits): ARRAY/BITMAP/RUN
  - Card (14 bits): Cardinality
  - Payload (variable)
```

### 2.2 Delta Compression
- Uses XOR-based delta encoding between versions
- Compressed using zstd with custom dictionary
- Block size: 4096 bits (512 bytes)
- Special handling for sparse regions with RLE (Run-Length Encoding)

## 3. Query DSL Grammar

### 3.1 Core Grammar (EBNF)
```
query       = or_expr
or_expr     = and_expr ("OR" and_expr)*
and_expr    = not_expr ("AND" not_expr?)*
not_expr    = ["NOT"] atom
atom        = "(" query ")" | term | modifier
exact       = '"' [^"]* '"'
term        = [^\s:()]+ | exact
modifier    = "@" modifier_name ":" (term | "(" term+ ")")
modifier_name = "kind" | "file" | "scope" | "dist<=" | "shadowed"
```

### 3.2 Special Operators
- `@kind:`: Symbol kind filter (function, class, etc.)
- `@file:`: File pattern matching
- `@scope:`: Scope qualification
- `@dist<=N`: Proximity search within N tokens
- `@shadowed`: Find shadowed declarations

## 4. Tree-sitter Integration

### 4.1 Parser Hooks
- Custom WASM-based Tree-sitter runtime
- Incremental parsing with minimal reparse regions
- On-change events trigger selective reindexing

### 4.2 Ghost Node System
```typescript
interface GhostNode {
  type: string;
  text: string;
  startPosition: Point;
  endPosition: Point;
  children: GhostNode[];
  parent: GhostNode | null;
  injectAt: (node: TSNode) => void;
  remove: () => void;
}
```

## 5. WebSocket Protocol

### 5.1 Message Types
- `0x17`: Full document sync
- `0x22`: Delta update
- `0x3B`: Query response
- `0x4F`: Error response

### 5.2 Message Format
```
[Header: 8 bytes]
  - Version (1 byte)
  - Type (1 byte)
  - Flags (1 byte)
  - Reserved (1 byte)
  - Payload Length (4 bytes, big-endian)
[Payload: variable]
```

## 6. MCP Endpoints

### 6.1 Core Endpoints
- `GET /mcp/v1/symbols`: Query symbols
- `POST /mcp/v1/index`: Trigger reindexing
- `WS /mcp/v1/updates`: Real-time updates

### 6.2 Authentication
- JWT-based auth with 15m expiry
- Scope-based permissions
- Rate limiting per client

## 7. TypeScript Internals

### 7.1 Core Interfaces
```typescript
interface CodeMapSymbol {
  id: string;
  name: string;
  kind: SymbolKind;
  location: Location;
  scope: string;
  metadata: Record<string, unknown>;
}

interface QueryResult {
  symbols: CodeMapSymbol[];
  stats: {
    indexTime: number;
    resultCount: number;
    cacheHit: boolean;
  };
}
```

## 8. Rank-Select Queries

### 8.1 Algorithm
1. Parse query into AST
2. Build DNF (Disjunctive Normal Form)
3. Execute each conjunction in parallel
4. Merge results using bitmap operations
5. Apply ranking:
   - Exact matches first
   - Then prefix matches
   - Then fuzzy matches
   - Sorted by relevance score

## 9. Stale Index Detection

### 9.1 Detection Strategy
- File system watchers for changes
- Background checksum verification
- Periodic full validation (configurable)

### 9.2 Reindexing
- Incremental by default
- Full reindex on version change
- Throttled background processing
- Priority queue based on access patterns

## 10. Performance Characteristics

### 10.1 Indexing
- ~10K LOC/second on modern hardware
- Memory usage: ~100MB per 1M LOC
- Disk usage: ~20% of source size

### 10.2 Query Latency
- Simple queries: <10ms
- Complex queries: <100ms
- Large projects: <1s (worst case)

## 11. Security Considerations

### 11.1 Input Validation
- All queries are parameterized
- Path traversal protection
- Memory limits on query execution

### 11.2 Access Control
- File system sandboxing
- Read-only by default
- Explicit opt-in for write operations

## 12. Debugging & Monitoring

### 12.1 Metrics
- Query performance
- Cache hit rates
- Memory usage
- Indexing throughput

### 12.2 Debug Tools
- Query explainer
- Index inspector
- Performance profiler

## 13. Future Extensions

### 13.1 Planned Features
- Cross-project references
- Semantic code navigation
- AI-powered code search
- Distributed indexing

### 13.2 Research Directions
- Incremental type checking
- Probabilistic code completion
- Automated refactoring support
