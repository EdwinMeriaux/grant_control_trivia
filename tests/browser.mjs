import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import deck from '../questions.json' with { type: 'json' };

const origin = process.env.SURVEY_TEST_ORIGIN || 'http://127.0.0.1:4173';
const localWorker = process.env.SURVEY_TEST_WORKER || 'http://127.0.0.1:8787';
const productionPattern = 'https://grant-control-trivia-writer.edwinmeriaux-surveys.workers.dev/**';
const macChrome = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const executablePath = process.env.CHROME_PATH || (existsSync(macChrome) ? macChrome : undefined);
const browser = await chromium.launch({ executablePath, headless: true });
await mkdir('test-results', { recursive: true });
const errors = [];
try {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  const submissions = [];
  await page.route(productionPattern, async route => {
    const payload = route.request().postDataJSON();
    submissions.push(payload);
    if (submissions.length === 1) {
      await route.fulfill({
        status: 503, contentType: 'application/json',
        headers: { 'Access-Control-Allow-Origin': origin },
        body: JSON.stringify({ error: 'Temporarily unavailable. Please try submitting again.' }),
      });
      return;
    }
    const response = await route.fetch({
      url: localWorker,
      headers: { ...route.request().headers(), origin },
    });
    await route.fulfill({ response });
  });
  await page.goto(origin);
  await page.locator('.trivia-question').last().waitFor();
  assert.equal(await page.locator('.trivia-question').count(), 3);
  const ids = await page.locator('.trivia-question').evaluateAll(nodes => nodes.map(n => n.dataset.questionId));
  assert.equal(new Set(ids).size, 3);
  assert(ids.every(id => deck.questions.some(q => q.id === id)));
  assert.equal(await page.getByText('0 of 3 answered').count(), 1);
  await page.locator('#submit').click();
  assert.equal(submissions.length, 0, 'Incomplete forms must not submit');
  const answers = ["A test answer with x < 1 and O'Brien's explanation.", 'I am not sure; this is a local test.', 'A third local test answer.'];
  for (let i = 0; i < ids.length; i++) {
    await page.locator(`#answer-${ids[i]}`).fill(answers[i]);
    await page.locator(`input[name="clarity-${ids[i]}"][value="${[5, 3, 4][i]}"]`).check();
  }
  await page.locator(`#technical-${ids[0]}`).fill('Local test: clarify the assumptions.');
  await page.locator('input[name="background"][value="academia_other"]').check();
  await page.locator('input[name="highest_degree"][value="masters"]').check();
  await page.reload();
  await page.locator('.trivia-question').last().waitFor();
  assert.deepEqual(await page.locator('.trivia-question').evaluateAll(nodes => nodes.map(n => n.dataset.questionId)), ids);
  assert.equal(await page.locator(`#answer-${ids[0]}`).inputValue(), answers[0]);
  assert.equal(await page.locator('input[name="background"]:checked').inputValue(), 'academia_other');
  assert.equal(await page.locator('input[name="highest_degree"]:checked').inputValue(), 'masters');
  assert.equal(await page.getByText('3 of 3 answered').count(), 1);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForFunction(() => {
    const fill = document.getElementById('progress-fill');
    return fill.getBoundingClientRect().width >= fill.parentElement.getBoundingClientRect().width - 1;
  });
  await page.screenshot({ path: 'test-results/desktop.png', fullPage: true });
  await page.locator('#submit').click();
  await page.locator('#submit-error').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#complete-view').isVisible(), false);
  assert.equal(await page.locator(`#answer-${ids[0]}`).inputValue(), answers[0]);
  await page.locator('#submit').click();
  await page.locator('#complete-view').waitFor({ state: 'visible' });
  assert.equal(submissions.length, 2);
  assert.equal(submissions[1].questions.length, 3);
  assert.equal(submissions[1].background, 'academia_other');
  assert.equal(submissions[1].highest_degree, 'masters');
  assert.equal(submissions[1].questions[0].answer, answers[0]);
  const repeat = await fetch(localWorker, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' },
    body: JSON.stringify(submissions[1]),
  });
  assert.equal(repeat.status, 200);
  assert.deepEqual(await repeat.json(), { ok: true, saved: 3 });
  const changed = structuredClone(submissions[1]);
  changed.questions[2].question_id = deck.questions.find(q => !ids.includes(q.id)).id;
  const collision = await fetch(localWorker, {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' },
    body: JSON.stringify(changed),
  });
  assert.equal(collision.status, 503, 'A conflicting retry must not append a different fourth question');
  const respondent = submissions[1].respondent_id;
  assert.match(respondent, /^[0-9a-f-]{36}$/i);
  const raw = execFileSync('npx', ['--yes', 'wrangler', 'd1', 'execute', 'survey-responses', '--local', '--config', 'worker/wrangler.toml', '--command', `SELECT * FROM trivia_responses WHERE respondent_id = '${respondent}' ORDER BY question_position`, '--json'], { encoding: 'utf8' });
  const rows = JSON.parse(raw)[0].results;
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map(r => r.question_id), ids);
  assert.deepEqual(rows.map(r => r.answer), answers);
  assert(rows.every(r => r.background === 'academia_other' && r.highest_degree === 'masters'));
  await page.reload();
  await page.locator('#complete-view').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#survey-form').isVisible(), false);
  await page.screenshot({ path: 'test-results/confirmation.png', fullPage: true });
  const mobile = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 1 });
  const mobilePage = await mobile.newPage();
  mobilePage.on('pageerror', error => errors.push(error.message));
  await mobilePage.route(productionPattern, route => route.abort());
  await mobilePage.goto(origin);
  await mobilePage.locator('.trivia-question').last().waitFor();
  assert.equal(await mobilePage.locator('.trivia-question').count(), 3);
  assert(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), 'Mobile layout must not overflow horizontally');
  await mobilePage.evaluate(() => document.fonts.ready);
  await mobilePage.screenshot({ path: 'test-results/mobile.png', fullPage: true });
  await mobilePage.setViewportSize({ width: 320, height: 800 });
  assert(await mobilePage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), '320px layout must not overflow horizontally');
  assert.deepEqual(errors, []);
  console.log('PASS: three unique questions, required answers/profile, refresh persistence, failure retention, real local D1 submission, retry idempotency, conflicting retry rollback, completion persistence, desktop/mobile layouts.');
  console.log('Production received no test submissions. Screenshots: test-results/.');
} finally {
  await browser.close();
}
