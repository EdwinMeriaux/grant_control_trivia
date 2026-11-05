// Submission-only endpoint. Reading responses requires the owner's Cloudflare account.
import deck from '../questions.json' with { type: 'json' };

const reply = (body, status, origin) => Response.json(body, {
  status,
  headers: {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Cache-Control': 'no-store',
    'Vary': 'Origin',
  },
});
const isText = (value, limit) => typeof value === 'string' && value.length <= limit;
const isDate = value => isText(value, 40) && Number.isFinite(Date.parse(value));
const isRating = value => Number.isInteger(value) && value >= 1 && value <= 5;
const isUuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);

export function validateSubmission(data, game) {
  if (!data || data.game !== game || data.survey_version !== 1 || data.deck_version !== deck.deck_version ||
      !isUuid(data.respondent_id) || !isDate(data.started_at) || !isDate(data.completed_at) ||
      Date.parse(data.completed_at) < Date.parse(data.started_at) ||
      !['academia_controls', 'academia_other', 'non_academia'].includes(data.background) ||
      !['phd', 'masters', 'undergrad', 'other'].includes(data.highest_degree) ||
      !Array.isArray(data.questions) || data.questions.length !== 3) return 'Invalid survey submission.';
  if (new Set(data.questions.map(q => q?.question_id)).size !== 3) return 'Please submit three distinct questions.';
  for (const answer of data.questions) {
    const question = deck.questions.find(q => q.id === answer?.question_id);
    if (!question || !isText(answer.answer, 5000) || !answer.answer.trim() ||
        !isRating(answer.clarity) || !isText(answer.technical_issues, 5000)) return 'Invalid question response.';
  }
  return null;
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    if (origin !== env.ALLOWED_ORIGIN) return new Response('Origin not permitted', { status: 403 });
    if (request.method === 'OPTIONS') return reply({ ok: true }, 200, origin);
    if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405, origin);
    try {
      if (Number(request.headers.get('Content-Length')) > 131072) return reply({ error: 'Submission too large.' }, 413, origin);
      const body = await request.text();
      if (body.length > 65000) return reply({ error: 'Submission too large.' }, 413, origin);
      let data;
      try { data = JSON.parse(body); } catch { return reply({ error: 'Invalid JSON.' }, 400, origin); }
      const error = validateSubmission(data, env.GAME);
      if (error) return reply({ error }, 400, origin);
      const statements = data.questions.map((answer, index) => {
        const question = deck.questions.find(q => q.id === answer.question_id);
        return env.DB.prepare(`INSERT INTO trivia_responses (
          respondent_id, game, survey_version, deck_version, started_at, completed_at,
          background, highest_degree, question_position, question_id, question_title,
          question_topic, question_text, answer, clarity, technical_issues
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(game, respondent_id, question_id) DO NOTHING`).bind(
          data.respondent_id, data.game, data.survey_version, data.deck_version,
          data.started_at, data.completed_at, data.background, data.highest_degree,
          index + 1, question.id, question.title, question.topic,
          question.paragraphs.join('\n\n'), answer.answer.trim(), answer.clarity,
          answer.technical_issues.trim(),
        );
      });
      statements.push(env.DB.prepare('SELECT question_id FROM trivia_responses WHERE game = ? AND respondent_id = ?')
        .bind(data.game, data.respondent_id));
      // D1 batch commits all three responses together, or rolls the batch back.
      const results = await env.DB.batch(statements);
      const saved = results.at(-1)?.results ?? [];
      if (results.some(r => !r.success) || saved.length !== 3 ||
          !data.questions.every(q => saved.some(r => r.question_id === q.question_id))) throw new Error('Database write failed');
      return reply({ ok: true, saved: 3 }, 200, origin);
    } catch {
      return reply({ error: 'Unable to save your responses. Please try submitting again.' }, 503, origin);
    }
  },
};
