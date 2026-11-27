import type {ChecklistItem} from './domain';
export const subtaskActive=(item?:ChecklistItem)=>!!(item?.started||item?.done);
export function subtaskBlocked(items:ChecklistItem[],index:number){return index>0&&!!items[index-1].block_next&&!items[index-1].done;}
function validDate(value:string){return /^\d{4}-\d{2}-\d{2}$/.test(value)&&!Number.isNaN(Date.parse(value+'T00:00:00Z'))&&new Date(value+'T00:00:00Z').toISOString().slice(0,10)===value;}
export function validateSubtasks(items:ChecklistItem[],previous:ChecklistItem[]=[]){
 if(items.length>200)throw new Error('O card pode ter até 200 subtarefas.');const ids=new Set<string>();
 items.forEach((item,index)=>{
  if(!item.id||ids.has(item.id)||!item.text.trim()||item.text.trim().length>500)throw new Error('Confira o nome e a identificação das subtarefas.');ids.add(item.id);
  if((item.start_date&&!validDate(item.start_date))||(item.due_date&&!validDate(item.due_date))||(item.start_date&&item.due_date&&item.due_date<item.start_date))throw new Error('O fim previsto da subtarefa deve ser igual ou posterior ao início, com datas válidas.');
  const prior=items[index-1],old=previous.find(p=>p.id===item.id),oldPrior=previous.find(p=>p.id===prior?.id);
  if(subtaskActive(item)&&prior?.block_next&&(subtaskBlocked(items,index)||(!subtaskActive(old)&&!oldPrior?.done)))throw new Error(`Conclua “${prior.text}” antes de iniciar ou concluir “${item.text}”. Para reabrir a anterior, retorne a próxima para A fazer primeiro.`);
 });
}
export function normalizeSubtasks(items:ChecklistItem[],previous:ChecklistItem[],now=new Date().toISOString()):ChecklistItem[]{
 validateSubtasks(items,previous);return items.map(item=>{const old=previous.find(p=>p.id===item.id),active=subtaskActive(item);return {...item,text:item.text.trim(),started:active,block_next:!!item.block_next,start_date:item.start_date??'',due_date:item.due_date??'',started_at:active?(subtaskActive(old)?old?.started_at??null:now):null,completed_at:item.done?(old?.done?old.completed_at??null:now):null};});
}
