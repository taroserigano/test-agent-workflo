'use strict';

/**
 * Fix Agent — reads AI review findings, generates fixes via GPT-4 mini,
 * applies them to the codebase, and commits + pushes.
 * The push triggers the review workflow again (auto-loop).
 *
 * Environment variables:
 *   OPENAI_API_KEY, GITHUB_TOKEN, PR_NUMBER, REPO_OWNER, REPO_NAME,
 *   PR_BRANCH, FIX_ITERATION
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const OPENAI_MODEL = 'gpt-4o-mini';
const MAX_ITERATIONS = 3;

// --------------- OpenAI helper ---------------

function callOpenAI(systemPrompt, userPrompt) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({
      model: OPENAI_MODEL,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.2,
      max_tokens: 3000,
    });

    const options = {
      hostname: 'api.openai.com',
      path: '/v1/chat/completions',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.error) return reject(new Error(parsed.error.message));
          resolve(parsed.choices[0].message.content.trim());
        } catch (e) {
          reject(new Error(`Failed to parse OpenAI response: ${e.message}`));
        }
      });
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// --------------- GitHub helpers ---------------

function githubAPI(method, apiPath, body) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: apiPath,
      method,
      headers: {
        'Authorization': `Bearer ${process.env.GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'fix-agent',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(data ? JSON.parse(data) : {});
        } catch {
          resolve({});
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function postComment(body) {
  const { REPO_OWNER, REPO_NAME, PR_NUMBER } = process.env;
  return githubAPI(
    'POST',
    `/repos/${REPO_OWNER}/${REPO_NAME}/issues/${PR_NUMBER}/comments`,
    { body }
  );
}

// --------------- File helpers ---------------

function readFileContents(filePath) {
  const fullPath = path.resolve(filePath);
  if (!fs.existsSync(fullPath)) return null;
  return fs.readFileSync(fullPath, 'utf8');
}

function writeFileContents(filePath, content) {
  const fullPath = path.resolve(filePath);
  const dir = path.dirname(fullPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(fullPath, content, 'utf8');
}

function git(cmd) {
  return execSync(`git ${cmd}`, { encoding: 'utf8', stdio: 'pipe' }).trim();
}

// --------------- Fix Agent Prompt ---------------

const FIX_SYSTEM_PROMPT = `You are an expert code fixer. You receive a list of findings from a code review and the current source files. Your job is to apply fixes for ALL medium and critical findings.

Rules:
- Only change what is necessary to fix the findings
- Do not add unnecessary features or refactoring beyond what the findings require
- Preserve existing code style and formatting
- Do not change test files unless a finding specifically requires it
- Be precise and minimal

Output EXACTLY this JSON (no markdown fences, no extra text):
{
  "fixes": [
    {
      "file": "<relative file path>",
      "content": "<entire new file content with fixes applied>"
    }
  ],
  "summary": "<one paragraph explaining what was fixed>"
}`;

function buildFixPrompt(findings, fileContents) {
  const findingsText = findings
    .map((f, i) => `${i + 1}. [${f.severity}] (${f.agent}): ${f.description}`)
    .join('\n');

  const filesText = Object.entries(fileContents)
    .map(([name, content]) => `### ${name}\n\`\`\`\n${content}\n\`\`\``)
    .join('\n\n');

  return `## Findings to fix (medium and critical only):\n${findingsText}\n\n## Current source files:\n${filesText}`;
}

// --------------- Main ---------------

async function main() {
  const iteration = parseInt(process.env.FIX_ITERATION || '1', 10);
  const prNumber = process.env.PR_NUMBER;

  console.log(`Fix Agent — iteration ${iteration}/${MAX_ITERATIONS}`);

  if (iteration > MAX_ITERATIONS) {
    console.log('Max iterations reached. Stopping fix loop.');
    await postComment([
      '## 🛑 Fix Agent — Max Iterations Reached',
      '',
      `After ${MAX_ITERATIONS} fix attempts, some findings remain unresolved.`,
      'Human intervention is required to proceed.',
      '',
      '> _Fix Agent stopped to prevent infinite loops._',
    ].join('\n'));
    return;
  }

  // Read findings from the review step
  if (!fs.existsSync('findings.json')) {
    console.log('No findings.json found. Nothing to fix.');
    return;
  }

  const { findings, verdict } = JSON.parse(fs.readFileSync('findings.json', 'utf8'));

  if (!findings || findings.length === 0) {
    console.log('No blocking findings. Nothing to fix.');
    return;
  }

  console.log(`Found ${findings.length} blocking findings to fix.`);

  // Get changed files in this PR to know what to read
  const changedFiles = git('diff --name-only HEAD~1 HEAD 2>/dev/null || git diff --name-only HEAD')
    .split('\n')
    .filter(Boolean)
    .filter(f => f.startsWith('src/') || f.startsWith('tests/'));

  // Also include any files mentioned in findings
  const allSourceFiles = [...new Set([
    ...changedFiles,
    ...fs.readdirSync('src', { recursive: true })
      .map(f => `src/${f}`)
      .filter(f => f.endsWith('.js')),
  ])];

  // Read all relevant source files
  const fileContents = {};
  for (const file of allSourceFiles) {
    const content = readFileContents(file);
    if (content) fileContents[file] = content;
  }

  if (Object.keys(fileContents).length === 0) {
    console.log('No source files found to fix.');
    return;
  }

  console.log(`Reading ${Object.keys(fileContents).length} source files...`);
  console.log('Asking GPT-4 mini to generate fixes...');

  // Ask GPT to generate fixes
  const fixResponse = await callOpenAI(
    FIX_SYSTEM_PROMPT,
    buildFixPrompt(findings, fileContents)
  );

  let fixPlan;
  try {
    fixPlan = JSON.parse(fixResponse);
  } catch {
    console.error('Fix Agent returned invalid JSON. Cannot apply fixes.');
    await postComment([
      '## ❌ Fix Agent — Failed to Parse Fixes',
      '',
      `Iteration ${iteration}: The Fix Agent could not generate valid fix output.`,
      'Human intervention is required.',
      '',
      '<details>',
      '<summary>Raw output</summary>',
      '',
      '```',
      fixResponse.slice(0, 2000),
      '```',
      '</details>',
    ].join('\n'));
    return;
  }

  if (!fixPlan.fixes || fixPlan.fixes.length === 0) {
    console.log('Fix Agent produced no fixes.');
    return;
  }

  // Apply fixes
  console.log(`Applying ${fixPlan.fixes.length} file fix(es)...`);
  const appliedFiles = [];

  for (const fix of fixPlan.fixes) {
    // Security: prevent path traversal
    const normalized = path.normalize(fix.file);
    if (normalized.startsWith('..') || path.isAbsolute(normalized)) {
      console.warn(`Skipping suspicious path: ${fix.file}`);
      continue;
    }
    // Don't allow modifications to workflow files
    if (normalized.startsWith('.github/')) {
      console.warn(`Skipping workflow file: ${fix.file}`);
      continue;
    }

    writeFileContents(fix.file, fix.content);
    appliedFiles.push(fix.file);
    console.log(`  Fixed: ${fix.file}`);
  }

  if (appliedFiles.length === 0) {
    console.log('No valid fixes to apply.');
    return;
  }

  // Commit and push
  console.log('Committing fixes...');
  git('add .');

  // Check if there are actual changes
  const status = git('status --porcelain');
  if (!status) {
    console.log('No changes after applying fixes. Nothing to commit.');
    await postComment([
      `## 🔧 Fix Agent — Iteration ${iteration}`,
      '',
      'No actual code changes were produced. The findings may need human attention.',
    ].join('\n'));
    return;
  }

  git(`commit -m "fix: auto-fix iteration ${iteration} — ${fixPlan.summary.slice(0, 80)}"`);
  git('push');

  console.log('Fixes committed and pushed. This will trigger another review cycle.');

  // Post progress comment
  await postComment([
    `## 🔧 Fix Agent — Iteration ${iteration}/${MAX_ITERATIONS}`,
    '',
    `**Applied fixes to:** ${appliedFiles.map(f => '`' + f + '`').join(', ')}`,
    '',
    `> ${fixPlan.summary}`,
    '',
    '### Findings addressed:',
    ...findings.map(f => `- [${f.severity}] ${f.description}`),
    '',
    '_Pushing changes to re-trigger AI review..._',
  ].join('\n'));

  // Write iteration count for the next cycle
  const outputFile = process.env.GITHUB_OUTPUT;
  if (outputFile) {
    fs.appendFileSync(outputFile, `next_iteration=${iteration + 1}\n`);
  }
}

main().catch((err) => {
  console.error('Fix Agent failed:', err.message);
  process.exit(1);
});
