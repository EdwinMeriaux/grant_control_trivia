#!/usr/bin/env python3
"""Export this trivia survey from Cloudflare D1 after Wrangler login."""

import csv
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
output = Path(sys.argv[1]).expanduser().resolve() if len(sys.argv) > 1 else Path.home() / 'Downloads' / 'grant-control-trivia-responses.csv'
result = subprocess.run([
    'npx', '--yes', 'wrangler', 'd1', 'execute', 'survey-responses', '--remote',
    '--config', str(ROOT / 'worker' / 'wrangler.toml'), '--command',
    "SELECT * FROM trivia_responses WHERE game = 'grant-control-trivia' ORDER BY received_at DESC, respondent_id, question_position", '--json',
], text=True, capture_output=True, check=True)
rows = json.loads(result.stdout)[0]['results']
columns = ['respondent_id', 'game', 'survey_version', 'deck_version', 'started_at', 'completed_at', 'background', 'highest_degree', 'question_position', 'question_id', 'question_title', 'question_topic', 'question_text', 'answer', 'clarity', 'technical_issues', 'received_at']
with output.open('w', newline='', encoding='utf-8-sig') as handle:
    writer = csv.DictWriter(handle, fieldnames=columns)
    writer.writeheader()
    for row in rows:
        writer.writerow({key: "'" + value if isinstance(value, str) and value.lstrip().startswith(('=', '+', '-', '@')) else value for key, value in row.items()})
print(f'Exported {len(rows)} question responses to {output}')
