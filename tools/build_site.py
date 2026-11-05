#!/usr/bin/env python3
"""Build a static site from an explicit list of public assets."""

import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
subprocess.run([sys.executable, str(ROOT / 'tools' / 'extract_questions.py')], check=True)
deck = json.loads((ROOT / 'questions.json').read_text())
assert len(deck['questions']) == 12
assert len({q['id'] for q in deck['questions']}) == 12
assert all(set(q) == {'id', 'title', 'topic', 'paragraphs', 'image'} for q in deck['questions'])
dist = ROOT / 'dist'
if dist.exists():
    shutil.rmtree(dist)
dist.mkdir()
for name in ['index.html', 'site.css', 'config.js', 'app.js', 'questions.json']:
    shutil.copyfile(ROOT / name, dist / name)
shutil.copytree(ROOT / 'question-images', dist / 'question-images')
(dist / '.nojekyll').touch()
assert not list(dist.rglob('*.pdf'))
assert not (dist / 'worker').exists()
print('Built dist/ from public assets only.')
