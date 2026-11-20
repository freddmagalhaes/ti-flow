import {beforeAll,afterAll,beforeEach,afterEach,describe,it,expect} from 'vitest';
import {PGlite} from '@electric-sql/pglite';
import {readFile} from 'node:fs/promises';
import {newsletterContent,validEmail,validToken} from '../supabase/functions/ti-flow/newsletter';
let db:PGlite;
const owner='00000000-0000-4000-8000-000000000001';
async function request(email='subscriber@example.invalid',suffix='a'){
 await db.query('select newsletter_request($1,$2,$3,$4,$5)',[email,'confirmation-'+suffix,'unsubscribe-'+suffix,'encrypted-unsubscribe','encrypted-confirmation']);
}
async function confirm(suffix='a'){return (await db.query<{newsletter_confirm:boolean}>('select newsletter_confirm($1)',['confirmation-'+suffix])).rows[0].newsletter_confirm;}
async function campaign(){return (await db.query<{id:string}>('insert into newsletter_campaigns(subject,content,created_by) values($1,$2,$3) returning id',['Novidades do Flow','Uma nova edição para a equipe.',owner])).rows[0].id;}
async function rejected(sql:string,params:unknown[]=[]){await db.exec('savepoint denied');let error:unknown;try{await db.query(sql,params);}catch(e){error=e;}await db.exec('rollback to savepoint denied;release savepoint denied');expect(error).toBeTruthy();}
beforeAll(async()=>{db=new PGlite();await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;create table public.profiles(id uuid primary key);insert into profiles values('${owner}');`);await db.exec(await readFile(new URL('../supabase/newsletter.sql',import.meta.url),'utf8'));},30000);
beforeEach(async()=>{await db.exec('begin');});
afterEach(async()=>{await db.exec('reset role;rollback');});
afterAll(async()=>{await db?.close();});
describe('Newsletter consent, permissions and queue lifecycle',()=>{
 it('does not create accounts, sends one confirmation and rejects expired/reused tokens',async()=>{
  await request();await request();expect((await db.query('select * from profiles')).rows).toHaveLength(1);expect((await db.query('select * from newsletter_jobs')).rows).toHaveLength(1);
  expect(await confirm()).toBe(true);expect(await confirm()).toBe(false);await request();expect((await db.query('select * from newsletter_jobs')).rows).toHaveLength(1);
  await request('other@example.invalid','b');await db.exec("update newsletter_subscribers set confirmation_expires_at=now()-interval '1 second' where email='other@example.invalid'");expect(await confirm('b')).toBe(false);
 });
 it('isolates subscriber addresses, encrypted tokens, campaigns and RPCs from all browser roles',async()=>{
  await request();for(const role of ['anon','authenticated']){await db.exec(`set role ${role}`);await rejected('select * from newsletter_subscribers');await rejected('select * from newsletter_jobs');await rejected('select * from newsletter_campaigns');await rejected("select newsletter_confirm('confirmation-a')");await rejected('select newsletter_overview()');await rejected("select newsletter_request('x@example.invalid','h','u','e','p')");await db.exec('reset role');}
 });
 it('publishes only to confirmed subscribers and queues a campaign once',async()=>{
  await request();await confirm();await request('pending@example.invalid','b');await request('out@example.invalid','c');await confirm('c');await db.query('select newsletter_unsubscribe($1)',['unsubscribe-c']);
  const id=await campaign();expect((await db.query<{newsletter_publish:number}>('select newsletter_publish($1)',[id])).rows[0].newsletter_publish).toBe(1);await rejected('select newsletter_publish($1)',[id]);
  expect((await db.query("select * from newsletter_jobs where kind='campaign'")).rows).toHaveLength(1);const overview=(await db.query<{newsletter_overview:{counts:Record<string,number>;campaigns:{delivery:Record<string,number>}[]}}>('select newsletter_overview()')).rows[0].newsletter_overview;expect(overview.counts).toEqual({confirmed:1,pending:1,unsubscribed:1});expect(overview.campaigns[0].delivery.scheduled).toBe(1);
 });
 it('requires a confirmed audience before committing publication',async()=>{const id=await campaign();await rejected('select newsletter_publish($1)',[id]);expect((await db.query<{queued_at:null}>('select queued_at from newsletter_campaigns where id=$1',[id])).rows[0].queued_at).toBe(null);});
 it('cancels queued/in-flight deliveries and invalidates confirmation when unsubscribing',async()=>{
  await request();await confirm();const id=await campaign();await db.query('select newsletter_publish($1)',[id]);await db.exec('select * from claim_newsletter_jobs()');await db.query('select newsletter_unsubscribe($1)',['unsubscribe-a']);
  expect((await db.query("select * from newsletter_jobs where state not in ('cancelled','sent')")).rows).toHaveLength(0);expect((await db.query<{state:string}>('select state from newsletter_subscribers')).rows[0].state).toBe('unsubscribed');
  await request('subscriber@example.invalid','new');expect(await confirm()).toBe(false);expect(await confirm('new')).toBe(true);
 });
 it('claims jobs once per lease, ignores stale completions and clears confirmation payload after send',async()=>{
  await request();const job=(await db.query<{id:string;claim_token:string}>('select * from claim_newsletter_jobs()')).rows[0];expect((await db.query('select * from claim_newsletter_jobs()')).rows).toHaveLength(0);
  await db.query('select finish_newsletter_job($1,$2,true)',[job.id,owner]);expect((await db.query<{state:string}>('select state from newsletter_jobs')).rows[0].state).toBe('sending');
  await db.query('select finish_newsletter_job($1,$2,true)',[job.id,job.claim_token]);expect((await db.query<{state:string;encrypted_payload:null}>('select state,encrypted_payload from newsletter_jobs')).rows[0]).toMatchObject({state:'sent',encrypted_payload:null});
 });
 it('retries failed delivery and stops at five attempts before the provider idempotency window',async()=>{
  await request();for(let attempt=1;attempt<=5;attempt++){const job=(await db.query<{id:string;claim_token:string}>('select * from claim_newsletter_jobs()')).rows[0];expect(job).toBeTruthy();await db.query('select finish_newsletter_job($1,$2,false)',[job.id,job.claim_token]);await db.exec("update newsletter_jobs set send_at=now()-interval '1 second'");}
  expect((await db.query<{state:string;encrypted_payload:null}>('select state,encrypted_payload from newsletter_jobs')).rows[0]).toMatchObject({state:'failed',encrypted_payload:null});expect((await db.query('select * from claim_newsletter_jobs()')).rows).toHaveLength(0);
 });
});
describe('Newsletter rendering and input',()=>{
 it('escapes authored HTML and includes cancellation in HTML and plain text',()=>{const c=newsletterContent('<script>title</script>','Hello <img src=x>\n\nOutra linha.','token','https://flow.automacoes.tec.br');expect(c.html).not.toContain('<script>');expect(c.html).not.toContain('<img');expect(c.html).toContain('&lt;img');expect(c.html).toContain('/blog/newsletter?unsubscribe=token');expect(c.text).toContain('Cancelar inscrição: https://flow.automacoes.tec.br/blog/newsletter?unsubscribe=token');});
 it('rejects malformed addresses and short tokens',()=>{expect(validEmail('pessoa@example.invalid')).toBe(true);expect(validEmail('invalid')).toBe(false);expect(validEmail('a@b.c\nBcc:x@y.z')).toBe(false);expect(validToken('a'.repeat(43))).toBe(true);expect(validToken('bad token')).toBe(false);});
});
