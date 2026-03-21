import type { JiraCreateIssuePayload, JiraCreateIssueResponse, JiraSearchResult } from './types.js';

const JIRA_EMAIL = process.env.JIRA_EMAIL ?? '';
const JIRA_API_TOKEN = process.env.JIRA_API_TOKEN ?? '';
const JIRA_BASE_URL = (process.env.JIRA_BASE_URL ?? '').replace(/\/$/, '');

function authHeader(): string {
  const encoded = Buffer.from(`${JIRA_EMAIL}:${JIRA_API_TOKEN}`).toString('base64');
  return `Basic ${encoded}`;
}

type JiraFetchOptions = Omit<RequestInit, 'body'> & { body?: object; formData?: FormData };

async function fetchJira(
  pathname: string,
  options: JiraFetchOptions = {},
): Promise<Response> {
  const url = `${JIRA_BASE_URL}${pathname}`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: authHeader(),
    ...(options.headers as Record<string, string>),
  };

  let body: string | FormData | undefined;
  if (options.formData) {
    body = options.formData;
    delete (headers as Record<string, unknown>)['Content-Type'];
  } else if (options.body) {
    body = JSON.stringify(options.body);
    headers['Content-Type'] = 'application/json';
  }

  return fetch(url, {
    ...options,
    headers,
    body,
  });
}

export async function searchIssues(jql: string): Promise<Array<{ key: string }>> {
  const res = await fetchJira('/rest/api/3/search/jql', {
    method: 'POST',
    body: {
      jql,
      maxResults: 50,
      fields: ['key'],
    },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jira search failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as JiraSearchResult;
  return (data.issues ?? []).map((i) => ({ key: i.key ?? (i as { key?: string }).key ?? String((i as { id?: string }).id ?? '') })).filter((x) => x.key);
}

export function escapeJqlText(value: string): string {
  const withoutControlChars = value.replace(/[\u0000-\u001F\u007F]/g, ' ');
  return withoutControlChars.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

type AdfInline = { type: 'text'; text: string; marks?: { type: string }[] } | { type: 'hardBreak' };
type AdfBlock = { type: 'paragraph'; content: AdfInline[] } | { type: 'heading'; attrs: { level: number }; content: AdfInline[] };

function parseInline(text: string): AdfInline[] {
  const result: AdfInline[] = [];
  let remaining = text;
  const boldRegex = /\*\*([^*]+)\*\*/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = boldRegex.exec(remaining)) !== null) {
    if (match.index > lastIndex) {
      result.push({ type: 'text', text: remaining.slice(lastIndex, match.index) });
    }
    result.push({ type: 'text', text: match[1], marks: [{ type: 'strong' }] });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < remaining.length) {
    result.push({ type: 'text', text: remaining.slice(lastIndex) });
  }
  return result.length > 0 ? result : [{ type: 'text', text: remaining }];
}

function paragraphWithBreaks(text: string): AdfBlock {
  const lines = text.split('\n');
  const content: AdfInline[] = [];
  for (let i = 0; i < lines.length; i++) {
    content.push(...parseInline(lines[i]));
    if (i < lines.length - 1) content.push({ type: 'hardBreak' });
  }
  return { type: 'paragraph', content };
}

function markdownToAdfContent(md: string): AdfBlock[] {
  const blocks: AdfBlock[] = [];
  const sections = md.split(/\n\n+/);
  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('## ')) {
      blocks.push({
        type: 'heading',
        attrs: { level: 2 },
        content: parseInline(trimmed.slice(3)),
      });
    } else if (trimmed.startsWith('### ')) {
      blocks.push({
        type: 'heading',
        attrs: { level: 3 },
        content: parseInline(trimmed.slice(4)),
      });
    } else {
      blocks.push(paragraphWithBreaks(trimmed));
    }
  }
  return blocks.length > 0 ? blocks : [{ type: 'paragraph', content: [{ type: 'text', text: md }] }];
}

function adfParagraph(text: string): object {
  return {
    type: 'doc',
    version: 1,
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

export async function addComment(issueKey: string, body: string): Promise<void> {
  const res = await fetchJira(`/rest/api/3/issue/${issueKey}/comment`, {
    method: 'POST',
    body: { body: adfParagraph(body) },
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`addComment in Jira failed: ${res.status} ${text}`);
  }
}

export async function createIssue(payload: JiraCreateIssuePayload): Promise<{ key: string }> {
  const descriptionAdf =
    payload.description.includes('## ') || payload.description.includes('**')
      ? { type: 'doc' as const, version: 1, content: markdownToAdfContent(payload.description) }
      : { type: 'doc' as const, version: 1, content: [{ type: 'paragraph' as const, content: [{ type: 'text' as const, text: payload.description }] }] };

  const body = {
    fields: {
      project: { key: payload.project },
      issuetype: { name: payload.issueType },
      summary: payload.summary,
      description: descriptionAdf,
      labels: payload.labels,
    },
  };
  const res = await fetchJira('/rest/api/3/issue', { method: 'POST', body });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`createIssue in Jira failed: ${res.status} ${text}`);
  }
  const data = (await res.json()) as JiraCreateIssueResponse;
  return { key: data.key };
}

export async function addAttachment(
  issueKey: string,
  filename: string,
  buffer: Buffer,
  mimeType: string,
): Promise<void> {
  const formData = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
  formData.append('file', blob, filename);

  const url = `${JIRA_BASE_URL}/rest/api/3/issue/${issueKey}/attachments`;
  const headers: Record<string, string> = {
    Accept: 'application/json',
    Authorization: authHeader(),
    'X-Atlassian-Token': 'no-check',
  };

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: formData,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`addAttachment in Jira failed: ${res.status} ${text}`);
  }
}
