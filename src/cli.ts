import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, extname, join, resolve } from 'node:path';
import dotenv from 'dotenv';
import { Embedder, SqliteStore, TwoStageRAG } from './index';

const localEnvPath = resolve(process.cwd(), '.env.local');
if (existsSync(localEnvPath)) dotenv.config({ path: localEnvPath, quiet: true });

const DEFAULT_COLLECTION = 'default';
const INDEXABLE_EXTENSIONS = ['.md', '.txt', '.docx'];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env: ${name}`);
  return value;
}

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) out.push(...walk(path));
    else if (basename(path).toUpperCase() === 'README.MD') continue;
    else if (INDEXABLE_EXTENSIONS.includes(extname(path).toLowerCase())) out.push(path);
  }
  return out;
}

async function extractText(path: string): Promise<string> {
  if (extname(path).toLowerCase() === '.docx') {
    const mammoth = await import('mammoth');
    const { value } = await mammoth.extractRawText({ path });
    return value;
  }
  return readFileSync(path, 'utf-8');
}

function parseFlag(args: string[], name: string, fallback: string): string {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
}

function adfToText(node: unknown): string {
  if (node == null) return '';
  if (typeof node === 'string') return node;
  if (Array.isArray(node)) return node.map(adfToText).join('');
  const n = node as { type?: string; text?: string; content?: unknown[] };
  let text = n.text ?? '';
  if (n.content) text += adfToText(n.content);
  if (n.type && ['paragraph', 'heading', 'listItem', 'codeBlock', 'blockquote'].includes(n.type)) text += '\n';
  return text;
}

type JiraFields = {
  summary?: string;
  description?: unknown;
  comment?: { comments?: { author?: { displayName?: string }; created?: string; body?: unknown }[] };
};

function jiraAuthHeaders(): Record<string, string> {
  const email = requireEnv('JIRA_EMAIL');
  const token = requireEnv('JIRA_API_TOKEN');
  const auth = Buffer.from(`${email}:${token}`).toString('base64');
  return { Authorization: `Basic ${auth}`, Accept: 'application/json' };
}

function formatIssueText(fields: JiraFields | undefined): string {
  const summary = fields?.summary ?? '';
  const description = adfToText(fields?.description).trim();
  const comments = (fields?.comment?.comments ?? [])
    .map((c) => `${c.author?.displayName ?? 'Unknown'} (${c.created}):\n${adfToText(c.body).trim()}`)
    .join('\n\n');

  return [`Title: ${summary}`, description && `Description:\n${description}`, comments && `Comments:\n${comments}`]
    .filter(Boolean)
    .join('\n\n');
}

async function fetchJiraIssue(issueUrl: string): Promise<{ text: string; source: string }> {
  const match = issueUrl.match(/[A-Z][A-Z0-9]+-\d+/);
  if (!match) {
    throw new Error(
      `Could not find an issue key (e.g. PROJ-123) in URL: ${issueUrl}\n` +
        `Pass a single-issue URL (.../browse/PROJ-123) or a search URL with a jql= param.`,
    );
  }
  const issueKey = match[0];
  const { origin } = new URL(issueUrl);

  const apiUrl = `${origin}/rest/api/3/issue/${issueKey}?fields=summary,description,comment`;
  const res = await fetch(apiUrl, { headers: jiraAuthHeaders() });
  if (!res.ok) throw new Error(`Jira API error ${res.status} ${res.statusText} for ${apiUrl}`);

  const data = (await res.json()) as { fields?: JiraFields };
  return { text: formatIssueText(data.fields), source: `${issueKey} ${issueUrl}` };
}

async function fetchJiraSearchResults(searchUrl: string): Promise<{ text: string; source: string }[]> {
  const url = new URL(searchUrl);
  const jql = url.searchParams.get('jql');
  if (!jql) throw new Error(`No jql= param found in search URL: ${searchUrl}`);
  const { origin } = url;

  const headers = { ...jiraAuthHeaders(), 'Content-Type': 'application/json' };
  const maxResults = 100;
  const safetyCap = 1500;
  const docs: { text: string; source: string }[] = [];
  let nextPageToken: string | undefined;
  let isLast = false;
  let capped = false;

  while (!isLast && docs.length < safetyCap) {
    const res = await fetch(`${origin}/rest/api/3/search/jql`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        jql,
        maxResults,
        fields: ['summary', 'description', 'comment'],
        ...(nextPageToken ? { nextPageToken } : {}),
      }),
    });
    if (!res.ok) throw new Error(`Jira search API error ${res.status} ${res.statusText} for jql: ${jql}`);

    const data = (await res.json()) as {
      issues: { key: string; fields: JiraFields }[];
      nextPageToken?: string;
      isLast: boolean;
    };
    for (const issue of data.issues) {
      docs.push({ text: formatIssueText(issue.fields), source: `${issue.key} ${origin}/browse/${issue.key}` });
    }
    isLast = data.isLast || data.issues.length === 0;
    nextPageToken = data.nextPageToken;
    if (!isLast && docs.length >= safetyCap) capped = true;
  }

  if (capped) {
    console.log(`Note: JQL matched more issues than the safety cap — only indexing the first ${docs.length}.`);
  }

  return docs;
}

async function cmdIndex(folder: string, collection: string): Promise<void> {
  const files = walk(folder);
  if (files.length === 0) {
    console.log(`No ${INDEXABLE_EXTENSIONS.join('/')} files found under ${folder}`);
    return;
  }

  const embedder = await Embedder.create();
  const store = SqliteStore.create(collection);
  const rag = await TwoStageRAG.create(store, embedder);

  let total = 0;
  for (const file of files) {
    const text = await extractText(file);
    store.deleteBySource(file);
    const chunks = await rag.index([text], file);
    console.log(`Indexed ${chunks} chunks from ${file}`);
    total += chunks;
  }
  console.log(`\nDone. ${total} chunks indexed into collection "${collection}".`);
}

async function cmdIndexUrl(rawUrl: string, collection: string): Promise<void> {
  const isSearch = new URL(rawUrl).searchParams.has('jql');
  const docs = isSearch ? await fetchJiraSearchResults(rawUrl) : [await fetchJiraIssue(rawUrl)];

  if (docs.length === 0) {
    console.log('No issues matched.');
    return;
  }

  const embedder = await Embedder.create();
  const store = SqliteStore.create(collection);
  const rag = await TwoStageRAG.create(store, embedder);

  let total = 0;
  for (const { text, source } of docs) {
    store.deleteBySource(source);
    const chunks = await rag.index([text], source);
    console.log(`Indexed ${chunks} chunks from ${source}`);
    total += chunks;
  }
  console.log(`\nDone. ${total} chunks indexed into collection "${collection}".`);
}

async function cmdQuery(question: string, collection: string, topN: number, asJson: boolean): Promise<void> {
  const embedder = await Embedder.create();
  const store = SqliteStore.create(collection);
  const rag = await TwoStageRAG.create(store, embedder);

  const results = await rag.search(question, Math.max(topN * 4, 20), topN);
  const rows = results.map((r) => ({
    text: r.text,
    source: r.metadata?.source ?? 'unknown',
    vectorScore: r.vectorScore,
    rerankScore: r.rerankScore,
  }));

  if (asJson) {
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  if (rows.length === 0) {
    console.log('No results.');
    return;
  }

  rows.forEach((row, i) => {
    const divider = '─'.repeat(72);
    console.log(divider);
    console.log(
      `[${i + 1}] ${row.source}  (vector: ${row.vectorScore.toFixed(3)}, rerank: ${(row.rerankScore ?? 0).toFixed(3)})`,
    );
    console.log(divider);
    console.log(row.text.trim());
    console.log();
  });
}

function printUsage(): void {
  console.log(
    [
      'Usage:',
      '  rag-cli index <folder> [--collection=name]',
      '  rag-cli index --url=<jira-issue-or-search-url> [--collection=name]',
      '  rag-cli query "<question>" [--collection=name] [--topN=5] [--json]',
    ].join('\n'),
  );
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  const positional = rest.filter((a) => !a.startsWith('--'));
  const collection = parseFlag(rest, 'collection', DEFAULT_COLLECTION);

  if (cmd === 'index') {
    const urlFlag = rest.find((a) => a.startsWith('--url='));
    if (urlFlag) {
      await cmdIndexUrl(urlFlag.slice('--url='.length), collection);
      return;
    }
    const folder = positional[0];
    if (!folder) {
      printUsage();
      process.exit(1);
    }
    await cmdIndex(folder, collection);
    return;
  }

  if (cmd === 'query') {
    const question = positional[0];
    if (!question) throw new Error('Usage: rag-cli query "<question>" [--collection=name] [--topN=5] [--json]');
    const topN = Number(parseFlag(rest, 'topN', '5'));
    const asJson = rest.includes('--json');
    await cmdQuery(question, collection, topN, asJson);
    return;
  }

  printUsage();
  process.exit(1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
