import subprocess, tomllib, json, pathlib, sys
ROOT=pathlib.Path(__file__).resolve().parents[2]
V=ROOT/'.venv/bin'
OUT=pathlib.Path('/tmp/homework-olcum/out'); OUT.mkdir(exist_ok=True)
for f in ['clean-1','clean-2','g45','g46','g46-tur1']:
    c=tomllib.loads((ROOT/'fixtures'/f/'contract.toml').read_text())
    d=pathlib.Path('/tmp/homework-olcum')/f
    cmd=[str(V/'agentdiff'),'review','--project',str(d),'--json']
    for g in c['allowed_paths']: cmd+=['--scope',g]
    r=subprocess.run(cmd,capture_output=True,text=True)
    (OUT/f'{f}.agentdiff.json').write_text(r.stdout); (OUT/f'{f}.agentdiff.err').write_text(r.stderr)
    print(f,'agentdiff exit',r.returncode, ' '.join(cmd[3:]) if f=='g45' else '')
    prot=list(c['forbidden']['paths'])
    dod={'version':1,'checks':[],'protected':['dod.yaml']+prot}
    import yaml
    dp=pathlib.Path('/tmp/homework-olcum')/f'{f}.dod.yaml'
    dp.write_text(yaml.safe_dump(dod))
    r=subprocess.run([str(V/'dunnit'),'verify','-c',str(dp),'--json'],capture_output=True,text=True,cwd=d)
    (OUT/f'{f}.dunnit.json').write_text(r.stdout); (OUT/f'{f}.dunnit.err').write_text(r.stderr)
    print(f,'dunnit exit',r.returncode)
