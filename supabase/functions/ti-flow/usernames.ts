export function validUsername(value:unknown):value is string {
 return typeof value==='string'&&value.length<=100&&/^[a-z]+\.[a-z]+[0-9]{0,6}$/.test(value);
}
const letters=(value:string)=>value.normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z]/g,'');
export function suggestUsernames(fullName:string,current:string,taken:Iterable<string>,random=()=>crypto.getRandomValues(new Uint32Array(1))[0]%900+100){
 const unavailable=new Set(taken),parts=fullName.trim().split(/\s+/).map(letters).filter(Boolean),base=current.replace(/\d+$/,'');
 const candidates:string[]=[];
 const add=(value:string)=>{if(validUsername(value)&&value!==current&&!unavailable.has(value)&&!candidates.includes(value))candidates.push(value);};
 if(parts.length>2){add(`${parts[0]}.${parts.slice(1).join('')}`);add(`${parts[0]}${parts[1]}.${parts.at(-1)}`);add(`${parts[0]}.${parts[1]}`);}
 if(!validUsername(base))return candidates.slice(0,4);
 for(let i=0;i<30&&candidates.length<4;i++)add(`${base}${random()}`);
 // Deterministic fallback guarantees suggestions even if random choices collide.
 for(let n=1;n<10000&&candidates.length<4;n++)add(`${base}${n}`);
 return candidates.slice(0,4);
}
export type LoginEnvironment={scope?:unknown;company?:unknown};
export function parseLoginEnvironment(input:LoginEnvironment):{scope:'system'|'company'|'legacy';company?:string}|null {
 if(input.scope===undefined&&input.company===undefined)return {scope:'legacy'};
 if(input.scope==='system'&&(input.company===undefined||input.company===''))return {scope:'system'};
 if(input.scope!=='company'||typeof input.company!=='string')return null;
 const company=input.company.trim().toLowerCase();
 return company.length>=2&&company.length<=64&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(company)?{scope:'company',company}:null;
}
export function accessUrl(base:string,_role:string,_companySlug:string){return new URL('/entrar',base).toString();}
