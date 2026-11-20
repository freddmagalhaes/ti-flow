type Input=Record<string,unknown>;
const text=(value:unknown,max:number)=>{if(typeof value!=='string'||value.trim().length>max)throw new Error('Confira os dados informados.');return value.trim();};
export function profileChanges(input:Input){
 if(Object.keys(input).some(key=>!['full_name','phone','job_title','department'].includes(key)))throw new Error('E-mail, login, empresa e permissões são protegidos.');
 const full_name=text(input.full_name,160);if(full_name.length<2)throw new Error('Informe seu nome completo.');
 return {full_name,phone:text(input.phone??'',30),job_title:text(input.job_title??'',100),department:text(input.department??'',100)};
}
export function companyChanges(input:Input){
 if(Object.keys(input).some(key=>!['name','legal_name','tax_id','contact_email','phone','address','website'].includes(key)))throw new Error('Identificador e situação da empresa são protegidos.');
 const name=text(input.name,160),contact_email=text(input.contact_email??'',254),website=text(input.website??'',200);
 if(name.length<2)throw new Error('Informe o nome da empresa.');
 if(contact_email&&!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact_email))throw new Error('Informe um e-mail de contato válido.');
 if(website){let valid=false;try{valid=['http:','https:'].includes(new URL(website).protocol);}catch{}if(!valid)throw new Error('Informe o site completo, com https://.');}
 return {name,legal_name:text(input.legal_name??'',200),tax_id:text(input.tax_id??'',30),contact_email,phone:text(input.phone??'',30),address:text(input.address??'',500),website};
}
