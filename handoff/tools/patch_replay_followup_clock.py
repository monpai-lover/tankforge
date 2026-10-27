"""Repair the installed supplied-V3 session without rebuilding its stale source."""
from pathlib import Path
root=Path(__file__).resolve().parents[2]
path=root/'handoff/bundle/app.js.html'
text=path.read_text(encoding='utf-8')
start='  // BEGIN RECORDED FOLLOWUP CLOCK\n'
end='  // END RECORDED FOLLOWUP CLOCK\n'
helper=(root/'handoff/tools/replay_followup_clock.js').read_text(encoding='utf-8')
block=start+helper+end
if start in text:
    a=text.index(start); b=text.index(end,a)+len(end)
else:
    a=text.index('  // A later round of a held session starts at its contact:')
    b=text.index('  var smooth4 = ',a)
text=text[:a]+block+text[b:]
path.write_text(text,encoding='utf-8',newline='\n')
print('Updated independent followup sampling; retained the supplied renderer and director')
