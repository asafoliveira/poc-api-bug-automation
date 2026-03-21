import './loadEnv.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseFailurePayload } from '../src/utils/failurePayload.js';
import { buildBugContentFromFailure } from '../src/utils/bugTemplate.js';
import { fingerprint } from '../src/utils/fingerprint.js';
import * as jira from '../src/jira/client.js';

function jqlByFingerprint(project: string, fp: string): string {
  return `project = ${project} AND labels = "${fp}" AND status != Done`;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ARTIFACTS_DIR = path.join(ROOT, 'artifacts');

const JIRA_PROJECT = process.env.JIRA_PROJECT?.trim() || 'QA';
const JIRA_ISSUE_TYPE = process.env.JIRA_ISSUE_TYPE?.trim() || 'Bug';

async function main(): Promise<void> {
  if (!process.env.JIRA_PROJECT?.trim()) {
    console.warn('JIRA_PROJECT not defined in .env; using "QA".');
  }
  console.log('Jira Project:', JIRA_PROJECT);

  if (!fs.existsSync(ARTIFACTS_DIR)) return;

  const files = fs.readdirSync(ARTIFACTS_DIR).filter((f) => f.endsWith('.json'));
  if (files.length === 0) return;

  for (const file of files) {
    const filepath = path.join(ARTIFACTS_DIR, file);
    let raw: string;
    try {
      raw = fs.readFileSync(filepath, 'utf8');
    } catch {
      continue;
    }

    let data: ReturnType<typeof parseFailurePayload>;
    try {
      data = parseFailurePayload(JSON.parse(raw));
    } catch {
      continue;
    }

    if (!data) continue;

    const fp = fingerprint(data);
    const jql = jqlByFingerprint(JIRA_PROJECT, fp);

    let existing: Array<{ key: string }>;
    try {
      existing = await jira.searchIssues(jql);
    } catch (e) {
      console.error(`Jira search failed for ${file}:`, (e as Error).message);
      continue;
    }

    if (existing.length > 0) {
      const issueKey = existing[0].key;
      if (!issueKey) {
        console.warn(`Issue without key for ${file}; creating new.`);
      } else {
        const comment = `New occurrence: ${data.timestamp}\n\nResponse body:\n\`\`\`json\n${JSON.stringify(data.responseBody, null, 2)}\n\`\`\``;
        try {
          await jira.addComment(issueKey, comment);
          console.log(`Comment added to issue ${issueKey} (${file})`);
        } catch (e) {
          console.error(`Could not add comment to issue ${issueKey}:`, (e as Error).message);
        }
      }
      continue;
    }

    const bugContent = buildBugContentFromFailure(data);
    const description = bugContent.fullDescription ?? bugContent.description;

    try {
      const { key } = await jira.createIssue({
        project: JIRA_PROJECT,
        issueType: JIRA_ISSUE_TYPE,
        summary: bugContent.summary,
        description,
        labels: [fp],
      });

      const attachmentPayload = { requestBody: data.requestBody, responseBody: data.responseBody };
      const attachmentBuffer = Buffer.from(JSON.stringify(attachmentPayload, null, 2), 'utf8');
      await jira.addAttachment(key, 'request-response.json', attachmentBuffer, 'application/json');
      console.log(`Issue ${key} created (${file})`);
    } catch (e) {
      const errMsg = (e as Error).message;
      console.error(`Error creating issue for ${file}:`, errMsg);
      if (errMsg.includes('valid project is required')) {
        console.error(`Tip: define JIRA_PROJECT in .env. Current value: "${JIRA_PROJECT}"`);
      }
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
