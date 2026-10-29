import fs from 'node:fs/promises';
import {spawnSync} from 'node:child_process';
import {resolveDeploymentConfig} from './release-build.mjs';
const [mode,operation]=process.argv.slice(2);
if(!['acceptance','trial'].includes(mode)||!['smoke','health','verify','worker-health'].includes(operation))throw new Error('无效的环境或检查方式');
if(operation==='smoke'&&mode!=='acceptance')throw new Error('试用服务不运行写入测试');
const config=JSON.parse(await fs.readFile('deployment.local.json','utf8'));
const target=resolveDeploymentConfig(config,mode);
const args=operation==='smoke'?['tools/calendar/smoke-remote.mjs',target.publicApiOrigin,target.siteOrigin]:
 ['tools/calendar/verify-release.mjs',operation==='worker-health'?target.workerOrigin:target.publicApiOrigin,
  operation==='verify'?target.siteOrigin:'',process.env.CALENDAR_BUILD_VERSION||'',operation==='worker-health'?'worker':'gateway'];
const result=spawnSync(process.execPath,args,{stdio:'inherit',env:process.env});
process.exit(result.status??1);
