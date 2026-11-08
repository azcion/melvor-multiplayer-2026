#!/usr/bin/env python3
"""Reproduce the reviewed Adventure subset from a pinned official Demo package.

Usage: python3 scripts/extract-adventure-catalog.py melvorDemo.json [output.json]
No upstream scripts are executed. New source hashes/mechanics require a new review.
"""
import hashlib
import json
import sys
from pathlib import Path

PIN = 'ba3832348dc252c925c7ea5c7560d23bb58c1f49effe41cb0fc5ce229c0d1a06'
AREA_IDS = ['Goblin_Village', 'Wet_Forest', 'Farmlands', 'Dragon_Valley', 'Wizard_Tower',
            'Castle_of_Kings', 'Bandit_Hideout', 'Giant_Dungeon', 'Sandy_Shores',
            'Icy_Hills', 'Graveyard', 'ElerineBattlegrounds']
FIELDS = ['name', 'levels', 'equipmentStats', 'attackType', 'lootChance', 'lootTable', 'bones', 'currencyDrops']


def extract(path):
    content = Path(path).read_bytes()
    if hashlib.sha256(content).hexdigest() != PIN:
        raise ValueError('Unreviewed official source hash')
    package = json.loads(content)
    data = package['data']
    monsters = {m['id']: m for m in data['monsters']}
    areas = {a['id']: a for a in data['combatAreas']}
    selected = []
    for area_id in AREA_IDS:
        area = areas[area_id]
        if area.get('entryRequirements'):
            raise ValueError('Unreviewed area requirements')
        subset = []
        for monster_id in area['monsterIDs']:
            monster = monsters[monster_id.split(':')[1]]
            if monster['attackType'] not in ('melee', 'ranged', 'magic'):
                raise ValueError('Unreviewed attack type')
            unmodeled = bool(monster.get('specialAttacks') or monster.get('passives') or monster['attackType'] == 'magic')
            entry = {**{key: monster[key] for key in FIELDS if key in monster}, 'id': monster_id}
            if unmodeled:
                entry['unmodeled_mechanics'] = True
            subset.append(entry)
        selected.append({'id': 'melvorD:' + area_id, 'name': area['name'], 'monsters': subset})
    return {'version': 3, 'pace': 1, 'spawn_ms': 3000, 'source': {
        'description': 'Official Melvor Idle base-game Combat Area and monster numeric data; monsters with unmodeled mechanics are unavailable; no game modifiers, pets or global drops',
        'retrieved': '2026-11-07',
        'files': [{'url': 'https://melvoridle.com/assets/data/melvorDemo.json', 'sha256': PIN}]
    }, 'areas': selected}


if __name__ == '__main__':
    output = json.dumps(extract(sys.argv[1]), indent=2) + '\n'
    if len(sys.argv) > 2:
        Path(sys.argv[2]).write_text(output)
    else:
        print(output, end='')
