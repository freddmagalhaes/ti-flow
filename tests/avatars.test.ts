import {describe,it,expect,vi} from 'vitest';
import {avatarJpeg} from '../supabase/functions/ti-flow/avatar-data';
import {profileChanges} from '../supabase/functions/ti-flow/profile-data';
import {saveProfileImage} from '../supabase/functions/ti-flow/profile-images';
const fields={full_name:'Pessoa Teste',phone:'',job_title:'',department:''};
function jpeg(width=512,height=512){return 'data:image/jpeg;base64,'+btoa(String.fromCharCode(...[255,216,255,192,0,17,8,height>>8,height&255,width>>8,width&255,3,1,17,0,2,17,0,3,17,0,255,217]));}
describe('Profile avatars',()=>{
 it('restricts presets and never accepts a client supplied storage path or email change',()=>{
  expect(profileChanges({...fields,avatar_preset:'sprout'})).toMatchObject({avatar_preset:'sprout'});expect(profileChanges(fields)).not.toHaveProperty('avatar_preset');
  for(const extra of [{avatar_preset:'https://foreign.invalid/picture.svg'},{avatar_path:'foreign/file.jpg'},{email:'other@example.invalid'}])expect(()=>profileChanges({...fields,...extra})).toThrow();
 });
 it('accepts only bounded JPEG data and rejects SVG, malformed data and oversized dimensions',()=>{
  expect(avatarJpeg(jpeg())).toBeInstanceOf(Uint8Array);for(const value of ['data:image/svg+xml;base64,PHN2Zz4=',jpeg(1024),jpeg(10),'data:image/jpeg;base64,@@@@','data:image/jpeg;base64,'+'x'.repeat(410001)])expect(()=>avatarJpeg(value)).toThrow();
 });
 it('uploads to the target user folder and removes an old photo only after the profile update succeeds',async()=>{
  const old='person/old.jpg',upload=vi.fn().mockResolvedValue({error:null}),remove=vi.fn().mockResolvedValue({error:null}),eq=vi.fn().mockResolvedValue({error:null}),update=vi.fn(()=>({eq}));
  const db={storage:{from:()=>({upload,remove})},from:()=>({update})} as unknown as Parameters<typeof saveProfileImage>[0];
  await saveProfileImage(db,{id:'person',avatar_path:old,avatar_preset:'photo'},{...fields,avatar_preset:'photo',avatar_image:jpeg()});
  expect(upload.mock.calls[0][0]).toMatch(/^person\/.+\.jpg$/);expect(update.mock.calls[0][0].avatar_path).toBe(upload.mock.calls[0][0]);expect(remove).toHaveBeenCalledWith([old]);expect(update.mock.calls[0][0]).not.toHaveProperty('avatar_image');
 });
 it('cleans a newly uploaded file after failure without removing the existing photo',async()=>{
  const upload=vi.fn().mockResolvedValue({error:null}),remove=vi.fn().mockResolvedValue({error:null}),db={storage:{from:()=>({upload,remove})},from:()=>({update:()=>({eq:async()=>({error:{message:'failure'}})})})} as unknown as Parameters<typeof saveProfileImage>[0];
  await expect(saveProfileImage(db,{id:'person',avatar_path:'person/old.jpg'},{...fields,avatar_preset:'photo',avatar_image:jpeg()})).rejects.toThrow();expect(remove).toHaveBeenCalledWith([upload.mock.calls[0][0]]);expect(remove).not.toHaveBeenCalledWith(['person/old.jpg']);
 });
});
