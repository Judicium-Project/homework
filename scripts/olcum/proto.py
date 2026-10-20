import tomllib, re, subprocess, pathlib, fnmatch
ROOT=pathlib.Path(__file__).resolve().parents[2]
def g2re(g):
    # ** crossing dirs, * within segment
    r=re.escape(g).replace(r'\*\*/','(?:.*/)?').replace(r'\*\*','.*').replace(r'\*','[^/]*')
    return re.compile('^'+r+'$')
for f in ['clean-1','clean-2','g45','g46','g46-tur1']:
    c=tomllib.loads((ROOT/'fixtures'/f/'contract.toml').read_text())
    d=pathlib.Path('/tmp/homework-olcum')/f
    subprocess.run(['git','add','-N','.'],cwd=d)
    names=subprocess.run(['git','diff','--name-only','HEAD'],cwd=d,capture_output=True,text=True).stdout.split()
    allowed=[g2re(g) for g in c['allowed_paths']]
    oos=[n for n in names if not any(a.match(n) for a in allowed)]
    fp=[g2re(g) for g in c['forbidden']['paths']]; ex=[g2re(g) for g in c['forbidden']['paths_except']]
    forb=[n for n in names if any(a.match(n) for a in fp) and not any(a.match(n) for a in ex)]
    hits=[]
    diff=subprocess.run(['git','diff','-U0','HEAD'],cwd=d,capture_output=True,text=True).stdout
    cur=None
    for l in diff.splitlines():
        if l.startswith('+++ b/'): cur=l[6:]
        elif l.startswith('+') and not l.startswith('+++'):
            for p in c['forbidden']['patterns']:
                if any(g2re(g).match(cur) for g in p['globs']) and re.search(p['regex'],l[1:]): hits.append((cur,l[1:60]))
    print(f,'changed',len(names),'| out-of-scope',oos,'| forbidden-path',forb,'| forbidden-pattern',hits)
