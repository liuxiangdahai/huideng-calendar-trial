import fs from 'node:fs/promises';
import {buildRelease,resolveDeploymentConfig} from './release-build.mjs';
const mode=process.argv[2];
if(!['acceptance','trial'].includes(mode))throw new Error('明确指定 acceptance 或 trial。');
const config=JSON.parse(await fs.readFile(process.env.CALENDAR_DEPLOY_CONFIG || 'deployment.local.json','utf8'));
const target=resolveDeploymentConfig(config,mode);
const result=await buildRelease({mode,apiBaseUrl:target.publicApiOrigin,siteOrigin:target.siteOrigin,output:`dist/${mode}`,deployment:target});
console.log(JSON.stringify({environment:mode,...result.release}));
