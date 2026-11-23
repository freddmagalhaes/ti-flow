import {describe,it,expect} from 'vitest';
import {accountUpdateErrorMessage} from '../supabase/functions/ti-flow/permissions';
describe('Account administration feedback',()=>{
 it('explains that the last company administrator requires a company successor',()=>{
  const message=accountUpdateErrorMessage({code:'P0001',message:'Não é permitido remover o último administrador da empresa.'});
  expect(message).toContain('Cadastre, ative ou promova outro administrador da empresa');
  expect(message).toContain('Administradores do sistema não substituem');
 });
 it('distinguishes the last system administrator',()=>{
  expect(accountUpdateErrorMessage({code:'P0001',message:'Não é permitido remover o último administrador do sistema.'})).toContain('outro administrador do sistema ativo');
 });
 it('does not expose unexpected database errors or details',()=>{
  for(const error of [null,'private detail',{code:'23505',message:'sensitive constraint detail'},{code:'P0001',message:'unexpected private detail'}])expect(accountUpdateErrorMessage(error)).toBeNull();
 });
});
