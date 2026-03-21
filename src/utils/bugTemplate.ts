import fs from 'node:fs';
import path from 'node:path';
import type { FailurePayload } from './failurePayload.js';

export interface BugContent {
  summary: string;
  description: string;
  steps: string;
  expected: string;
  actual: string;
  severity: string;
  fullDescription?: string;
}

const SUMMARY_MAX_LENGTH = 120;
const TEMPLATE_PATH = path.join(process.cwd(), 'templates', 'bug-api.md');

/** Remove ANSI codes from the error message. */
export function stripAnsi(s: string): string {
  return s.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, '').trim();
}

function oneLine(s: string): string {
  return stripAnsi(s).replace(/\s+/g, ' ').trim();
}

function truncate(s: string, max: number): string {
  const t = oneLine(s);
  return t.length <= max ? t : t.slice(0, max - 3) + '...';
}

function severityFromStatus(status: number): string {
  if (status >= 500) return 'High';
  if (status >= 400) return 'Medium';
  return 'Medium';
}

function summaryInEnglish(method: string, endpoint: string, status: number, cleanMessage: string): string {
  const expectedReceived = /Expected:\s*(\S+)\s+Received:\s*(\S+)/i.exec(cleanMessage);
  const shortDesc = expectedReceived
    ? `expected ${expectedReceived[1]}, received ${expectedReceived[2]}`
    : `status ${status} — response not as expected`;
  return truncate(`API Failure: ${method} ${endpoint} — ${shortDesc}`, SUMMARY_MAX_LENGTH);
}

export function buildBugContentFromFailure(payload: FailurePayload): BugContent {
  const { endpoint, method, status, errorMessage } = payload;
  const cleanMessage = stripAnsi(errorMessage).replace(/\s+/g, ' ').trim();
  const severity = severityFromStatus(status);
  const summary = summaryInEnglish(method, endpoint, status, cleanMessage);

  let fullDescription: string;
  if (fs.existsSync(TEMPLATE_PATH)) {
    const template = fs.readFileSync(TEMPLATE_PATH, 'utf8');
    fullDescription = template
      .replace(/\{\{method\}\}/g, method)
      .replace(/\{\{endpoint\}\}/g, endpoint)
      .replace(/\{\{status\}\}/g, String(status))
      .replace(/\{\{errorMessage\}\}/g, cleanMessage)
      .replace(/\{\{severity\}\}/g, severity);
  } else {
    fullDescription = [
      `Request ${method} ${endpoint} returned status ${status}. ${cleanMessage}`,
      '',
      '**Steps to reproduce:**',
      `1. Send ${method} request to ${endpoint}.`,
      '2. See attachment request-response.json.',
      '',
      '**Expected:** Status and response as per test contract.',
      `**Actual:** ${cleanMessage} HTTP Status: ${status}.`,
      `**Severity:** ${severity}`,
    ].join('\n');
  }

  return {
    summary,
    description: '',
    steps: '',
    expected: '',
    actual: '',
    severity,
    fullDescription,
  };
}
