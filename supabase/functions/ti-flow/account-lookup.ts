import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.119.0';
import {parseLoginEnvironment,validUsername} from './usernames.ts';
import type {LoginEnvironment} from './usernames.ts';
export async function findLoginProfile(db:SupabaseClient,username:string,input:LoginEnvironment){
 const context=parseLoginEnvironment(input);if(!validUsername(username)||!context)return null;
 let query=db.from('profiles').select('*').eq('username',username);
 if(context.scope==='system')query=query.eq('role','system_admin');
 if(context.scope==='company'){
  const company=await db.from('companies').select('id').eq('slug',context.company!).maybeSingle();
  if(company.error)throw new Error('Account lookup unavailable');if(!company.data)return null;
  query=query.eq('company_id',company.data.id).neq('role','system_admin');
 }
 const {data,error}=await query.limit(2);if(error)throw new Error('Account lookup unavailable');
 return data?.length===1?data[0]:null;
}
