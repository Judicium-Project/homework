import subprocess, json, pathlib, re, sys, os
ROOT=pathlib.Path(__file__).resolve().parents[2]
V=str(ROOT/'.venv/bin/ast-grep')
R=str(ROOT/'src/homework/rules')  # moved in Phase 3
# rule -> languages it is defined for (JSX-only rules have no .ts variant by design)
rules={'window-dunder-assign':('ts','tsx'),'e2e-setcontent':('ts','tsx'),'e2e-external-url':('ts','tsx'),'inline-style-static':('tsx',)}
E2E={'e2e-setcontent','e2e-external-url'}
for f in ['clean-1','clean-2','g45','g46','g46-tur1']:
    d=pathlib.Path('/tmp/homework-olcum')/f
    subprocess.run(['git','add','-N','.'],cwd=d)
    diff=subprocess.run(['git','diff','-U0','HEAD'],cwd=d,capture_output=True,text=True).stdout
    added={};cur=None
    for l in diff.splitlines():
        if l.startswith('+++ b/'): cur=l[6:]; added[cur]=set()
        m=re.match(r'@@ -\S+ \+(\d+)(?:,(\d+))? @@',l)
        if m and cur:
            s=int(m.group(1)); n=int(m.group(2) or 1)
            added[cur].update(range(s,s+n))
    files=[p for p in added if p.endswith(('.ts','.tsx'))]
    print('==',f,'ts files',len(files))
    for r in rules:
      for lang in rules[r]:
        fl=[x for x in files if x.endswith('.'+lang) and (r not in E2E or x.startswith('apps/web/e2e/'))]
        rf=f'{R}/{r}.{lang}.yml'
        if not fl: continue
        if not os.path.exists(rf):
            print(f'ERROR: rule file missing: {rf}', file=sys.stderr); sys.exit(2)
        p=subprocess.run([V,'scan','-r',rf,'--json=stream']+fl,cwd=d,capture_output=True,text=True)
        for l in p.stdout.splitlines():
            h=json.loads(l); ln=h['range']['start']['line']+1
            inadd = ln in added.get(h['file'],())
            print(f"  {r} {h['file']}:{ln} added={inadd} | {h['text'].splitlines()[0][:90]}")
        if p.returncode not in (0,1): print('  ERR',r,p.stderr[:200])
