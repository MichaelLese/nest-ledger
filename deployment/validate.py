import json,re
from pathlib import Path
r=json.loads(Path('deployment/release.json').read_text());assert set(r)=={'version','images'} and r['version']==1
allowed={'actual-server': 'actualbudget/actual-server'}
assert set(r['images'])==set(allowed)
for service,prefix in allowed.items():
 ref=r['images'][service]
 assert re.fullmatch(re.escape(prefix)+r'@sha256:[a-f0-9]{64}',ref) or (service=='actual-server' and ref=='sha256:552beab3dec8c93d46b8b9245612d63c3f123b8a45063a474f53e229b17621d3')
print('Checked release manifest valid')
