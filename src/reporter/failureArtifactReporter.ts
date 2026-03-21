import fs from 'node:fs';
import path from 'node:path';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import {
  FAILURE_CONTEXT_ATTACHMENT_NAME,
  type FailurePayload,
} from '../utils/failurePayload.js';

const ARTIFACTS_DIR = path.join(process.cwd(), 'artifacts');

export default class FailureArtifactReporter implements Reporter {
  onTestEnd(test: TestCase, result: TestResult): void {
    if (result.status !== 'failed') return;

    const attachment = result.attachments.find((a) => a.name === FAILURE_CONTEXT_ATTACHMENT_NAME);
    if (!attachment?.body) return;

    let context: { endpoint: string; method: string; status: number; responseBody: unknown; requestBody: unknown };
    try {
      context = JSON.parse(attachment.body.toString('utf8'));
    } catch {
      return;
    }

    const payload: FailurePayload = {
      endpoint: context.endpoint,
      method: context.method,
      status: context.status,
      responseBody: context.responseBody,
      requestBody: context.requestBody,
      errorMessage: result.error?.message ?? 'Unknown error',
      timestamp: new Date().toISOString(),
    };

    if (!fs.existsSync(ARTIFACTS_DIR)) {
      fs.mkdirSync(ARTIFACTS_DIR, { recursive: true });
    }

    const slug = test.title.replace(/\s+/g, '-').replace(/[^a-zA-Z0-9-]/g, '').slice(0, 40);
    const filename = `failure-${slug}-${Date.now()}.json`;
    const filepath = path.join(ARTIFACTS_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf8');
  }
}
