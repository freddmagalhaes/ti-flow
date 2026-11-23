export type CompanyRole='system_admin'|'admin'|'manager'|'technician';
export type AccountActor={id:string;role:string;company_id:string};
export const isSystemAdmin=(actor:AccountActor)=>actor.role==='system_admin';
export const canAdminCompany=(actor:AccountActor,companyId:string)=>isSystemAdmin(actor)||(actor.role==='admin'&&actor.company_id===companyId);
export const canAdminAccount=(actor:AccountActor,target:AccountActor)=>canAdminCompany(actor,target.company_id)&&(target.role!=='system_admin'||isSystemAdmin(actor));
export const canAssignRole=(_actor:AccountActor,role:unknown)=>['admin','manager','technician'].includes(String(role));
export const validCompany=(name:string,slug:string)=>name.trim().length>=2&&name.trim().length<=160&&slug.length>=2&&slug.length<=64&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
export function accountUpdateErrorMessage(error:unknown):string|null {
 if(!error||typeof error!=='object')return null;
 const {code,message}=error as {code?:unknown;message?:unknown};
 if(code!=='P0001')return null;
 if(message==='Não é permitido remover o último administrador da empresa.')return 'Este usuário é o único administrador ativo da empresa. Cadastre, ative ou promova outro administrador da empresa antes de desativar este acesso ou alterar seu perfil. Administradores do sistema não substituem o administrador da empresa.';
 if(message==='Não é permitido remover o último administrador do sistema.')return 'Este usuário é o único administrador ativo do sistema. É necessário manter outro administrador do sistema ativo antes de desativar este acesso ou alterar seu perfil.';
 return null;
}
