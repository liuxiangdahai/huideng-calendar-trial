import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

export const projectRoot = fileURLToPath(new URL('../../', import.meta.url));
const sourceRoot = path.join(projectRoot, 'static/calendar-reminders');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = value => JSON.stringify(value, null, 2) + '\n';
const mime = {'.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.webp':'image/webp','.svg':'image/svg+xml','.ico':'image/x-icon'};
const publicFiles = new Set(['index.html','style.css','calendar-view.css','subscription-guide.css',
  'subscription-guide.mjs','calendar-data.json','config.json','version.json','UNICODE-LICENSE.txt']);

export function origin(value, {local = false} = {}) {
  let url;
  try { url = new URL(value); } catch { throw new Error('请配置完整的 HTTPS 网址。'); }
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && loopback && url.protocol === 'http:')) ||
      url.username || url.password || url.pathname !== '/' || url.search || url.hash ||
      (!local && (loopback || /(?:^|\.)(?:invalid|example|test|localhost)$/.test(url.hostname)))) {
    throw new Error('服务网址必须为真实 HTTPS 源站，不能含路径、凭证或参数。');
  }
  return url.origin;
}

export function resolveBuildOptions(options = {}, env = process.env) {
  const mode = options.mode || env.CALENDAR_BUILD_MODE;
  if (!['offline','local','acceptance','trial'].includes(mode)) throw new Error('请明确指定 --mode offline、local、acceptance 或 trial。');
  const remote = ['acceptance','trial'].includes(mode);
  const apiBaseUrl = mode === 'offline' ? '' : origin(options.apiBaseUrl || env.CALENDAR_API_BASE_URL ||
    (mode === 'local' ? 'http://127.0.0.1:4173' : ''), {local:mode === 'local'});
  const siteOrigin = remote ? origin(options.siteOrigin || env.CALENDAR_SITE_ORIGIN || '') : mode === 'local' ? apiBaseUrl : '';
  let version = options.version || env.CALENDAR_BUILD_VERSION || env.GITHUB_SHA;
  if (!version) {
    try { version = execFileSync('git',['rev-parse','HEAD'],{cwd:projectRoot,encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim(); }
    catch { version = 'development'; }
  }
  if (remote && !/^[a-f0-9]{40}$/.test(version)) throw new Error('线上构建必须使用完整的 Git 提交编号。');
  const output = path.resolve(options.output || path.join(projectRoot,'dist'));
  const relative = path.relative(projectRoot, output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || relative.split(path.sep)[0] !== 'dist') {
    throw new Error('构建输出必须位于本项目的 dist 目录内。');
  }
  return {mode,remote,apiBaseUrl,siteOrigin,version,output};
}

async function filesWithin(directory, prefix = '') {
  const result = [];
  for (const entry of await fs.readdir(directory,{withFileTypes:true})) {
    if (entry.isSymbolicLink()) throw new Error('发布目录中不能包含符号链接。');
    const relative = prefix + entry.name;
    if (entry.isDirectory()) result.push(...await filesWithin(path.join(directory,entry.name),relative + '/'));
    else result.push(relative);
  }
  return result.sort();
}

export function isPublicFile(relative) {
  if (['index.html','version.json','_headers','_redirects'].includes(relative)) return true;
  if (!relative.startsWith('calendar-reminders/')) return false;
  const file = relative.slice('calendar-reminders/'.length);
  return publicFiles.has(file) || /^app-[a-zA-Z0-9]+\.js$/.test(file) ||
    /^assets\/[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp|svg|ico)$/.test(file) ||
    /^licenses\/[a-zA-Z0-9_.-]+\.(txt|md)$/.test(file);
}

async function normalizedHTML() {
  return (await fs.readFile(path.join(sourceRoot,'index.html'),'utf8'))
    .replaceAll('https://www.huidengvan.org/','https://huidengvan.com/')
    .replaceAll('href="/"','href="https://huidengvan.com/"')
    .replace('href="/huideng.ico"','href="./assets/huideng-logo.png"');
}
const releaseTag = release => `<meta name="calendar-build" content="${release.version}">\n<meta name="calendar-data-version" content="${release.dataVersion}">`;

export async function buildStandalone({output,release,config={apiBaseUrl:''}} = {}) {
  output = path.resolve(output || path.join(projectRoot,'dist/藏历日历.html'));
  const relative = path.relative(projectRoot,output);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('单文件输出必须位于本项目内。');
  const bytes = await fs.readFile(path.join(sourceRoot,'calendar-data.json'));
  release ||= {version:'development',dataVersion:hash(bytes),rendererVersion:'snapshot-v1',environment:'offline'};
  let html = await normalizedHTML();
  const bundle = await build({entryPoints:[path.join(sourceRoot,'app.mjs')],bundle:true,format:'iife',
    platform:'browser',target:['safari15.4','chrome100','firefox102'],write:false,minify:true,legalComments:'inline'});
  const dataURI = async relative => {
    const asset = path.resolve(sourceRoot,relative);
    if (!asset.startsWith(sourceRoot + path.sep) || !mime[path.extname(asset)]) throw new Error('单文件包含不允许的素材路径。');
    return `data:${mime[path.extname(asset)]};base64,${(await fs.readFile(asset)).toString('base64')}`;
  };
  for (const match of [...html.matchAll(/<link rel="stylesheet" href="\.\/([a-z-]+\.css)">/g)]) {
    let css = await fs.readFile(path.join(sourceRoot,match[1]),'utf8');
    for (const asset of [...css.matchAll(/url\(['"]?(\.\/assets\/[^)'"\s]+)['"]?\)/g)]) {
      const uri=await dataURI(asset[1]);
      css = css.replaceAll(asset[0],()=>`url('${uri}')`);
    }
    html = html.replace(match[0],()=>`<style>${css.replace(/<\/style/gi,'<\\/style')}</style>`);
  }
  for (const match of [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"\s]+)"/g)]) {
    const uri=await dataURI(match[1]);
    html = html.replaceAll(match[0],()=>match[0].replace(match[1],()=>uri));
  }
  // The same formal HTML/CSS/app entry is used; no alternate theme is injected.
  // Callback replacements keep literal dollar sequences intact. A minified
  // identifier such as `$` followed by && must never expand `$&` to the old tag.
  const embedded = value => JSON.stringify(value).replaceAll('<','\\u003c');
  html = html.replace('<script type="module" src="./app.mjs"></script>',
    ()=>`<script id="calendar-inline-data" type="application/json">${embedded(JSON.parse(bytes))}</script>\n` +
    `<script id="calendar-inline-config" type="application/json">${embedded(config)}</script>\n` +
    `<script type="module">${bundle.outputFiles[0].text.replace(/<\/script/gi,'<\\/script')}</script>`)
    .replace('</head>',()=>`${releaseTag(release)}\n</head>`);
  if (/\b(?:src|href)="\.\/|url\(['"]?\.\/assets\//.test(html)) throw new Error('单文件仍引用本地外部资源。');
  await fs.mkdir(path.dirname(output),{recursive:true});
  await fs.writeFile(output,html);
  return {output,release,bytes:Buffer.byteLength(html)};
}

export function assertReleaseInputs(version, cwd=projectRoot) {
    const paths=['static/calendar-reminders','service/calendar','data/calendar','tools/calendar','package.json','package-lock.json'];
    try {
      execFileSync('git',['diff','--exit-code',version,'--',...paths],{cwd,stdio:'pipe'});
      const untracked=execFileSync('git',['ls-files','--others','--exclude-standard','--',...paths],{cwd,encoding:'utf8'});
      if(untracked.trim())throw new Error('untracked release inputs');
    } catch {throw new Error('发布源码或生成日期资料与指定提交不一致；请先核对并提交，再重新构建。');}
}

export async function buildRelease(options = {}, env = process.env) {
  const config = resolveBuildOptions(options,env);
  // Validate and regenerate on every delivery path, including an independent
  // CI checkout; tested source records must not be replaced by stale JSON.
  execFileSync(process.execPath,[path.join(projectRoot,'tools/calendar/build.mjs')],
    {cwd:projectRoot,stdio:['ignore','pipe','pipe']});
  if(config.remote)assertReleaseInputs(config.version);
  const data = await fs.readFile(path.join(sourceRoot,'calendar-data.json'));
  const release = {version:config.version,dataVersion:hash(data),rendererVersion:`snapshot-v1-${config.version}`,environment:config.mode};
  // The exact absolute target has been verified inside this project's dist.
  await fs.rm(config.output,{recursive:true,force:true});
  const site = path.join(config.output,'site'), frontend = path.join(site,'calendar-reminders'), worker = path.join(config.output,'worker');
  await fs.mkdir(frontend,{recursive:true});
  await fs.mkdir(worker,{recursive:true});
  const app = await build({entryPoints:{app:path.join(sourceRoot,'app.mjs')},entryNames:'[name]-[hash]',bundle:true,format:'esm',
    platform:'browser',target:['safari15.4','chrome100','firefox102'],outdir:frontend,minify:true,legalComments:'inline',metafile:true});
  const appFile = Object.keys(app.metafile.outputs).map(file=>path.basename(file)).find(file=>/^app-.*\.js$/.test(file));
  await build({entryPoints:[path.join(sourceRoot,'subscription-guide.mjs')],outfile:path.join(frontend,'subscription-guide.mjs'),bundle:true,
    format:'esm',platform:'browser',target:['safari15.4','chrome100','firefox102'],minify:true,legalComments:'inline'});
  for (const file of ['style.css','calendar-view.css','subscription-guide.css','UNICODE-LICENSE.txt']) await fs.copyFile(path.join(sourceRoot,file),path.join(frontend,file));
  await fs.cp(path.join(sourceRoot,'assets'),path.join(frontend,'assets'),{recursive:true});
  await fs.mkdir(path.join(frontend,'licenses'),{recursive:true});
  await fs.copyFile(path.join(sourceRoot,'vendor/zangli/LICENSE.md'),path.join(frontend,'licenses/zangli-LICENSE.txt'));
  await fs.copyFile(path.join(sourceRoot,'vendor/zangli/README.md'),path.join(frontend,'licenses/zangli-README.md'));
  try { await fs.copyFile(path.join(sourceRoot,'assets/README.md'),path.join(frontend,'licenses/artwork.md')); await fs.rm(path.join(frontend,'assets/README.md')); }
  catch (error) { if(error.code!=='ENOENT') throw error; }
  const html = (await normalizedHTML()).replace('src="./app.mjs"',`src="./${appFile}"`).replace('</head>',`${releaseTag(release)}\n</head>`);
  await fs.writeFile(path.join(frontend,'index.html'),html);
  await fs.writeFile(path.join(frontend,'calendar-data.json'),data);
  await fs.writeFile(path.join(frontend,'config.json'),json({apiBaseUrl:config.apiBaseUrl,...release}));
  for (const directory of [site,frontend]) await fs.writeFile(path.join(directory,'version.json'),json(release));
  await fs.writeFile(path.join(site,'index.html'),'<!doctype html><html lang="zh-Hans"><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=/calendar-reminders/"><title>慧灯藏历</title><a href="/calendar-reminders/">打开藏历</a></html>');
  await fs.writeFile(path.join(site,'_redirects'),'/ /calendar-reminders/ 302\n');
  await fs.writeFile(path.join(site,'_headers'),'/*\n  X-Content-Type-Options: nosniff\n  Referrer-Policy: no-referrer\n  X-Robots-Tag: noindex, nofollow, noarchive\n  Permissions-Policy: geolocation=(), camera=(), microphone=()\n  Cache-Control: no-cache\n/calendar-reminders/app-*.js\n  Cache-Control: public, max-age=31536000, immutable\n/calendar-reminders/assets/*\n  Cache-Control: public, max-age=3600\n');
  await build({entryPoints:[path.join(projectRoot,'service/calendar/worker.mjs')],outfile:path.join(worker,'worker.mjs'),bundle:true,format:'esm',
    platform:'neutral',target:'es2022',minify:true,legalComments:'inline',plugins:[{name:'calendar-release',setup(plugin) {
      plugin.onLoad({filter:/[\\/]service[\\/]calendar[\\/]release\.json$/},()=>({contents:json(release),loader:'json'}));
    }}]});
  await fs.cp(path.join(projectRoot,'service/calendar/migrations'),path.join(worker,'migrations'),{recursive:true});
  await fs.writeFile(path.join(worker,'version.json'),json(release));
  if(config.remote && options.deployment) {
    const {workerName,databaseName,databaseId,allowedOrigins} = options.deployment;
    if(!/^[a-z][a-z0-9-]{2,62}$/.test(workerName||'') || !/^[\w-]+$/.test(databaseName||'') || !/^[a-f0-9-]{36}$/.test(databaseId||'')) throw new Error('Worker 名称或 D1 配置缺失／无效。');
    if(!workerName.endsWith(`-${config.mode}`)) throw new Error('Worker 名称必须明确区分 acceptance 与 trial。');
    const origins = [...new Set([config.siteOrigin,...(allowedOrigins||[])].map(value=>origin(value)))];
    await fs.writeFile(path.join(worker,'wrangler.json'),json({name:workerName,main:'worker.mjs',compatibility_date:'2026-10-01',workers_dev:true,
      vars:{PUBLIC_BASE_URL:config.apiBaseUrl,ALLOWED_ORIGINS:origins.join(',')},
      d1_databases:[{binding:'DB',database_name:databaseName,database_id:databaseId,migrations_dir:'migrations'}],
      triggers:{crons:['17 4 * * *']},observability:{enabled:false}}));
  }
  const files = await filesWithin(site);
  for(const file of files) if(!isPublicFile(file)) throw new Error(`发布目录含未批准文件：${file}`);
  const manifest = {release,apiBaseUrl:config.apiBaseUrl,files:[]};
  for(const file of files) { const bytes=await fs.readFile(path.join(site,file)); manifest.files.push({path:file,bytes:bytes.length,sha256:hash(bytes)}); }
  await fs.writeFile(path.join(config.output,'manifest.json'),json(manifest));
  await buildStandalone({output:path.join(config.output,'藏历日历.html'),release:{...release,environment:'offline'}});
  return {config,release,manifest};
}

export function cliOptions(args=process.argv.slice(2)) {
  const values={};
  for(let i=0;i<args.length;i+=2) {
    if(!['--mode','--output','--api','--site','--version'].includes(args[i]) || !args[i+1]) throw new Error('未知或不完整的构建参数。');
    values[{'--mode':'mode','--output':'output','--api':'apiBaseUrl','--site':'siteOrigin','--version':'version'}[args[i]]]=args[i+1];
  }
  return values;
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const result=await buildRelease(cliOptions());
  console.log(`构建完成：${result.config.mode}；版本 ${result.release.version}；资料 ${result.release.dataVersion.slice(0,12)}；公开文件 ${result.manifest.files.length} 个。`);
}
