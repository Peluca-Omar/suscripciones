import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from './money-model.mjs';

const monthBefore=value=>{
  const date=new Date(value+'T12:00:00');date.setMonth(date.getMonth()-1);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
};
const monthAfter=value=>{
  const date=new Date(value+'-01T12:00:00');date.setMonth(date.getMonth()+1);
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}`;
};

function previousState() {
  const state=M.initialState(),current=M.monthKey(),today=M.today(),previous=monthBefore(`${current}-01`);
  M.saveMovement(state,{type:'opening',description:'Capital inicial',amount:100000,date:`${previous}-01`});
  M.saveMovement(state,{type:'income',description:'Ingreso del mes',amount:20000,date:today});
  M.saveMovement(state,{type:'variable',description:'Compra previa',amount:5000,date:today,categoryId:state.categories[0].id});
  state.version=1;delete state.accounts;delete state.accountsActivatedAt;delete state.lastAccountId;
  return state;
}

test('la migración conserva intactos los movimientos existentes y añade las cuentas sin activarlas',()=>{
  const old=previousState(),movements=structuredClone(old.movements),legacyBalance=old.movements.reduce((sum,m)=>sum+M.sign(m),0);
  const state=M.readState(old);
  assert.equal(state.version,2);
  assert.equal(M.accountsActive(state),false);
  assert.deepEqual(state.movements,movements);
  assert.equal(M.balance(state),legacyBalance);
  assert.deepEqual(state.accounts.map(account=>account.id),['pichincha','flexi-ahorro','bolivariano','jep','cash']);
  assert.equal(old.version,1);
});

test('el saldo inicial por cuenta no vuelve a descontar el historial y los nuevos gastos sí actualizan el saldo',()=>{
  const state=M.readState(previousState()),oldMovements=structuredClone(state.movements),today=M.today(),current=M.monthKey();
  const oldSummary=M.summary(state,monthBefore(`${current}-01`));
  M.initializeAccounts(state,{pichincha:10000,'flexi-ahorro':0,bolivariano:15000,jep:0,cash:10000},today);
  assert.deepEqual(state.movements,oldMovements);
  assert.equal(M.balance(state),35000);
  assert.equal(M.summary(state,monthBefore(`${current}-01`)).closing,oldSummary.closing);

  M.saveMovement(state,{type:'variable',description:'Almuerzo',amount:2500,date:today,categoryId:state.categories[0].id,accountId:'pichincha'});
  assert.equal(M.accountBalance(state,'pichincha'),7500);
  assert.equal(M.balance(state),32500);
  const summary=M.summary(state,current);
  assert.equal(summary.setupAdjustment,-80000);
  assert.equal(summary.closing,32500);
  assert.equal(summary.closing,summary.previous+summary.setupAdjustment+summary.income-summary.spent);
  assert.equal(M.summary(state,monthAfter(current)).previous,32500);
  const restored=M.readState(JSON.parse(JSON.stringify(state)));
  assert.equal(M.balance(restored),32500);
  assert.equal(M.accountBalance(restored,'pichincha'),7500);
  assert.deepEqual(restored.movements, state.movements);
});

test('Flexi Ahorro se incorpora a cuentas ya activas sin cambiar sus saldos ni sus movimientos',()=>{
  const state=M.readState(previousState()),today=M.today();
  M.initializeAccounts(state,{pichincha:10000,bolivariano:15000,jep:0,cash:10000,'flexi-ahorro':0},today);
  const stored=structuredClone(state),oldMovements=structuredClone(state.movements),oldTotal=M.balance(state);
  stored.accounts=stored.accounts.filter(account=>account.id!=='flexi-ahorro');
  const migrated=M.readState(stored);
  const flexi=migrated.accounts.find(account=>account.id==='flexi-ahorro');
  assert.equal(flexi.needsOpeningBalance,true);
  assert.equal(M.balance(migrated),oldTotal);
  assert.deepEqual(migrated.movements,oldMovements);
  assert.throws(()=>M.validateAccount(migrated,'flexi-ahorro'),/Registra primero el saldo inicial/);

  M.initializeAddedAccounts(migrated,{'flexi-ahorro':12500},today);
  assert.equal(M.accountBalance(migrated,'flexi-ahorro'),12500);
  assert.equal(M.balance(migrated),oldTotal+12500);
  assert.deepEqual(migrated.movements.slice(0,oldMovements.length),oldMovements);
  const summary=M.summary(migrated,M.monthKey());
  assert.equal(summary.accountOpening,12500);
  assert.equal(summary.income,20000);
  assert.equal(summary.spent,5000);
  assert.equal(summary.closing,oldTotal+12500);
});

test('las transferencias cambian los saldos de origen y destino, no el total ni los gastos',()=>{
  const state=M.initialState(),today=M.today(),month=M.monthKey();
  M.initializeAccounts(state,{pichincha:5000,'flexi-ahorro':0,bolivariano:1000,jep:0,cash:2000},today);
  const before=M.summary(state,month);
  M.saveTransfer(state,{fromAccountId:'pichincha',toAccountId:'cash',amount:1500,date:today});
  assert.equal(M.accountBalance(state,'pichincha'),3500);
  assert.equal(M.accountBalance(state,'cash'),3500);
  assert.equal(M.balance(state),8000);
  assert.equal(M.sign(state.movements[0]),0);
  const after=M.summary(state,month);
  assert.equal(after.income,before.income);
  assert.equal(after.spent,before.spent);
  assert.equal(after.closing,before.closing);
});

test('se rechazan transferencias entre la misma cuenta o por encima del saldo disponible',()=>{
  const state=M.initialState(),today=M.today();
  M.initializeAccounts(state,{pichincha:1000,'flexi-ahorro':0,bolivariano:0,jep:0,cash:0},today);
  assert.throws(()=>M.saveTransfer(state,{fromAccountId:'pichincha',toAccountId:'pichincha',amount:100,date:today}),/diferentes/);
  assert.throws(()=>M.saveTransfer(state,{fromAccountId:'pichincha',toAccountId:'cash',amount:1001,date:today}),/no alcanza/);
});

test('un movimiento anterior no se asigna a una cuenta luego de fijar los saldos actuales',()=>{
  const state=M.readState(previousState()),old=state.movements[0];
  M.initializeAccounts(state,{pichincha:10000,'flexi-ahorro':0,bolivariano:0,jep:0,cash:0},M.today());
  assert.throws(()=>M.saveMovement(state,{...old,accountId:'pichincha'},old.id),/no se pueden asignar/);
});
