import {readFile} from 'node:fs/promises';
function hiddenLine(){return new Promise((resolve,reject)=>{let value='';if(process.stdin.isTTY)process.stdin.setRawMode(true);process.stdin.setEncoding('utf8');process.stdin.resume();const read=chunk=>{for(const char of chunk){if(char==='\u0003'){finish();reject(new Error('Activation cancelled.'));return;}if(char==='\n'||char==='\r'){finish();resolve(value);return;}if(char==='\u007f'||char==='\b')value=value.slice(0,-1);else value+=char;}};function finish(){process.stdin.off('data',read);if(process.stdin.isTTY)process.stdin.setRawMode(false);process.stdin.pause();}process.stdin.on('data',read);});}
console.log('Ready for administrator activation JSON on stdin (input is hidden).');
try{
 const input=JSON.parse(await hiddenLine());
 const env=Object.fromEntries((await readFile(new URL('../.env.local',import.meta.url),'utf8')).trim().split(/\r?\n/).map(line=>{const i=line.indexOf('=');return[line.slice(0,i),line.slice(i+1)];}));
 const endpoint=env.VITE_SUPABASE_URL+'/functions/v1/ti-flow/';
 const headers={'Content-Type':'application/json',apikey:env.VITE_SUPABASE_PUBLISHABLE_KEY};
 const health=await fetch(endpoint+'health',{method:'POST',headers,body:'{}',signal:AbortSignal.timeout(20000)}).then(r=>r.json());
 if(!health.smtp_ready)throw new Error('Email delivery is not ready. No administrator was created.');
 const result=await fetch(endpoint+'admin/bootstrap',{method:'POST',headers:{...headers,'X-Bootstrap-Secret':input.secret},body:JSON.stringify(input.profile),signal:AbortSignal.timeout(25000)});
 const body=await result.json();
 if(!result.ok)throw new Error(body.error??'Activation failed.');
 console.log(JSON.stringify({ok:true,id:body.id,username:input.profile.username,emails:'queued'}));
}catch(error){console.error(error instanceof Error?error.message:'Activation failed.');process.exitCode=1;}
