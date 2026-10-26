import fs from 'node:fs/promises';
import {buildRelease} from './release-build.mjs';
const mode=process.argv[2];
if(!['acceptance','trial'].includes(mode))throw new Error('明确指定 acceptance 或 trial。');
const config=JSON.parse(await fs.readFile(process.env.CALENDAR_DEPLOY_CONFIG || 'deployment.local.json','utf8'));
const target=config[mode];
if(!target || config.acceptance.databaseId===config.trial.databaseId || config.acceptance.workerName===config.trial.workerName)throw new Error('试用和验收必须使用独立 Worker 与 D1。');
const result=await buildRelease({mode,apiBaseUrl:target.apiBaseUrl,siteOrigin:config.siteOrigin,output:`dist/${mode}`,deployment:target});
console.log(JSON.stringify({environment:mode,...result.release}));
