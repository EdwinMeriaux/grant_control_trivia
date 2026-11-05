# Grant Control Trivia

A companion to the Grant Control and Revise & Resubmit surveys, using the same visual style and participant background choices.

The website immediately assigns **three distinct random questions** from the supplied 12-question PDF and displays all three on one page. For each, participants provide a free-text answer with a brief explanation, a required 1–5 clarity rating, and optional technical feedback. The final background questions ask for academia/controls background and highest degree completed or actively pursuing, using the same values as the other surveys.

Refreshing preserves the three assigned questions and unfinished answers in the same browser tab. All three responses are submitted together. Success appears only after Cloudflare confirms all three saved rows; retries with the same respondent and question IDs do not create duplicates. Refreshing the completed form preserves the confirmation in that tab.

## Content and private answers

`source/questions.pdf` is a copy of the supplied question-card PDF. `tools/extract_questions.py` extracts all 12 question prompts and original card images into `questions.json` and `question-images/`. Both the frontend and Worker use this same question manifest.

The worked-answer PDF remains local. Root-level PDFs and `private/` are ignored by Git. The public build copies an explicit list of frontend assets into `dist/`; it includes no PDFs, worked answers, hints, response exports, or Worker source. No correctness feedback is shown to participants.

## Run locally

Requirements: Node.js 22 or later, Python 3, and Poppler (`pdftotext`, `pdftoppm`).

```sh
npm ci
npm run build
npm test
npm run dev
```

Open `http://127.0.0.1:4173`. The checked-in configuration uses the live submission service, whose allowed origin is the GitHub Pages host. For local browser testing, use a local Worker and the test script rather than writing test responses to production.

```sh
npx wrangler d1 execute survey-responses --local --config worker/wrangler.toml --file worker/schema.sql
npx wrangler dev --local --config worker/wrangler.toml --port 8787 --var ALLOWED_ORIGIN:http://127.0.0.1:4173
# With the static server and local Worker running, in another terminal:
npm run test:browser
```

The browser test uses Playwright with locally installed Chrome, or `CHROME_PATH` when provided. It redirects submissions to the local Worker. Screenshots are saved in ignored `test-results/`.

## Response collection

Responses are stored privately in the existing Cloudflare D1 database **survey-responses**, in a new **trivia_responses** table. The original surveys' **responses** table is unchanged. Each participant produces three rows, with a unique respondent ID and question positions 1–3. The Worker saves authoritative question IDs, titles, topics, and prompt text, as well as the answer, clarity, technical feedback, background, degree, timestamps, and survey/deck versions.

The values for `background` are `academia_controls`, `academia_other`, and `non_academia`; the values for `highest_degree` are `phd`, `masters`, `undergrad`, and `other`.

To view or export answers after Wrangler login:

```sql
SELECT * FROM trivia_responses
WHERE game = 'grant-control-trivia'
ORDER BY received_at DESC, respondent_id, question_position;
```

```sh
python3 tools/export_responses.py
```

The default CSV is `~/Downloads/grant-control-trivia-responses.csv`; an optional first argument selects another output path.

## Deployment

Before publishing the frontend, create the trivia table and deploy its submission Worker:

```sh
npx wrangler d1 execute survey-responses --remote --config worker/wrangler.toml --file worker/schema.sql
npx wrangler deploy --config worker/wrangler.toml
```

The GitHub Pages workflow builds and publishes **only `dist/`** on pushes to `main`. Set the repository's Pages source to **GitHub Actions**. The site URL is `https://edwinmeriaux.github.io/grant_control_trivia/`.

Changing questions requires rebuilding and redeploying both the Worker and frontend. Increment the deck version in the extractor when replacing the deck. The Worker validates the deck version so it cannot silently save answers against a different deck.
