import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.119.0';
import {validEmail} from './newsletter.ts';
import {parseLoginEnvironment,validUsername} from './usernames.ts';
import type {LoginEnvironment} from './usernames.ts';
export async function findLoginProfile(db:SupabaseClient,username:string,input:LoginEnvironment){
 if(validEmail(username)){const result=await db.rpc('profile_id_for_email',{p_email:username.trim().toLowerCase()});if(result.error)throw new Error('Account lookup unavailable');if(!result.data)return null;const profile=await db.from('profiles').select('*').eq('id',result.data).maybeSingle();if(profile.error)throw new Error('Account lookup unavailable');return profile.data;}
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
