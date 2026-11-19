import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
const env=Object.fromEntries((await readFile(new URL('../.env.local',import.meta.url),'utf8')).trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
const url=env.VITE_SUPABASE_URL,key=env.VITE_SUPABASE_PUBLISHABLE_KEY;
const origin='https://ti-flow-automacoes.meshedkayak2.chatgpt.site';
async function post(action,body={},extra={}){const r=await fetch(`${url}/functions/v1/ti-flow/${action}`,{method:'POST',headers:{'Content-Type':'application/json',apikey:key,Origin:origin,...extra},body:JSON.stringify(body),signal:AbortSignal.timeout(20000)});return {status:r.status,body:await r.json(),cors:r.headers.get('Access-Control-Allow-Origin')};}
const health=await post('health');assert.equal(health.status,200);assert.equal(health.body.connected,true);assert.equal(health.cors,origin);
const protectedAdmin=await post('admin/create-user');assert.equal(protectedAdmin.status,401);
const worker=await post('worker/send-emails');assert.equal(worker.status,401);
const invalidLogin=await post('auth/login',{username:'invalid.nonexistent',password:'Invalid123'});assert.equal(invalidLogin.status,401);
const foreignOrigin=await post('health',{}, {Origin:'https://untrusted.example.com'});assert.equal(foreignOrigin.status,403);
const rows=await fetch(`${url}/rest/v1/activities?select=id`,{headers:{apikey:key},signal:AbortSignal.timeout(20000)});assert.ok([401,403].includes(rows.status),'Anonymous activity access must be denied.');
const config=await fetch(`${url}/rest/v1/rpc/ti_flow_runtime_config`,{method:'POST',headers:{apikey:key,'Content-Type':'application/json'},body:'{}',signal:AbortSignal.timeout(20000)});assert.ok([401,403,404].includes(config.status),'Internal configuration must never be exposed to a browser role.');
console.log(JSON.stringify({health:health.body,adminUnauthorized:protectedAdmin.status,workerUnauthorized:worker.status,invalidLogin:invalidLogin.status,foreignOrigin:foreignOrigin.status,anonymousData:rows.status,privateConfig:config.status}));
