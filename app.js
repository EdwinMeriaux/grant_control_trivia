/* Three questions per participant, displayed together on one page. */
const $ = id => document.getElementById(id);
const config = window.SURVEY_CONFIG;
const storageKey = 'grant-control-trivia:three-question-survey:v1';
const backgrounds = ['academia_controls', 'academia_other', 'non_academia'];
const degrees = ['phd', 'masters', 'undergrad', 'other'];
const topicColors = { 'H∞ control': '#a1551b', 'LQR': '#285f9c', 'LQG': '#287b70', 'Bang-bang control': '#78549b', 'Nonlinear control': '#916127' };
const escapeHtml = text => String(text ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
let deck;
let state;
let busy = false;

function readDraft() {
  try { return JSON.parse(sessionStorage.getItem(storageKey)); } catch { return null; }
}
function persist() {
  try { sessionStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* The current form still works when storage is unavailable. */ }
}
function shuffled(source) {
  const result = [...source];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}
function finish() {
  $('survey-view').hidden = true;
  $('complete-view').hidden = false;
  $('complete-title').focus({ preventScroll: true });
  window.scrollTo({ top: 0, behavior: 'instant' });
}
function selectedQuestions() {
  return state.question_ids.map(id => deck.questions.find(q => q.id === id));
}
function collect() {
  for (const question of selectedQuestions()) {
    const id = question.id;
    const clarity = document.querySelector(`input[name="clarity-${id}"]:checked`);
    state.answers[id] = {
      answer: $(`answer-${id}`).value,
      clarity: clarity ? Number(clarity.value) : null,
      technical_issues: $(`technical-${id}`).value,
    };
  }
  state.background = document.querySelector('input[name="background"]:checked')?.value ?? null;
  state.highest_degree = document.querySelector('input[name="highest_degree"]:checked')?.value ?? null;
  const count = Object.values(state.answers).filter(a => a.answer?.trim() && Number.isInteger(a.clarity) && a.clarity >= 1 && a.clarity <= 5).length;
  const text = `${count} of 3 answered`;
  if ($('progress-text').textContent !== text) $('progress-text').textContent = text;
  $('progress-fill').style.width = `${100 * count / 3}%`;
  document.querySelector('[role="progressbar"]').setAttribute('aria-valuenow', String(count));
  persist();
}
function render() {
  $('questions').innerHTML = selectedQuestions().map((question, index) => {
    const id = question.id;
    const answer = state.answers[id] ?? {};
    return `<article class="trivia-question" data-question-id="${id}" aria-labelledby="title-${id}">
      <div class="question-bar"><span class="question-number">Question ${index + 1} of 3</span><span class="pill">${escapeHtml(question.topic)}</span></div>
      <div class="question-grid">
        <section class="prompt" style="--topic-color:${topicColors[question.topic] ?? '#a1551b'}">
          <div class="topic-label">${escapeHtml(question.topic)}</div>
          <h3 id="title-${id}">${escapeHtml(question.title)}</h3>
          ${question.paragraphs.map(p => `<p>${escapeHtml(p)}</p>`).join('')}
          <p class="prompt-note">Give your answer and a brief explanation.</p>
          <details class="original"><summary>View original question card</summary><img src="${escapeHtml(question.image)}" alt="Original card: ${escapeHtml(question.title)}" width="504" height="720" loading="lazy"></details>
        </section>
        <div class="answer-fields">
          <div class="question"><label for="answer-${id}">What do you think the answer is?</label><textarea class="answer-input" id="answer-${id}" name="answer-${id}" maxlength="5000" required aria-describedby="title-${id}" placeholder="Your answer and a brief explanation. “I’m not sure” is fine.">${escapeHtml(answer.answer)}</textarea></div>
          <fieldset class="question"><legend>How clear is this question?</legend><div class="rating">${[1,2,3,4,5].map(n => `<label><input type="radio" name="clarity-${id}" value="${n}" ${answer.clarity === n ? 'checked' : ''} required aria-label="${n} out of 5"><span>${n}</span></label>`).join('')}</div><div class="scale"><span>1 · Very unclear</span><span>5 · Very clear</span></div></fieldset>
          <div class="question"><label for="technical-${id}">Any technical issues? <span class="optional">(optional)</span></label><textarea id="technical-${id}" name="technical-${id}" maxlength="5000" placeholder="Flag any errors, missing assumptions, or technical ambiguities.">${escapeHtml(answer.technical_issues)}</textarea></div>
        </div>
      </div>
    </article>`;
  }).join('');
  for (const name of ['background', 'highest_degree']) {
    for (const input of document.querySelectorAll(`input[name="${name}"]`)) input.checked = input.value === state[name];
  }
  $('survey-form').hidden = false;
  collect();
}
async function load() {
  $('load-error').hidden = true;
  $('retry-load').hidden = true;
  try {
    const response = await fetch('questions.json', { cache: 'no-store' });
    if (!response.ok) throw new Error('Could not load the questions. Please try again.');
    deck = await response.json();
    if (!Number.isInteger(deck.deck_version) || !Array.isArray(deck.questions) || deck.questions.length < 3 || new Set(deck.questions.map(q => q.id)).size !== deck.questions.length) throw new Error('The question deck is unavailable. Please contact the survey organizer.');
    const saved = readDraft();
    if (saved?.complete === true && saved.deck_version === deck.deck_version) { state = saved; finish(); return; }
    const canRestore = saved && saved.deck_version === deck.deck_version &&
      typeof saved.respondent_id === 'string' && Number.isFinite(Date.parse(saved.started_at)) &&
      Array.isArray(saved.question_ids) && saved.question_ids.length === 3 &&
      new Set(saved.question_ids).size === 3 && saved.question_ids.every(id => deck.questions.some(q => q.id === id)) &&
      saved.answers && typeof saved.answers === 'object';
    state = canRestore ? saved : {
      respondent_id: crypto.randomUUID(), started_at: new Date().toISOString(),
      deck_version: deck.deck_version, question_ids: shuffled(deck.questions).slice(0, 3).map(q => q.id),
      answers: {}, background: null, highest_degree: null,
    };
    render();
  } catch (error) {
    $('load-error').textContent = error.message || 'Could not load the questions. Please try again.';
    $('load-error').hidden = false;
    $('retry-load').hidden = false;
    $('progress-text').textContent = 'Questions could not be loaded';
  }
}
async function submit(event) {
  event.preventDefault();
  if (busy) return;
  collect();
  $('submit-error').hidden = true;
  try {
    for (const question of selectedQuestions()) {
      const answer = state.answers[question.id];
      if (!answer.answer.trim()) {
        $(`answer-${question.id}`).focus();
        throw new Error('Please give an answer for each question. You can write “I’m not sure.”');
      }
      if (!Number.isInteger(answer.clarity) || answer.clarity < 1 || answer.clarity > 5) throw new Error('Please rate the clarity of all three questions.');
    }
    if (!backgrounds.includes(state.background) || !degrees.includes(state.highest_degree)) throw new Error('Please select your background and highest degree.');
    if (!config.submissionEndpoint) throw new Error('Response collection is unavailable. Please contact the survey organizer. Your answers are still in this form.');
    busy = true;
    $('submit').disabled = true;
    $('submit').textContent = 'Submitting…';
    state.completed_at ??= new Date().toISOString();
    persist();
    const payload = {
      game: config.game, survey_version: 1, deck_version: state.deck_version,
      respondent_id: state.respondent_id, started_at: state.started_at,
      completed_at: state.completed_at, background: state.background, highest_degree: state.highest_degree,
      questions: selectedQuestions().map(q => ({ question_id: q.id, answer: state.answers[q.id].answer.trim(), clarity: state.answers[q.id].clarity, technical_issues: state.answers[q.id].technical_issues.trim() })),
    };
    const response = await fetch(config.submissionEndpoint, {
      method: 'POST', headers: { 'Content-Type': 'text/plain;charset=UTF-8' }, body: JSON.stringify(payload),
    });
    let result;
    try { result = await response.json(); } catch { throw new Error('The server did not confirm your submission. Please try again.'); }
    if (!response.ok || result.ok !== true || result.saved !== 3) throw new Error(result.error || 'Your responses were not confirmed. Please try submitting again.');
    state.complete = true;
    persist();
    finish();
  } catch (error) {
    $('submit-error').textContent = error.message === 'Failed to fetch' ? 'Could not connect. Check your connection and try submitting again. Your answers are still in this form.' : (error.message || 'Unable to submit. Please try again.');
    $('submit-error').hidden = false;
  } finally {
    busy = false;
    $('submit').disabled = false;
    $('submit').innerHTML = 'Submit all three responses <span aria-hidden="true">→</span>';
  }
}
$('survey-form').addEventListener('input', () => { if (state) collect(); });
$('survey-form').addEventListener('change', () => { if (state) collect(); });
$('survey-form').addEventListener('submit', submit);
$('retry-load').addEventListener('click', load);
load();
