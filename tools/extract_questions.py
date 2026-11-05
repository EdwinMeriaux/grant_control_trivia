#!/usr/bin/env python3
"""Extract only the 12 question cards from the supplied three-page PDF."""

import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / 'source' / 'questions.pdf'
# Titles are transcribed from the question PDF; prompts are extracted verbatim.
CARDS = [
    ('TW-PID-01', 'A quick PI stability check'),
    ('TW-PID-02', 'Why does the integrator wind up?'),
    ('TW-STA-01', 'A Lyapunov derivative with zeros'),
    ('TW-STA-02', 'Which initial states return to zero?'),
    ('TW-LIN-01', 'An uncontrollable but stabilizable system'),
    ('TW-LIN-02', 'Can one input control both states?'),
    ('TW-EST-01', 'How much should a Kalman update move?'),
    ('TW-EST-02', 'Can state and bias be separated?'),
    ('TW-MPC-01', 'A bounded control move'),
    ('TW-MPC-02', 'What does receding horizon mean?'),
    ('TW-MAS-01', 'Connected, but still no consensus'),
    ('TW-MAS-02', 'Consensus can be a weighted average'),
]
TOPICS = {
    'PID': 'Feedback / PID', 'STA': 'Stability', 'LIN': 'Linear Systems',
    'EST': 'Estimation', 'MPC': 'Optimization / MPC', 'MAS': 'Multi-Agent Systems',
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
        assert len(re.findall(r'TW-[A-Z]{3}-\d{2}', text)) == 1
        topic = TOPICS[question_id.split('-')[1]]
        prefix = r'^\s*' + r'\s+'.join(re.escape(word) for word in (topic + ' ' + title).split()) + r'\s*'
        prompt, replaced = re.subn(prefix, '', text, count=1, flags=re.IGNORECASE)
        assert replaced == 1, f'Question title changed in PDF: {question_id}'
        prompt = prompt.split(question_id)[0].strip()
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
    output = {'deck_version': 1, 'questions': questions}
    (ROOT / 'questions.json').write_text(json.dumps(output, ensure_ascii=False, indent=2) + '\n')
    print(f'Extracted {len(questions)} question cards. No answer-guide content is included.')


if __name__ == '__main__':
    main()
