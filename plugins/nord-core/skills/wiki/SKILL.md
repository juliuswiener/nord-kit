---
name: wiki
description: LLM Wiki — persistent markdown knowledge base that compounds across sessions (Karpathy model)
triggers: ["wiki", "wiki this", "wiki add", "wiki lint", "wiki query"]
---

# Wiki

Persistent, self-maintained markdown knowledge base for project and session knowledge. Inspired by Karpathy's LLM Wiki concept.

## Operations

### Ingest
Process knowledge into wiki pages. A single ingest can touch multiple pages.

```
wiki_ingest({ title: "Auth Architecture", content: "...", tags: ["auth", "architecture"], category: "architecture", confidence: "high" })
```

**Set `confidence` deliberately (anchored — B, see BEHAVIOUR.md).** Wiki notes compound across sessions —
a `low` guess written today reads as fact months later, so anchor it to evidence tier, not gut:
- **high** — directly observed / verified THIS session: code read, command run, output measured (`explicit`).
- **medium** — inferred, or a single / second-hand source.
- **low** — speculative / unconfirmed. Mark it so future readers (and `wiki_lint`) can down-weight it.
Never write `high` for something you didn't verify this session.

### Query
Search across all wiki pages by keywords and tags. Returns matching pages with snippets — YOU (the LLM) synthesize answers with citations from the results.

```
wiki_query({ query: "authentication", tags: ["auth"], category: "architecture" })
```

### Lint
Run health checks on the wiki. Detects orphan pages, stale content, broken cross-references, oversized pages, and structural contradictions.

```
wiki_lint()
```

### Quick Add
Add a single page quickly (simpler than ingest).

```
wiki_add({ title: "Page Title", content: "...", tags: ["tag1"], category: "decision" })
```

### List / Read / Delete
```
wiki_list()           # Show all pages (reads index.md)
wiki_read({ page: "auth-architecture" })  # Read specific page
wiki_delete({ page: "outdated-page" })    # Delete a page
```

### Log
View wiki operation history by reading `.nord/wiki/log.md`.

## Categories
Pages are organized by category: `architecture`, `decision`, `pattern`, `debugging`, `environment`, `session-log`

## Storage
- Pages: `.nord/wiki/*.md` (markdown with YAML frontmatter)
- Index: `.nord/wiki/index.md` (auto-maintained catalog)
- Log: `.nord/wiki/log.md` (append-only operation chronicle)

## Cross-References
Use `[[page-name]]` wiki-link syntax to create cross-references between pages.

## Auto-Capture
At session end, significant discoveries are automatically captured as session-log pages. Configure via `wiki.autoCapture` in `.nord-config.json` (default: enabled).

## Hard Constraints
- NO vector embeddings — query uses keyword + tag matching only
- Wiki pages are git-ignored by default (`.nord/wiki/` is project-local)
