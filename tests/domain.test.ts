import {describe,it,expect} from 'vitest';
import {canEdit,canReopen,dashboardCounts,dayInZone,makeDemo,normalizeUsername,validateCard,validateFile,validatePassword} from '../src/domain';
import {temporaryPassword,encryptPayload,decryptPayload,escapeHtml} from '../supabase/functions/ti-flow/policy';
describe('password policy',()=>{
 it.each(['Abc12345','Ab12Cd34Ef56','abcde123'])('accepts %s',p=>expect(validatePassword(p)).toBe(true));
 it.each(['Ab12345','Ab12Cd34Ef567','abcdefgh','12345678','Abc1234!','Abc 1234','Ábc12345',''])('rejects invalid password %s',p=>expect(validatePassword(p)).toBe(false));
 it('generates unpredictable twelve-character passwords with letters and digits',()=>{const passwords=new Set(Array.from({length:500},temporaryPassword));expect(passwords.size).toBe(500);for(const p of passwords){expect(p).toHaveLength(12);expect(validatePassword(p)).toBe(true);}});
 it('encrypts queued passwords and detects tampering',async()=>{const key=btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))));const cipher=await encryptPayload({password:'Ab12Cd34Ef56'},key);expect(cipher).not.toContain('Ab12Cd34Ef56');expect(await decryptPayload(cipher,key)).toEqual({password:'Ab12Cd34Ef56'});await expect(decryptPayload(cipher.slice(0,-4)+'AAAA',key)).rejects.toThrow();});
});
describe('activity rules',()=>{
 const d=makeDemo(),admin=d.profiles[0],tech=d.profiles[2],owned=d.cards.find(c=>c.assignee_id===tech.id&&c.status!=='completed')!,closed=d.cards.find(c=>c.status==='completed')!;
 it('restricts technicians to assigned cards and freezes closed cards',()=>{expect(canEdit(tech,owned)).toBe(true);expect(canEdit(tech,d.cards[0])).toBe(false);expect(canEdit(admin,closed)).toBe(false);expect(canEdit({...admin,must_change_password:true},owned)).toBe(false);});
 it('allows only one active continuation per chain',()=>{expect(canReopen(admin,closed,d.cards)).toBe(true);expect(canReopen(admin,closed,[...d.cards,{...owned,root_id:closed.root_id}])).toBe(false);});
 it('validates dates and attachments',()=>{expect(()=>validateCard({...owned,due_date:'2000-01-01'})).toThrow();expect(()=>validateFile({name:'script.html',size:20})).toThrow();expect(()=>validateFile({name:'manual.pdf',size:11*1024*1024})).toThrow();expect(()=>validateFile({name:'manual.pdf',size:10*1024*1024})).not.toThrow();});
 it('computes dashboard totals and normalizes names',()=>{expect(dashboardCounts(d.cards)).toMatchObject({active:9,third:3,completed:3});expect(normalizeUsername('Fréderico','Magalhães')).toBe('frederico.magalhaes');});
 it('escapes names in email HTML',()=>expect(escapeHtml('<img src=x>')).toBe('&lt;img src=x&gt;'));
 it('uses São Paulo calendar dates at UTC midnight boundaries',()=>{expect(dayInZone('2026-11-19T02:30:00Z')).toBe('2026-11-18');expect(dayInZone('2026-11-19T03:30:00Z')).toBe('2026-11-19');expect(dayInZone(null)).toBe('');});
});
