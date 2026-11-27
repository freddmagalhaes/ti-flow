export const avatarPresets=['initials','sunny','orbit','sprout','cosmo','pixel','peach','bloom','wave','photo'] as const;
export function avatarJpeg(input:unknown):Uint8Array {
 if(typeof input!=='string'||input.length>410000||!input.startsWith('data:image/jpeg;base64,'))throw new Error('Envie uma foto JPG, PNG ou WebP pelo seletor de imagens.');
 let bytes:Uint8Array;try{bytes=Uint8Array.from(atob(input.slice(23)),c=>c.charCodeAt(0));}catch{throw new Error('A foto não pôde ser lida. Escolha outra imagem.');}
 if(bytes.length>307200||bytes.length<20||bytes[0]!==255||bytes[1]!==216||bytes[bytes.length-2]!==255||bytes[bytes.length-1]!==217)throw new Error('Foto inválida ou muito grande.');
 let pos=2;while(pos+4<bytes.length){
  if(bytes[pos]!==255)break;const marker=bytes[pos+1],length=(bytes[pos+2]<<8)|bytes[pos+3];if(length<2||pos+2+length>bytes.length)break;
  if([192,193,194].includes(marker)){
   if(length<8)break;const height=(bytes[pos+5]<<8)|bytes[pos+6],width=(bytes[pos+7]<<8)|bytes[pos+8];
   if(width<32||height<32||width>512||height>512)throw new Error('A foto deve ser ajustada pelo seletor antes de salvar.');return bytes;
  }
  if(marker===218)break;pos+=length+2;
 }throw new Error('O arquivo não contém uma foto JPEG válida.');
}
