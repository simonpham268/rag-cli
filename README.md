# @rag-cli

Local-first two-stage RAG (retrieve + rerank) as an installable CLI. Embeddings run
locally via `@huggingface/transformers` (BGE models) — no external API keys needed.
Storage defaults to a local SQLite file (`.rag/store.sqlite` in the current directory);
`InMemoryVectorStore` and `QdrantStore` are also available as a library.

Extracted from the `automation` repo's `src/rag` so any team/repo can install and use
it standalone, without depending on that repo.

## Requirements

- Node.js >= 22.5 (uses the built-in `node:sqlite` module)

## Install (team members)

Packages are published to **GitHub Packages** under the `@simonpham268` scope,
so `npm install` needs to know where to look and needs a token to read them (GitHub
Packages requires auth even for public repos).

1. Create a classic PAT at https://github.com/settings/tokens with the `read:packages`
   scope (add `repo` too if the `rag-cli` repo is private).
2. Copy `.npmrc.example` to `~/.npmrc` (applies to all your projects) and fill in the
   token:
   ```
   @simonpham268:registry=https://npm.pkg.github.com
   //npm.pkg.github.com/:_authToken=<TOKEN>
   ```
3. Install globally:
   ```bash
   npm install -g @simonpham268/rag-cli
   ```

## Usage

Run from whichever project/folder you want to index — it creates `.rag/store.sqlite`
relative to your current directory, so each project gets its own isolated store.

```bash
# Index a folder of .md/.txt/.docx files into the default collection
rag-cli index ./docs

# Index into a named collection
rag-cli index ./docs --collection=requirements

# Index a Jira issue or JQL search (requires JIRA_EMAIL + JIRA_API_TOKEN,
# via env vars or a .env.local file in the current directory)
rag-cli index --url=https://your-domain.atlassian.net/browse/PROJ-123
rag-cli index --url="https://your-domain.atlassian.net/issues/?jql=project=PROJ" --collection=requirements

# Query
rag-cli query "what is the exclusion list validation rule?"
rag-cli query "..." --collection=requirements --topN=5 --json
```

Re-indexing a changed file replaces its old chunks (deduped by file path / Jira issue
key), rather than piling on top of them.

## Using as a library

```ts
import { Embedder, SqliteStore, TwoStageRAG } from '@simonpham268/rag-cli';

const embedder = await Embedder.create();
const store = SqliteStore.create('my-collection');
const rag = await TwoStageRAG.create(store, embedder);

await rag.index(['some document text'], 'source-id');
const results = await rag.search('a question', 20, 5);
```

## Releasing a new version (maintainers)

Push a version tag — GitHub Actions builds and publishes to GitHub Packages
automatically (see `.github/workflows/publish.yml`):

```bash
git tag v1.1.0
git push origin v1.1.0
```

The workflow sets `package.json`'s version from the tag before publishing, so you
don't need to bump it manually in a commit.
