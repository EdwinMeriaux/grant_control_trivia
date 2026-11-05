import test from 'node:test';
import assert from 'node:assert/strict';
import worker, { validateSubmission } from '../worker/worker.js';
import deck from '../questions.json' with { type: 'json' };

const origin = 'https://edwinmeriaux.github.io';
const game = 'grant-control-trivia';
function submission() {
  return {
    game, survey_version: 1, deck_version: deck.deck_version,
    respondent_id: 'fa9bb289-9be8-457a-8fbb-eacac322ab92',
    started_at: '2026-11-05T18:00:00.000Z', completed_at: '2026-11-05T18:05:00.000Z',
    background: 'academia_controls', highest_degree: 'phd',
    questions: deck.questions.slice(0, 3).map(q => ({
      question_id: q.id, answer: "I think it is stable; here's my explanation.",
      clarity: 4, technical_issues: '',
    })),
  };
}
function request(body, options = {}) {
  return new Request('https://trivia.example/', {
    method: 'POST', headers: { Origin: origin, 'Content-Type': 'text/plain' },
    body: JSON.stringify(body), ...options,
  });
}
function database() {
  const rows = new Map();
  const batches = [];
  return {
    rows, batches,
    prepare(sql) { return { bind: (...values) => ({ sql, values }) }; },
    async batch(statements) {
      batches.push(statements);
      const next = new Map(rows);
      for (const statement of statements.slice(0, 3)) {
        const key = statement.values[0] + ':' + statement.values[9];
        if (!next.has(key)) next.set(key, statement.values);
      }
      for (const [key, value] of next) rows.set(key, value);
      return [
        ...statements.slice(0, 3).map(() => ({ success: true })),
        { success: true, results: [...rows.values()].filter(v => v[0] === statements[3].values[1]).map(v => ({ question_id: v[9] })) },
      ];
    },
  };
}

test('accepts three answered questions and every supported background/degree', () => {
  for (const background of ['academia_controls', 'academia_other', 'non_academia']) {
    for (const highest_degree of ['phd', 'masters', 'undergrad', 'other']) {
      const data = { ...submission(), background, highest_degree };
      assert.equal(validateSubmission(data, game), null);
    }
  }
});
test('requires exactly three distinct known questions', () => {
  for (const count of [0, 1, 2, 4, 12]) {
    const data = submission();
    data.questions = deck.questions.slice(0, count).map(q => ({ ...data.questions[0], question_id: q.id }));
    assert.ok(validateSubmission(data, game));
  }
  for (const bad of [null, 'unknown', deck.questions[0].id]) {
    const data = submission();
    data.questions[1] = bad === null ? null : { ...data.questions[1], question_id: bad };
    assert.ok(validateSubmission(data, game));
  }
});
test('requires an answer and 1–5 integer clarity, bounds both free-text fields', () => {
  for (const answer of ['', ' \n ', null, 'x'.repeat(5001)]) {
    const data = submission(); data.questions[0].answer = answer;
    assert.ok(validateSubmission(data, game));
  }
  for (const clarity of [0, 6, null, '4', 2.5]) {
    const data = submission(); data.questions[0].clarity = clarity;
    assert.ok(validateSubmission(data, game));
  }
  for (const issues of [null, 1, 'x'.repeat(5001)]) {
    const data = submission(); data.questions[0].technical_issues = issues;
    assert.ok(validateSubmission(data, game));
  }
});
test('rejects invalid profile, identity, versions, and timestamps', () => {
  for (const [key, value] of [
    ['background', null], ['background', 'other'], ['highest_degree', null],
    ['highest_degree', 'doctor'], ['respondent_id', 'same-person'],
    ['survey_version', 2], ['deck_version', 0], ['game', 'grant-control'],
    ['started_at', 'bad'], ['completed_at', '2026-11-04T00:00:00Z'],
  ]) assert.ok(validateSubmission({ ...submission(), [key]: value }, game), key);
});
test('supports preflight, blocks foreign origins and public response reads', async () => {
  const env = { GAME: game, ALLOWED_ORIGIN: origin };
  const preflight = await worker.fetch(new Request('https://trivia.example', { method: 'OPTIONS', headers: { Origin: origin } }), env);
  assert.equal(preflight.status, 200);
  assert.equal(preflight.headers.get('Access-Control-Allow-Origin'), origin);
  assert.equal((await worker.fetch(new Request('https://trivia.example', { headers: { Origin: origin } }), env)).status, 405);
  assert.equal((await worker.fetch(request(submission(), { headers: { Origin: 'https://foreign.example' } }), env)).status, 403);
});
test('writes the complete batch with canonical question metadata and preserves free text', async () => {
  const DB = database();
  const data = submission();
  data.questions[0].title = 'Untrusted replacement';
  data.questions[0].answer = "x < 1; O'Brien's argument <script>not HTML</script>";
  const response = await worker.fetch(request(data), { GAME: game, ALLOWED_ORIGIN: origin, DB });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, saved: 3 });
  assert.equal(DB.batches.length, 1);
  assert.equal(DB.batches[0].length, 4);
  const values = DB.batches[0][0].values;
  assert.equal(values[8], 1);
  assert.equal(values[10], deck.questions[0].title);
  assert.equal(values[12], deck.questions[0].paragraphs.join('\n\n'));
  assert.equal(values[13], data.questions[0].answer);
  assert.equal(values[6], data.background);
  assert.equal(values[7], data.highest_degree);
  assert.match(DB.batches[0][0].sql, /ON CONFLICT\(game, respondent_id, question_id\) DO NOTHING/);
  const repeated = await worker.fetch(request(data), { GAME: game, ALLOWED_ORIGIN: origin, DB });
  assert.equal(repeated.status, 200);
  assert.equal(DB.rows.size, 3);
});
test('malformed requests never touch the database', async () => {
  const DB = database();
  const env = { GAME: game, ALLOWED_ORIGIN: origin, DB };
  assert.equal((await worker.fetch(request({}), env)).status, 400);
  assert.equal((await worker.fetch(request(null, { body: '{' }), env)).status, 400);
  assert.equal((await worker.fetch(request(null, { body: 'x'.repeat(65001) }), env)).status, 413);
  assert.equal(DB.batches.length, 0);
});
test('database errors and incomplete confirmations are reported as failures', async () => {
  for (const DB of [
    { prepare: () => ({ bind: () => ({}) }), batch: async () => { throw new Error('offline'); } },
    { prepare: () => ({ bind: () => ({}) }), batch: async () => [{ success: true, results: [] }] },
  ]) {
    const response = await worker.fetch(request(submission()), { GAME: game, ALLOWED_ORIGIN: origin, DB });
    assert.equal(response.status, 503);
    assert.notEqual((await response.json()).ok, true);
  }
});
