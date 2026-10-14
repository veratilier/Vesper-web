"""Install the checked backend modules while preserving compatible live wake changes."""
import argparse,ast,hashlib,shutil,time,os,stat,tempfile
from pathlib import Path

RPC_BASE = 'af98a1c1650cffbce5d6ab379a61e7552e929335aefeca21a4e8bf2bfddeb4b4'
CONFIG_BASE = '6f883e78e523922a0f5514632c53168c89f3fbbf789b58f0c18379c53412894c'
def fingerprint(node):return hashlib.sha256(ast.dump(node,include_attributes=False).encode()).hexdigest()
def patch_wake(source):
    tree=ast.parse(source)
    rpc=next(n for n in tree.body if isinstance(n,ast.ClassDef) and n.name=='Rpc')
    if rpc.bases and ast.unparse(rpc.bases[0])=='CodexRpc':return source
    config=next(n for n in tree.body if isinstance(n,ast.Assign) and any(isinstance(t,ast.Name) and t.id=='CONFIG' for t in n.targets))
    if fingerprint(rpc)!=RPC_BASE or fingerprint(config)!=CONFIG_BASE:
        raise ValueError('Live model transport/config changed; inspect before installing')
    lines=source.splitlines()
    lines[rpc.lineno-1:rpc.end_lineno]=['class Rpc(CodexRpc):','    def __init__(self): super().__init__(WORK)']
    lines[config.lineno-1:config.end_lineno]=[]
    patched='\n'.join(lines)+'\n'
    parsed=ast.parse(patched);position=0
    for node in parsed.body:
        if isinstance(node,ast.Expr) and isinstance(node.value,ast.Constant) and isinstance(node.value.value,str) or isinstance(node,ast.ImportFrom) and node.module=='__future__':position=node.end_lineno
        else:break
    lines=patched.splitlines();lines.insert(position,'from vesper_backend.codex_provider import Rpc as CodexRpc, CONFIG')
    return '\n'.join(lines)+'\n'

def install(target, expected_history):
    source=Path(__file__).resolve().parent
    if hashlib.sha256((target/'codex_history_server.py').read_bytes()).hexdigest() not in {expected_history,hashlib.sha256((source/'codex_history_server.py').read_bytes()).hexdigest()}:
        raise ValueError('Live gateway changed; preserve it and inspect before installing')
    wake=patch_wake((target/'vesper_wake_runner.py').read_text())
    artifacts={Path('vesper_wake_runner.py'):wake.encode()}
    for name in ['codex_history_server.py','vesper_screen_companion.py','vesper_companion_poke.py']:
        artifacts[Path(name)]=(source/name).read_bytes()
    for file in (source/'vesper_backend').glob('*.py'):
        artifacts[Path('vesper_backend')/file.name]=file.read_bytes()
    for name,data in artifacts.items():compile(data,str(name),'exec')
    backup=target/('deploy-backend-boundaries-'+time.strftime('%Y%m%d-%H%M%S'));backup.mkdir(mode=0o700)
    # Complete the package before changing any existing importer. Preserve executable bits.
    for relative,data in sorted(artifacts.items(),key=lambda item:0 if item[0].parts[0]=='vesper_backend' else 1):
        file=target/relative
        mode=stat.S_IMODE(file.stat().st_mode) if file.exists() else 0o644
        if file.exists():
            old=backup/relative;old.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(file,old)
        file.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
        stage=file.with_name(file.name+'.pending');stage.write_bytes(data);os.chmod(stage,mode);stage.replace(file)
    return backup
if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--target',type=Path,required=True);parser.add_argument('--expected-history-sha256',required=True)
    args=parser.parse_args();print(install(args.target,args.expected_history_sha256))
