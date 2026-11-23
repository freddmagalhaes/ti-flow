import {describe,it,expect} from 'vitest';
import {activityEmailContent,notificationSettings} from '../supabase/functions/ti-flow/activity-emails';
describe('Activity email content and settings',()=>{
 it('escapes user content and links to the authenticated card without exposing its description',()=>{
  const content=activityEmailContent({company:'Empresa <x>',kind:'assigned',recipient_id:'p',timezone:'America/Sao_Paulo',cards:[{id:'card-id',code:'TI-000001',title:'Teste <script>',priority:'urgent',due_date:'2026-11-30'}]},'https://flow.automacoes.tec.br');
  expect(content.html).toContain('Teste &lt;script&gt;');expect(content.html).not.toContain('Teste <script>');expect(content.text).toContain('atividade=card-id');expect(content.text).toContain('30/11/2026');expect(content.text).toContain('Urgente');
 });
 it('validates company timezone and business hour before persisting',()=>{
  expect(notificationSettings({enabled:true,timezone:'America/Manaus',hour:10})).toMatchObject({activity_emails_enabled:true,notification_hour:10});
  for(const value of [{enabled:'true',timezone:'America/Sao_Paulo',hour:9},{enabled:true,timezone:'invalid',hour:9},{enabled:true,timezone:'America/Sao_Paulo',hour:18}])expect(()=>notificationSettings(value)).toThrow();
 });
});
