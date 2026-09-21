// Scheduling is server-owned; exercise the persistent scheduler, not browser time.
import {spawnSync} from 'node:child_process';
const result=spawnSync('python3',['-m','unittest','discover','-s','vps','-p','test_wake.py'],{stdio:'inherit'});
process.exit(result.status ?? 1);
