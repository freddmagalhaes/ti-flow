import {describe,it,expect} from 'vitest';
import {normalizeSubtasks,subtaskBlocked,validateSubtasks} from '../src/subtasks';
const a={id:'a',text:'Etapa A',done:false,block_next:true,start_date:'2026-12-01',due_date:'2026-12-05'},b={id:'b',text:'Etapa B',done:false,start_date:'2026-12-05',due_date:'2026-12-09'};
describe('Subtask dependencies and scheduling',()=>{
 it('blocks B despite its scheduled date until A is actually completed',()=>{expect(subtaskBlocked([a,b],1)).toBe(true);expect(()=>validateSubtasks([a,{...b,started:true}],[a,b])).toThrow(/Conclua/);expect(()=>validateSubtasks([a,{...b,done:true}],[a,b])).toThrow(/Conclua/);});
 it('permits independent work with the optional flag off',()=>{expect(()=>validateSubtasks([{...a,block_next:false},{...b,started:true}],[a,b])).not.toThrow();});
 it('requires a previously completed predecessor and prevents reopening it under an active successor',()=>{expect(()=>validateSubtasks([{...a,done:true},{...b,started:true}],[a,b])).toThrow();expect(()=>validateSubtasks([{...a,done:true},{...b,started:true}],[{...a,done:true},b])).not.toThrow();expect(()=>validateSubtasks([a,{...b,started:true}],[{...a,done:true},{...b,started:true}])).toThrow();});
 it('validates dates and remains compatible with an undated legacy checklist',()=>{expect(()=>validateSubtasks([{id:'old',text:'Item antigo',done:true}])).not.toThrow();expect(()=>validateSubtasks([{...a,due_date:'2026-11-30'}])).toThrow();expect(()=>validateSubtasks([{...a,start_date:'2026-02-30'}])).toThrow();});
 it('preserves actual timestamps while editing dates and resets progress deliberately',()=>{const started=normalizeSubtasks([{...a,started:true}],[a],'2026-12-01T10:00:00Z')[0];expect(started.started_at).toBe('2026-12-01T10:00:00Z');expect(normalizeSubtasks([{...started,due_date:'2026-12-06'}],[started],'2026-12-02T10:00:00Z')[0].started_at).toBe(started.started_at);expect(normalizeSubtasks([{...started,started:false}],[started])[0].started_at).toBeNull();});
});
