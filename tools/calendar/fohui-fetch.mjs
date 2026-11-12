// Low-frequency, fixed-origin source collection. No browser, script execution,
// credentials, redirects or anti-bot workarounds. robots is always recorded;
// an explicit project-owner decision can permit public reads despite its rules.
import {createHash} from 'node:crypto';
import {setTimeout as sleepDefault} from 'node:timers/promises';
import {monthURL, parseMonthPage, assertCompleteMonth} from './fohui-source.mjs';

export const SOURCE_ORIGIN='https://www.fohuifayu.com';
export const PRODUCT='HuidengCalendarSourceCheck';
const AGENT=`${PRODUCT}/1.0 (+https://github.com/liuxiangdahai/huideng-calendar-trial)`;
export const digest=value=>createHash('sha256').update(value).digest('hex');
export class SourceFailure extends Error {
  constructor(code,message,details={}){super(message);this.code=code;this.details=details;}
}

// RFC 9309 grouping, longest matching path and Allow tie-break. Unknown or
// malformed access rules fail closed. Crawl-delay is an additional courtesy.
export function robotsPolicy(body,product=PRODUCT){
  if(typeof body!=='string'||body.length>512*1024||/<(?:html|!doctype)/i.test(body))throw new SourceFailure('invalid-robots','站点规则不是有效文本。');
  const groups=[];let group=null,startedRules=false;
  for(const raw of body.replace(/^\uFEFF/,'').split(/\r?\n/)){
    const line=raw.split('#',1)[0].trim();if(!line)continue;
    const split=line.indexOf(':');if(split<0)throw new SourceFailure('invalid-robots','无法识别站点访问规则。');
    const key=line.slice(0,split).trim().toLowerCase(),value=line.slice(split+1).trim();
    if(key==='user-agent'){
      if(!/^(?:\*|[a-z_-]+)$/i.test(value))throw new SourceFailure('invalid-robots','无法识别访问规则的程序标识。');
      if(!group||startedRules){group={agents:[],rules:[],delay:0};groups.push(group);startedRules=false;}
      group.agents.push(value.toLowerCase());
    }else if(['allow','disallow','crawl-delay'].includes(key)){
      startedRules=true;if(!group)throw new SourceFailure('invalid-robots','访问规则缺少程序标识。');
      if(key==='crawl-delay'){
        const seconds=Number(value);if(!Number.isFinite(seconds)||seconds<0||seconds>60)throw new SourceFailure('unsupported-delay','站点要求的访问间隔需另行配置。');
        group.delay=Math.max(group.delay,seconds*1000);
      }else if(value){
        if(!value.startsWith('/')||/[^\x20-\x7e]/.test(value)||/%(?![a-f\d]{2})/i.test(value))throw new SourceFailure('unsupported-robots-rule','站点路径规则需人工检查。');
        group.rules.push({allow:key==='allow',path:value});
      }
    }
  }
  const explicit=groups.filter(g=>g.agents.includes(product.toLowerCase()));
  const selected=explicit.length?explicit:groups.filter(g=>g.agents.includes('*'));
  const rules=selected.flatMap(g=>g.rules);
  return {
    delayMs:Math.max(5000,...selected.map(g=>g.delay)),
    allowed(url){
      const parsed=new URL(url);if(parsed.origin!==SOURCE_ORIGIN)return false;
      const path=parsed.pathname+parsed.search;
      let best=null;
      for(const rule of rules){
        const terminal=rule.path.endsWith('$'),pattern=terminal?rule.path.slice(0,-1):rule.path;
        const escaped=pattern.split('*').map(s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')).join('.*');
        if(!new RegExp('^'+escaped+(terminal?'$':'')).test(path))continue;
        const length=pattern.replaceAll('*','').length;
        if(!best||length>best.length||(length===best.length&&rule.allow))best={length,allow:rule.allow};
      }
      return best?.allow??true;
    }
  };
}

function validateURL(url){
  const parsed=new URL(url);
  if(parsed.origin!==SOURCE_ORIGIN||parsed.username||parsed.password||parsed.hash||
    !(/^\/robots\.txt$/.test(parsed.pathname)||/^\/index\.php\/calendar\/monthcalendar\/\d{4}\/\d{1,2}\/-$/.test(parsed.pathname))||parsed.search){
    throw new SourceFailure('unapproved-url','只允许已配置的佛慧法语来源路径。');
  }
  return parsed;
}

async function readBounded(response,limit){
  if(Number(response.headers.get('content-length'))>limit){await response.body?.cancel();throw new SourceFailure('source-too-large','来源页面超过体积上限。');}
  const chunks=[];let bytes=0;
  if(!response.body)return '';
  const reader=response.body.getReader();
  try{
    while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;
      if(bytes>limit){await reader.cancel();throw new SourceFailure('source-too-large','来源页面超过体积上限。');}chunks.push(value);}
    return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks));
  }finally{reader.releaseLock();}
}

export function createSourceClient({fetchImpl=fetch,sleep=sleepDefault,now=Date.now,cache={},timeoutMs=15000,publicReadAuthorized=false}={}){
  let policy=null,policyObservation=null,nextAllowedAt=0;const requests=[];
  async function get(url,{robots=false}={}){
    validateURL(url);
    if(!robots&&(!policy||(!policy.allowed(url)&&!publicReadAuthorized)))throw new SourceFailure('source-policy-blocked','站点规则禁止自动读取，且未配置项目负责人的公开读取决定。',{robotsURL:SOURCE_ORIGIN+'/robots.txt',path:new URL(url).pathname});
    for(let attempt=0;attempt<3;attempt++){
      await sleep(Math.max(0,nextAllowedAt-now()));nextAllowedAt=now()+(policy?.delayMs??5000);
      const saved=!robots&&cache[url];
      const headers={'User-Agent':AGENT,Accept:robots?'text/plain':'text/html'};
      if(saved?.html&&digest(saved.html)===saved.sha256){
        if(saved.etag)headers['If-None-Match']=saved.etag;
        if(saved.lastModified)headers['If-Modified-Since']=saved.lastModified;
      }
      let response;
      try{response=await fetchImpl(url,{headers,redirect:'manual',signal:AbortSignal.timeout(timeoutMs)});}
      catch{
        requests.push({url,attempt:attempt+1,status:'network-error'});
        if(attempt<2){await sleep(1000*(attempt+1));continue;}
        throw new SourceFailure('source-unreachable','来源连接超时或失败，保留上一份有效资料。');
      }
      requests.push({url,attempt:attempt+1,status:response.status});
      if(response.status===304){
        await response.body?.cancel();
        if(!saved?.html||digest(saved.html)!==saved.sha256)throw new SourceFailure('invalid-cache','来源缓存校验失败。');
        return {html:saved.html,etag:saved.etag,lastModified:saved.lastModified,cached:true};
      }
      if([408,429,500,502,503,504].includes(response.status)){
        const retry=response.headers.get('retry-after');await response.body?.cancel();
        if(attempt<2){
          const seconds=retry&&/^\d+$/.test(retry)?Number(retry):retry?Math.max(0,(Date.parse(retry)-now())/1000):0;
          if(!Number.isFinite(seconds))throw new SourceFailure('source-busy','来源返回无法识别的等待时间，本次不更新。');
          if(seconds>60)throw new SourceFailure('source-busy','来源要求较长等待，本次不更新。');
          await sleep(Math.max(1000*(attempt+1),seconds*1000));continue;
        }
      }
      if(response.status!==200){await response.body?.cancel();throw new SourceFailure('source-http-error',`来源返回HTTP ${response.status}，不改写已确认资料。`);}
      const type=response.headers.get('content-type')?.split(';',1)[0].trim().toLowerCase();
      if(![robots?'text/plain':'text/html'].includes(type)){await response.body?.cancel();throw new SourceFailure('unexpected-content-type','来源响应类型改变，需检查。');}
      try{return {html:await readBounded(response,robots?512*1024:2*1024*1024),etag:response.headers.get('etag'),lastModified:response.headers.get('last-modified'),cached:false};}
      catch(error){if(error instanceof SourceFailure)throw error;throw new SourceFailure('source-read-failed','来源内容读取失败或编码改变。');}
    }
  }
  return {
    requests,cache,
    get policyObservation(){return policyObservation;},
    async checkPolicy(year,month){
      const robots=await get(SOURCE_ORIGIN+'/robots.txt',{robots:true});policy=robotsPolicy(robots.html);
      const url=monthURL(year,month),allowed=policy.allowed(url);
      policyObservation={allowed,publicReadAuthorized,checkedAt:new Date(now()).toISOString(),url:SOURCE_ORIGIN+'/robots.txt',sha256:digest(robots.html),delayMs:policy.delayMs,path:new URL(url).pathname,body:robots.html};
      return policyObservation;
    },
    async month(year,month,{allowTrailing=false,allowUnpublished=false}={}){
      const url=monthURL(year,month),response=await get(url);
      // A login/challenge/fallback page is never a publication with zero events.
      const canonical=response.html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']+)["']/i)?.[1];
      if(canonical!==url||!response.html.includes('id="jevents_body"')||!response.html.includes('class="cal_table"')){
        throw new SourceFailure('source-layout-changed','来源月份或页面结构改变，未更新资料。',{month:`${year}-${month}`});
      }
      const parsed=parseMonthPage(response.html,year,month);
      if(!parsed.days.length){
        if(!allowUnpublished)throw new SourceFailure('missing-published-month','原本已确认的月份没有日期，不能当作撤回。');
        // Require the calendar grid itself; a positive no-data observation is
        // still reported as pending publication, never as no future activities.
        if(!/class=["']cal_days(?:noevents|outofmonth)/.test(response.html))throw new SourceFailure('source-layout-changed','空月份缺少可识别的日期格。');
        return {...parsed,unpublished:true};
      }
      assertCompleteMonth(parsed.days,year,month,{allowTrailing});
      cache[url]={...response,sha256:parsed.snapshot.sha256};
      return {...parsed,cached:response.cached};
    }
  };
}
