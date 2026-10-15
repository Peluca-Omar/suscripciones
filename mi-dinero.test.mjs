import test from 'node:test';
import assert from 'node:assert/strict';
import {MoneyPage} from './mi-dinero.js';
import * as M from './money-model.mjs';

function pageWithAccounts() {
  const page=Object.create(MoneyPage.prototype),state=M.initialState();
  M.initializeAccounts(state,Object.fromEntries(state.accounts.map(account=>[account.id,10000])));
  page.store={ready:true,state};
  page.dialog=(title,content,submit)=>{page.opened={title,content,submit};};
  return page;
}

test('Marcar pagado abre el selector usando el identificador del gasto, no el de una cuenta',()=>{
  const page=pageWithAccounts();
  page.fixedAccountPicker('gasto-netflix-123','pay');
  assert.equal(page.fixedAccountExpenseId,'gasto-netflix-123');
  assert.equal(page.fixedAccountMode,'pay');
  assert.equal(page.opened.title,'¿Desde qué cuenta pagaste?');
  assert.match(page.opened.content,/select-fixed-account/);
  assert.match(page.opened.content,/Flexi Ahorro/);
});

test('Cambiar cuenta habitual abre el selector para el gasto mensual',()=>{
  const page=pageWithAccounts();
  page.fixedAccountPicker('gasto-internet-456','preference');
  assert.equal(page.fixedAccountExpenseId,'gasto-internet-456');
  assert.equal(page.fixedAccountMode,'preference');
  assert.equal(page.opened.title,'Cuenta habitual para este gasto');
});

test('Seleccionar cuenta registra el pago del gasto elegido',async()=>{
  const page=pageWithAccounts(),calls=[];
  page.fixedAccountPicker('gasto-netflix-123','pay');
  page.store.setPaid=async(id,paid,accountId)=>{
    calls.push({id,paid,accountId});
    M.saveMovement(page.store.state,{type:'fixed',description:'Netflix',amount:1200,date:M.today(),period:M.monthKey(),subscriptionId:id,accountId});
  };
  const previousDocument=globalThis.document;
  globalThis.document={querySelector:()=>({close(){}})};
  page.notify=()=>{};
  try {await page.action('select-fixed-account','pichincha');}
  finally {globalThis.document=previousDocument;}
  assert.deepEqual(calls,[{id:'gasto-netflix-123',paid:true,accountId:'pichincha'}]);
  assert.equal(M.payment(page.store.state,'gasto-netflix-123',M.monthKey()).amount,1200);
  assert.equal(M.accountBalance(page.store.state,'pichincha'),8800);
});
