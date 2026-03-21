# Automated API Defect Reporter (PoC)

*Study project / proof of concept.* This repo is a small learning exercise: wire Playwright API tests to Jira so failed runs can open or update issues automatically. It is not production-hardened; it exists to experiment with reporting, deduplication, and CI.

When an API test fails, this PoC:

1. *Captures* structured failure data (endpoint, method, status, request/response body, error message) as JSON under artifacts/.
2. *Builds a fingerprint* for deduplication: hash(method + endpoint + status + errorMessage).
3. *Queries Jira* with JQL: project = <KEY> AND labels = "<fingerprint>" AND status != Done.
4. *If a matching issue exists* → adds a comment with the new occurrence timestamp and response body.
5. *If not* → fills templates/bug-api.md, creates a Jira bug with the fingerprint as a label, and attaches request/response JSON.

The same flow can run in *GitHub Actions* after the test step.

## Prerequisites

- Node.js 20+
- Environment variables (see below)
- A Jira Cloud site and API token (for local runs and/or Actions)

## Environment variables

Copy .env.example to .env and set:

| Variable | Description |
|----------|-------------|
| JIRA_EMAIL | Jira account email |
| JIRA_API_TOKEN | Jira API token (Atlassian) |
| JIRA_BASE_URL | Jira base URL (e.g. https://your-domain.atlassian.net) |
| JIRA_PROJECT | Project *key* (e.g. QA). Required to create issues in the right project (local + Actions). |
| JIRA_ISSUE_TYPE | Optional (defaults to Bug). |

## Running locally

### 1. Install and run tests

bash
cd automated-api-defect-reporter
npm install
npx playwright test


Two tests *fail on purpose* (wrong assertions on GET /posts and GET /posts/1). After the run, artifacts/ contains one JSON file per failure.

### 2. Process failures (Jira)

bash
npx tsx scripts/processFailures.ts


Reads all artifacts/*.json, fingerprints each, searches Jira, then either comments on an existing issue or creates a new one (from templates/bug-api.md plus an attachment).

## GitHub Actions

Workflow: .github/workflows/api-tests.yml.

- *Triggers:* push and pull_request to main / master.
- *Steps:* checkout → Node → npm install → Playwright install → playwright test (continue-on-error: true) → processFailures.ts.

*Repository secrets* (Settings → Secrets and variables → Actions):

- JIRA_EMAIL
- JIRA_API_TOKEN
- JIRA_BASE_URL
- JIRA_PROJECT — same key as in .env (e.g. QA)
- JIRA_ISSUE_TYPE — optional; if omitted, the script defaults to Bug

*410 on Jira search* (“API removed… migrate to /rest/api/3/search/jql”): this repo’s src/jira/client.ts uses the new search endpoint. If you still see 410, your remote branch may be outdated—pull/push the latest client. Older code called /rest/api/3/search, which Atlassian removed.

## Artifact JSON shape

Each failure file under artifacts/ looks like:

json
{
  "endpoint": "/posts",
  "method": "GET",
  "status": 200,
  "responseBody": { },
  "requestBody": null,
  "errorMessage": "Expected status 500, got 200",
  "timestamp": "2025-03-09T12:00:00.000Z"
}


## Fingerprint

Deduplication uses a deterministic hash:

fingerprint = sha256(method + "|" + endpoint + "|" + status + "|" + errorMessage)

That value is stored as a Jira *label* on new issues so later runs can find duplicates by label.

## Project layout


automated-api-defect-reporter/
  src/
    tests/          # Playwright API tests (JSONPlaceholder)
    jira/           # Jira REST helper (search, create, comment, attach)
    utils/          # fingerprint, failurePayload, bugTemplate
    reporter/       # Custom reporter → writes failure JSON to artifacts/
  scripts/
    processFailures.ts
  templates/
    bug-api.md      # Bug body template (placeholders: method, endpoint, status, …)
  artifacts/        # Failure JSON (gitignored)
  playwright.config.ts
  package.json
  tsconfig.json


## APIs under test

Base URL: https://jsonplaceholder.typicode.com

- GET /posts
- GET /posts/{id}
- POST /posts
- PUT /posts/{id}
- DELETE /posts/{id}