import type {SupabaseClient} from 'npm:@supabase/supabase-js@2.119.0';
import {avatarJpeg} from './avatar-data.ts';
import {profileChanges} from './profile-data.ts';
export async function saveProfileImage(db:SupabaseClient,target:{id:string;avatar_path?:string;avatar_preset?:string},input:Record<string,unknown>){
 const {avatar_image,...personal}=input,changes=profileChanges(personal);
 const preset=changes.avatar_preset??target.avatar_preset??'initials';let path=target.avatar_path??'',uploaded='';
 if(avatar_image!==undefined){if(preset!=='photo')throw new Error('Selecione a opção de foto para enviar uma imagem.');const bytes=avatarJpeg(avatar_image);uploaded=target.id+'/'+crypto.randomUUID()+'.jpg';const result=await db.storage.from('profile-avatars').upload(uploaded,bytes,{contentType:'image/jpeg',upsert:false});if(result.error)throw new Error('Não foi possível enviar a foto. Tente novamente.');path=uploaded;}
 if(preset==='photo'&&!path)throw new Error('Escolha uma foto antes de salvar.');if(preset!=='photo')path='';
 const saved=await db.from('profiles').update({...changes,avatar_path:path}).eq('id',target.id);
 if(saved.error){if(uploaded)await db.storage.from('profile-avatars').remove([uploaded]);throw new Error('Não foi possível salvar os dados do perfil.');}
 if(target.avatar_path&&target.avatar_path!==path&&target.avatar_path.startsWith(target.id+'/'))await db.storage.from('profile-avatars').remove([target.avatar_path]);
}
