import pathlib
import re

f = pathlib.Path('wms_platform/management/commands/seed_data.py')
text = f.read_text(encoding='utf-8')

# Replace all non-ASCII chars in stdout.write calls with nothing
def replace_emoji(m):
    s = m.group(0)
    return re.sub(r'[^\x00-\x7F]', '', s)

new = re.sub(r'self\.stdout\.write\([^\)]+\)', replace_emoji, text)
f.write_text(new, encoding='utf-8')
print('Emoji stripped from seed_data.py')
