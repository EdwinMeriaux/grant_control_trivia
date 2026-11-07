#!/usr/bin/env python3
"""Extract only the 12 question cards from the supplied three-page PDF."""

import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'source' / 'questions.pdf'
DECK_VERSION = 2
# Titles are transcribed from the question PDF; prompts are extracted verbatim.
CARDS = [
    ('TW-HINF-01', 'What does the bound guarantee?'),
    ('TW-HINF-02', 'A small-gain certificate'),
    ('TW-LQR-01', 'Which Riccati root?'),
    ('TW-LQR-02', 'Scaling both cost weights'),
    ('TW-LQG-01', 'Poles after adding an estimator'),
    ('TW-LQG-02', 'A noisier sensor'),
    ('TW-BB-01', 'Accelerate, then brake'),
    ('TW-BB-02', 'When the switching function vanishes'),
    ('TW-NL-01', 'Beyond a non-increasing V'),
    ('TW-NL-02', 'A local result has limits'),
    ('TW-NL-03', 'Exact feedback linearization'),
    ('TW-NL-04', 'Attraction to a cycle'),
]
TOPICS = {
    'HINF': 'H∞ control', 'LQR': 'LQR', 'LQG': 'LQG',
    'BB': 'Bang-bang control', 'NL': 'Nonlinear control',
}


def main():
    images = ROOT / 'question-images'
    images.mkdir(exist_ok=True)
    questions = []
    for index, (question_id, title) in enumerate(CARDS):
        page = index // 4 + 1
        quadrant = index % 4
        x = 45 if quadrant % 2 == 0 else 315
        y = 36 if quadrant < 2 else 414
        text = subprocess.run([
            'pdftotext', '-f', str(page), '-l', str(page),
            '-x', str(x), '-y', str(y), '-W', '252', '-H', '360',
            '-layout', str(SOURCE), '-'
        ], text=True, capture_output=True, check=True).stdout.strip()
        assert question_id in text, f'Wrong card extracted: {question_id}'
        assert len(re.findall(r'TW-[A-Z]+-\d{2}', text)) == 1
        topic = TOPICS[question_id.split('-')[1]]
        prefix = r'^\s*' + r'\s+'.join(re.escape(word) for word in (topic + ' ' + title).split()) + r'\s*'
        prompt, replaced = re.subn(prefix, '', text, count=1, flags=re.IGNORECASE)
        assert replaced == 1, f'Question title changed in PDF: {question_id}'
        prompt = prompt.split(question_id)[0].strip()
        # Keep stacked state equations separate instead of merging them together.
        prompt = re.sub(r'(?m)^[ \t]*(?=dx[₀-₉]+/dt\s*=)', '\n', prompt)
        paragraphs = [' '.join(part.split()) for part in re.split(r'\n\s*\n', prompt) if part.strip()]
        assert paragraphs and 'Suggested:' not in ' '.join(paragraphs)
        subprocess.run([
            'pdftoppm', '-f', str(page), '-l', str(page), '-r', '144',
            '-x', str(x * 2), '-y', str(y * 2), '-W', '504', '-H', '720',
            '-singlefile', '-png', str(SOURCE), str(images / question_id)
        ], check=True, capture_output=True)
        questions.append({
            'id': question_id, 'title': title, 'topic': topic,
            'paragraphs': paragraphs, 'image': f'question-images/{question_id}.png',
        })
    current_images = {Path(question['image']).name for question in questions}
    for old_image in images.glob('TW-*.png'):
        if old_image.name not in current_images:
            old_image.unlink()
    output = {'deck_version': DECK_VERSION, 'questions': questions}
    (ROOT / 'questions.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(f'Extracted {len(questions)} question cards. No answer-guide content is included.')


if __name__ == '__main__':
    main()
