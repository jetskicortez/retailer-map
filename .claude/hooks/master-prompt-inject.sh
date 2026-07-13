#!/usr/bin/env bash
# SessionStart hook (retailer-map): inject the Code-repo operating-discipline master prompt.
# Source of truth: Penelope vault, Areas/AI-OS/Prompts/master-prompt-code.md
# (Code-repo variant of the Fable 5 Preservation Kit master prompt).
# Mirrors Penelope/.claude/hooks/master-prompt-inject.sh. Silent no-op if the
# file is missing.
python -c "
import json
p = r'C:\Users\Jetsk\Penelope\Areas\AI-OS\Prompts\master-prompt-code.md'
try:
    mp = open(p, encoding='utf-8').read()
except OSError:
    raise SystemExit(0)
ctx = 'OPERATING DISCIPLINE (master prompt, binding for this session):\n\n' + mp
print(json.dumps({'hookSpecificOutput': {'hookEventName': 'SessionStart', 'additionalContext': ctx}}))
"
