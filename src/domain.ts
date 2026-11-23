export type Role = 'system_admin' | 'admin' | 'manager' | 'technician';
export type Status = 'pending' | 'in_progress' | 'third_party' | 'testing' | 'completed';
export type Priority = 'low' | 'medium' | 'high' | 'urgent';
export type View = 'board' | 'dashboard' | 'archive' | 'team' | 'companies' | 'newsletter' | 'contacts' | 'billing' | 'settings';
export interface Company {legal_name?:string;tax_id?:string;contact_email?:string;phone?:string;address?:string;website?:string;id:string;name:string;slug:string;active:boolean;created_at:string}
export interface CompanyInput {name:string;slug:string;administrator:{full_name:string;username:string;email:string}}
export interface Profile {phone?:string;job_title?:string;department?:string; id:string;company_id:string; full_name:string; username:string; role:Role; active:boolean; must_change_password:boolean; email?:string; welcome_status?:string; password_status?:string; }
export interface ChecklistItem {id:string; text:string; done:boolean}
export interface Comment {id:string; text:string; author:string; author_id:string; created_at:string}
export interface Attachment {id:string; name:string; size:number; type:string; path:string; created_at:string}
export interface Card {deleted_at?:string|null;deleted_by?:string|null;id:string;company_id:string; number:number; code:string; root_id:string; parent_id:string|null; title:string; description:string; status:Status; priority:Priority; assignee_id:string; created_by:string; start_date:string; due_date:string; created_at:string; updated_at:string; closed_at:string|null; closed_by:string|null; version:number; position:number; checklist:ChecklistItem[]; comments:Comment[]; attachments:Attachment[]; reopen_reason:string|null;}
export interface AuditEvent {id:string;company_id:string; activity_id:string; actor_id:string; actor_name:string; action:string; created_at:string; details?:string;}
export interface DataSet {companies:Company[];cards:Card[]; profiles:Profile[]; events:AuditEvent[]}
export type CardInput = Pick<Card,'title'|'description'|'status'|'priority'|'assignee_id'|'start_date'|'due_date'>;
export type CardPatch = Partial<CardInput & Pick<Card,'position'|'checklist'|'comments'|'attachments'>>;
export const statuses:{id:Exclude<Status,'completed'>;label:string;hint:string;color:string}[] = [
  {id:'pending',label:'A FAZER',hint:'Prontas para começar',color:'slate'},
  {id:'in_progress',label:'EM DESENVOLVIMENTO',hint:'Foco no que está acontecendo',color:'blue'},
  {id:'third_party',label:'AGUARDANDO',hint:'Aguardando um retorno',color:'amber'},
  {id:'testing',label:'EM TESTE',hint:'Validando a entrega',color:'purple'},
];
export const statusLabel:Record<Status,string> = {pending:'A FAZER',in_progress:'EM DESENVOLVIMENTO',third_party:'AGUARDANDO',testing:'EM TESTE',completed:'Concluído'};
export const priorityLabel:Record<Priority,string> = {low:'Baixa',medium:'Média',high:'Alta',urgent:'Urgente'};
export const roleLabel:Record<Role,string> = {system_admin:'Administrador do sistema',admin:'Administrador da empresa',manager:'Gestor',technician:'Técnico'};
export const priorities:Priority[] = ['urgent','high','medium','low'];
export function today() {return new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
export function dayInZone(instant:string|null) {return instant?new Intl.DateTimeFormat('en-CA',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(instant)):'';}
export function dateOffset(days:number,base=today()) {const d=new Date(base+'T12:00:00Z');d.setUTCDate(d.getUTCDate()+days);return d.toISOString().slice(0,10);}
export function shortDate(date:string) {return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'short',timeZone:'UTC'}).format(new Date(date+'T12:00:00Z')).replace('.','');}
export function dateTime(value:string) {return new Intl.DateTimeFormat('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit',timeZone:'America/Sao_Paulo'}).format(new Date(value));}
export function initials(name:string) {const words=name.trim().split(/\s+/);return (words[0]?.[0]??'')+(words.length>1?words[words.length-1][0]:'');}
export function overdue(c:Card) {return c.status!=='completed' && c.due_date<today();}
export function canEdit(user:Profile,c:Card) {return user.active&&!user.must_change_password&&(user.role==='system_admin'||user.company_id===c.company_id)&&!c.deleted_at&&c.status!=='completed'&&(user.role!=='technician'||c.assignee_id===user.id);}
export function canReopen(user:Profile,c:Card,cards:Card[]) {return user.active&&!user.must_change_password&&(user.role==='system_admin'||user.company_id===c.company_id)&&!c.deleted_at&&c.status==='completed'&&(user.role!=='technician'||c.assignee_id===user.id)&&!cards.some(x=>x.root_id===c.root_id&&x.status!=='completed'&&!x.deleted_at);}
export {validPassword as validatePassword} from '../supabase/functions/ti-flow/policy';
export function normalizeUsername(first:string,last:string) {return `${first}.${last}`.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\s/g,'');}
export function validateCard(input:CardInput) {if(!input.title.trim())throw new Error('Informe o título da atividade.');if(input.title.trim().length>180)throw new Error('O título deve ter até 180 caracteres.');if(!input.assignee_id)throw new Error('Selecione um responsável.');if(!input.start_date||!input.due_date||input.due_date<input.start_date)throw new Error('O término previsto deve ser igual ou posterior ao início.');if(input.status==='completed')throw new Error('Use a ação Concluir para finalizar a atividade.');}
export const MAX_FILE_SIZE=10*1024*1024;
export const fileExtensions=['pdf','png','jpg','jpeg','webp','gif','txt','csv','doc','docx','xls','xlsx','ppt','pptx'];
export function validateFile(file:{name:string;size:number}) {if(file.size>MAX_FILE_SIZE)throw new Error('O arquivo deve ter até 10 MB.');if(!fileExtensions.includes(file.name.split('.').pop()?.toLowerCase()??''))throw new Error('Formato não permitido. Use PDF, imagem, texto ou documento Office.');}
export function formatSize(size:number) {return size>=1024*1024?`${(size/1024/1024).toFixed(1)} MB`:`${Math.max(1,Math.round(size/1024))} KB`;}
export function dashboardCounts(cards:Card[]) {const active=cards.filter(c=>c.status!=='completed');return {active:active.length,late:active.filter(overdue).length,third:active.filter(c=>c.status==='third_party').length,completed:cards.filter(c=>c.status==='completed').length};}
export function makeDemo():DataSet {
 const companies:Company[]=[{id:'demo-company',name:'Automações TI',slug:'automacoes-ti',active:true,created_at:new Date().toISOString()}];
 const profiles:Profile[]=[
  {company_id:'demo-company',id:'demo-admin',full_name:'Alex Oliveira',username:'alex.oliveira',role:'system_admin',active:true,must_change_password:false,email:'alex@example.com'},
  {company_id:'demo-company',id:'demo-marina',full_name:'Marina Costa',username:'marina.costa',role:'manager',active:true,must_change_password:false,email:'marina@example.com'},
  {company_id:'demo-company',id:'demo-rafael',full_name:'Rafael Lima',username:'rafael.lima',role:'technician',active:true,must_change_password:false,email:'rafael@example.com'},
  {company_id:'demo-company',id:'demo-ana',full_name:'Ana Martins',username:'ana.martins',role:'technician',active:true,must_change_password:false,email:'ana@example.com'},
 ];
 const examples:[string,Status,Priority,string,number,string,number][]=[
 ['Revisar permissões de acesso ao ERP','pending','high','demo-marina',2,'Validar os grupos de acesso com os líderes de cada área e revisar os perfis no ERP.',3],
 ['Preparar notebooks para novos colaboradores','pending','medium','demo-rafael',4,'Configurar os equipamentos, instalar aplicativos e aplicar as políticas de segurança.',4],
 ['Documentar rotina de backup','pending','low','demo-ana',6,'Atualizar o procedimento de backup e recuperação no repositório de documentação.',3],
 ['Atualizar os switches do escritório','in_progress','urgent','demo-rafael',-1,'Aplicar o firmware homologado e validar a conectividade após a janela de manutenção.',4],
 ['Configurar autenticação multifator','in_progress','high','demo-marina',1,'Habilitar MFA para os usuários administrativos e revisar os meios de recuperação.',3],
 ['Reorganizar inventário de ativos','in_progress','medium','demo-ana',3,'Conciliar os equipamentos em uso com o inventário e identificar itens sem responsável.',5],
 ['Acompanhar chamado do link de internet','third_party','high','demo-rafael',0,'Aguardando diagnóstico da operadora sobre a instabilidade do link principal.',3],
 ['Renovar licenças do antivírus','third_party','medium','demo-marina',5,'Aguardando a proposta comercial para a renovação das licenças.',2],
 ['Substituir bateria do nobreak','third_party','low','demo-ana',7,'Aguardando entrega da bateria para realizar a substituição programada.',3],
 ['Restabelecer acesso à VPN','completed','high','demo-rafael',-3,'Acesso validado com o usuário após atualização do cliente VPN.',3],
 ['Instalar impressora do financeiro','completed','medium','demo-ana',-2,'Impressora configurada e testada em todas as estações do setor.',2],
 ['Revisar contas de serviço','completed','high','demo-marina',-1,'Contas revisadas, permissões ajustadas e responsáveis registrados.',4],
 ];
 const cards=examples.map(([title,status,priority,assignee,due,description,n],i):Card=>{
  const id=`demo-card-${i+1}`,done=status==='completed';
  return {id,company_id:companies[0].id,number:1042+i,code:`TI-${String(1042+i).padStart(6,'0')}`,root_id:id,parent_id:null,title,description,status,priority,assignee_id:assignee,created_by:'demo-admin',start_date:dateOffset(-5),due_date:dateOffset(due),created_at:new Date(dateOffset(-6)+'T13:30:00Z').toISOString(),updated_at:new Date().toISOString(),closed_at:done?new Date(dateOffset(due)+'T16:00:00Z').toISOString():null,closed_by:done?assignee:null,version:1,position:i,checklist:Array.from({length:n},(_,j)=>({id:crypto.randomUUID(),text:['Verificar o cenário e os requisitos','Executar os ajustes necessários','Validar o resultado com a equipe','Atualizar a documentação','Comunicar os envolvidos'][j],done:done||status==='in_progress'&&j<2})),comments:i===3?[{id:crypto.randomUUID(),author:'Rafael Lima',author_id:assignee,text:'Firmware homologado. Vou concluir a validação da rede na próxima janela.',created_at:new Date().toISOString()}]:[],attachments:[],reopen_reason:null};
 });
 return {companies,profiles,cards,events:cards.map(c=>({company_id:c.company_id,id:crypto.randomUUID(),activity_id:c.id,actor_id:'demo-admin',actor_name:'Alex Oliveira',action:'Atividade criada',created_at:c.created_at}))};
}

export function editableCardInput(c:CardInput):CardInput {return {title:c.title,description:c.description,status:c.status,priority:c.priority,assignee_id:c.assignee_id,start_date:c.start_date,due_date:c.due_date};}
export function editableCardPatch(patch:CardPatch):CardPatch {const allowed=['title','description','status','priority','assignee_id','start_date','due_date','position','checklist','comments','attachments'];return Object.fromEntries(Object.entries(patch).filter(([key])=>allowed.includes(key))) as CardPatch;}
