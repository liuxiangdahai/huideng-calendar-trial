// Separate independent acceptance batches so their fixtures do not exceed the
// production 20-creations/day limit on the local preview's single IP address.
// Each Playwright invocation starts its own in-memory database. Do not weaken
// the service limit or trust spoofed forwarding headers to make tests pass.
import {readdirSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {buildRelease} from './release-build.mjs';
const require=createRequire(import.meta.url);
const cli=require.resolve('@playwright/test/cli');
const files=readdirSync('tests/browser').filter(name=>name.endsWith('.spec.mjs')).sort();
const entry='calendar-entry.spec.mjs';
const batches=[files.filter(name=>name!==entry),files.filter(name=>name===entry)];
const browsers=process.argv.includes('--all') ? ['chromium','firefox','webkit'] : ['chromium'];
await buildRelease({mode:'local'});
for(const browser of browsers) for(const [index,batch] of batches.entries()) {
  if(!batch.length)continue;
  const result=spawnSync(process.execPath,[cli,'test',`--project=${browser}`,...batch.map(name=>`tests/browser/${name}`)],
    {stdio:'inherit',env:{...process.env,CALENDAR_TEST_OUTPUT:`test-results/${browser}/batch-${index+1}`}});
  if(result.error)throw result.error;
  if(result.status!==0)process.exit(result.status||1);
}
