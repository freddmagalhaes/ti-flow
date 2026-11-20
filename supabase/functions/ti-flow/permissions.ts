export type CompanyRole='system_admin'|'admin'|'manager'|'technician';
export type AccountActor={id:string;role:string;company_id:string};
export const isSystemAdmin=(actor:AccountActor)=>actor.role==='system_admin';
export const canAdminCompany=(actor:AccountActor,companyId:string)=>isSystemAdmin(actor)||(actor.role==='admin'&&actor.company_id===companyId);
export const canAdminAccount=(actor:AccountActor,target:AccountActor)=>canAdminCompany(actor,target.company_id)&&(target.role!=='system_admin'||isSystemAdmin(actor));
export const canAssignRole=(_actor:AccountActor,role:unknown)=>['admin','manager','technician'].includes(String(role));
export const validCompany=(name:string,slug:string)=>name.trim().length>=2&&name.trim().length<=160&&slug.length>=2&&slug.length<=64&&/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug);
