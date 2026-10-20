import test from 'node:test';
import assert from 'node:assert/strict';
import * as M from './money-model.mjs';
import * as D from './debt-model.mjs';
import {DebtPage} from './mis-deudas.js';

function setup() {
  const money=M.initialState();
  M.initializeAccounts(money,Object.fromEntries(money.accounts.map(a=>[a.id,1000000])),'2026-10-01');
  return {money,state:D.initialDebts()};
}
const payment=(extra={})=>({amount:14052,interest:0,date:'2026-10-20',accountId:'pichincha',period:'2026-11',...extra});

test('las cuatro deudas contienen los importes y fechas confirmados, sin tocar Mi Dinero',()=>{
  const money=M.initialState(),before=structuredClone(money),state=D.initialDebts();
  assert.equal(state.debts.reduce((sum,d)=>sum+d.openingAmount,0),478884);
  assert.equal(state.debts[0].firstDue,'2026-11-06');
  assert.equal(state.debts[1].firstDue,'2026-11-04');
  assert.equal(state.debts[1].installment,5831);
  assert.equal(state.debts[1].deferPending,true);
  assert.equal(state.debts[1].cutUnconfirmed,true);
  assert.equal(state.debts[2].kind,'flexible');
  assert.deepEqual(money,before);
  assert.deepEqual(D.readDebts(state),state);
  assert.equal(D.readDebts(undefined),null);
});
test('calendarios exactos: Pichincha 17 cuotas y BIESS ocho fines de mes',()=>{
  const {money,state}=setup();
  const p=D.schedule(money,state.debts[0]),b=D.schedule(money,state.debts[3]);
  assert.equal(p.length,17);assert.equal(p.at(-1).date,'2028-03-06');
  assert.deepEqual(b.map(row=>row.date),['2026-10-31','2026-11-30','2026-12-31','2027-01-31','2027-02-28','2027-03-31','2027-04-30','2027-05-31']);
  assert.equal(D.schedule(money,state.debts[2]).length,0);
});
test('registrar pago descuenta una sola vez, conserva el historial y permite deshacer',()=>{
  const {money,state}=setup(),debt=state.debts[0];
  M.saveMovement(money,{type:'income',description:'Ingreso existente',amount:5000,date:'2026-10-19',accountId:'jep'});
  const existing=structuredClone(money.movements),before=M.balance(money),account=M.accountBalance(money,'pichincha');
  const movement=D.registerPayment(money,debt,payment());
  assert.deepEqual(money.movements.slice(0,existing.length),existing);
  assert.equal(M.balance(money),before-14052);
  assert.equal(M.accountBalance(money,'pichincha'),account-14052);
  assert.equal(D.remaining(money,debt),224832);
  assert.equal(D.schedule(money,debt)[0].pending,0);
  assert.equal(M.summary(money,'2026-10').spent,14052);
  assert.throws(()=>M.saveMovement(money,{description:'Cambio',amount:1,date:'2026-10-20'},movement.id),/Mis deudas/);
  M.deleteMovement(money,movement.id);
  assert.equal(M.balance(money),before);
  assert.equal(D.remaining(money,debt),238884);
  assert.equal(D.schedule(money,debt)[0].pending,14052);
});
test('JEP separa intereses del capital y cubre el mínimo por mes, no por fecha del pago',()=>{
  const {money,state}=setup(),debt=state.debts[1];
  D.registerPayment(money,debt,payment({amount:5831,interest:1000}));
  assert.equal(D.remaining(money,debt),85169);
  assert.equal(D.schedule(money,debt,'2026-11-04')[0].pending,0);
  assert.equal(D.schedule(money,debt,'2026-11-04')[1].pending,5831);
  assert.equal(M.summary(money,'2026-10').spent,5831);
});
test('los abonos parciales y libres se acumulan sin cuotas ficticias',()=>{
  const {money,state}=setup(),debt=state.debts[0];
  D.registerPayment(money,debt,payment({amount:5000}));
  assert.equal(D.schedule(money,debt)[0].pending,9052);
  D.registerPayment(money,debt,payment({amount:9052}));
  assert.equal(D.schedule(money,debt)[0].pending,0);
  D.registerPayment(money,state.debts[2],payment({amount:10000,period:''}));
  assert.equal(D.remaining(money,state.debts[2]),90000);
});
test('se rechazan pagos inválidos antes de añadir categorías o movimientos',()=>{
  const {money,state}=setup(),debt=state.debts[0],before=structuredClone(money);
  for(const data of [payment({interest:-1}),payment({interest:14053}),payment({amount:238885}),payment({accountId:'desconocida'}),payment({period:'2026-10'}),payment({period:'2028-04'}),payment({amount:0}),payment({date:'2099-01-01'})]) {
    assert.throws(()=>D.registerPayment(money,debt,data));
    assert.deepEqual(money,before);
  }
  money.accounts[0].openingBalance=1;
  assert.throws(()=>D.registerPayment(money,debt,payment()),/saldo/);
});
test('pagar la deuda completa no permite abonos adicionales',()=>{
  const {money,state}=setup(),debt=state.debts[2];
  D.registerPayment(money,debt,payment({amount:100000,period:''}));
  assert.equal(D.remaining(money,debt),0);
  assert.throws(()=>D.registerPayment(money,debt,payment({amount:1,period:''})));
});
test('diferir JEP conserva pagos y dinero, cambia solo las condiciones de esa deuda',()=>{
  const {money,state}=setup();
  D.registerPayment(money,state.debts[1],payment({amount:5831,interest:1000}));
  const before=structuredClone(money),others=structuredClone(state.debts.filter(d=>d.id!=='jep-card'));
  D.configureJep(state,money,{balance:86000,installment:8600,count:10,firstDue:'2026-12-04'});
  assert.deepEqual(money,before);
  assert.deepEqual(state.debts.filter(d=>d.id!=='jep-card'),others);
  assert.equal(D.remaining(money,state.debts[1]),86000);
  assert.equal(state.debts[1].deferPending,false);
  assert.equal(D.schedule(money,state.debts[1]).length,10);
  assert.throws(()=>D.configureJep(state,money,{}),/ya fue registrado/);
});
test('leer datos antiguos de Mi Dinero no añade deudas ni pierde información nueva',()=>{
  const {money}=setup();money.extraUserData={important:'conservar'};
  const copy=M.readState(money);
  assert.deepEqual(copy,money);
  assert.equal(copy.debts,undefined);
  const invalid=D.initialDebts();invalid.debts[0].count=0;
  assert.throws(()=>D.readDebts(invalid));
  assert.throws(()=>D.readDebts({version:7}));
});
test('la pestaña muestra la tarea, fechas e importes sin escribir al renderizar',()=>{
  const {money,state}=setup(),page=Object.create(DebtPage.prototype);
  page.container={innerHTML:''};page.month='2026-11';page.store={ready:true,state,money:{ready:true,state:money}};
  const before=structuredClone(money);page.render();
  assert.match(page.container.innerHTML,/Mis deudas/);
  assert.match(page.container.innerHTML,/diferir deuda de JEP/);
  assert.match(page.container.innerHTML,/\$4,788\.84/);
  assert.match(page.container.innerHTML,/\$261\.33/);
  assert.match(page.container.innerHTML,/por confirmar/);
  assert.deepEqual(money,before);
  page.store.state=null;page.render();
  assert.match(page.container.innerHTML,/Guardar mis 4 deudas/);
});
