import * as M from './money-model.mjs';

export function initialDebts() {
  return {version:1,revision:0,debts:[
    {id:'pichincha-card',name:'Tarjeta Pichincha',openingAmount:238884,kind:'installments',installment:14052,count:17,firstDue:'2026-11-06',dueDay:6,cutDay:18},
    {id:'jep-card',name:'Tarjeta JEP',openingAmount:90000,kind:'minimum',installment:5831,firstDue:'2026-11-04',dueDay:4,cutDay:15,cutUnconfirmed:true,deferPending:true},
    {id:'suegra',name:'Suegra',openingAmount:100000,kind:'flexible'},
    {id:'biess',name:'Préstamo BIESS',openingAmount:50000,kind:'installments',installment:6250,count:8,firstDue:'2026-10-31',dueDay:31},
  ]};
}
export function readDebts(value) {
  if(value===undefined)return null;
  if(!value || value.version!==1 || !Number.isSafeInteger(value.revision) || !Array.isArray(value.debts))throw new Error('El formato de Mis deudas no es compatible. No se modificaron tus datos.');
  const ids=new Set();
  for(const debt of value.debts) {
    if(!debt.id || ids.has(debt.id) || !debt.name || !Number.isSafeInteger(debt.openingAmount) || debt.openingAmount<=0 || !['installments','minimum','flexible'].includes(debt.kind))throw new Error('Hay una deuda con datos inválidos. No se modificaron tus datos.');
    ids.add(debt.id);
    if(debt.kind!=='flexible' && (!M.validDate(debt.firstDue) || !Number.isSafeInteger(debt.installment) || debt.installment<=0 || !Number.isInteger(debt.dueDay) || debt.dueDay<1 || debt.dueDay>31))throw new Error('El calendario de una deuda no es válido.');
    if(debt.kind==='installments' && (!Number.isInteger(debt.count) || debt.count<1 || debt.count>600))throw new Error('El número de cuotas no es válido.');
  }
  return structuredClone(value);
}
export const payments=(money,id)=>money.movements.filter(m=>m.debtId===id);
export const principal=m=>m.amount-(m.debtInterest || 0);
export const paidPrincipal=(money,id)=>payments(money,id).reduce((sum,m)=>sum+principal(m),0);
export const remaining=(money,debt)=>debt.openingAmount-paidPrincipal(money,debt.id);
export function dueDate(debt,index) {
  const [year,month]=debt.firstDue.split('-').map(Number),date=new Date(Date.UTC(year,month-1+index,1));
  const y=date.getUTCFullYear(),m=date.getUTCMonth()+1,last=new Date(Date.UTC(y,m,0)).getUTCDate();
  return `${y}-${String(m).padStart(2,'0')}-${String(Math.min(debt.dueDay,last)).padStart(2,'0')}`;
}
export function schedule(money,debt,asOf=M.today()) {
  if(debt.kind==='flexible')return [];
  const months=(Number(asOf.slice(0,4))-Number(debt.firstDue.slice(0,4)))*12+Number(asOf.slice(5,7))-Number(debt.firstDue.slice(5,7));
  const count=debt.kind==='installments'?debt.count:Math.max(1,months+2);
  return Array.from({length:count},(_,index)=>{
    const date=dueDate(debt,index),period=date.slice(0,7);
    const paid=payments(money,debt.id).filter(m=>m.debtPeriod===period).reduce((sum,m)=>sum+m.amount,0);
    return {index:index+1,date,period,paid,pending:Math.max(0,debt.installment-paid)};
  });
}
export function registerPayment(money,debt,data) {
  M.validateAccount(money,data.accountId);
  if(!M.validMonth(data.period) && debt.kind!=='flexible')throw new Error('Selecciona el mes de la cuota o del mínimo.');
  if(!Number.isSafeInteger(data.interest) || data.interest<0 || data.interest>data.amount)throw new Error('Los intereses deben estar entre cero y el total pagado.');
  if(data.amount-data.interest>remaining(money,debt))throw new Error('El abono a capital supera la deuda pendiente.');
  if(remaining(money,debt)<=0)throw new Error('Esta deuda ya está pagada.');
  if(debt.kind!=='flexible') {
    if(data.period<debt.firstDue.slice(0,7) || (debt.kind==='installments' && data.period>dueDate(debt,debt.count-1).slice(0,7)))throw new Error('El mes está fuera del calendario de esta deuda.');
  }
  if(data.amount>M.accountBalance(money,data.accountId))throw new Error('El saldo de la cuenta elegida no alcanza para este pago.');
  const draft=structuredClone(money);
  if(!draft.categories.some(c=>c.id==='debt-payments'))draft.categories.push({id:'debt-payments',name:'Pago de deudas'});
  const movement=M.saveMovement(draft,{type:'variable',description:`Pago de deuda · ${debt.name}`,amount:data.amount,date:data.date,accountId:data.accountId,categoryId:'debt-payments'});
  Object.assign(movement,{debtId:debt.id,debtInterest:data.interest,debtPeriod:debt.kind==='flexible'?'':data.period});
  Object.assign(money,draft);
  return movement;
}
export function configureJep(state,money,data) {
  const debt=state.debts.find(d=>d.id==='jep-card');
  if(!debt?.deferPending)throw new Error('El diferido de JEP ya fue registrado.');
  if(!M.validDate(data.firstDue) || !Number.isInteger(data.count) || data.count<1 || data.count>600 || !Number.isSafeInteger(data.installment) || data.installment<=0 || !Number.isSafeInteger(data.balance) || data.balance<=0)throw new Error('Revisa saldo, cuota, número de cuotas y primera fecha de pago.');
  // Conserva todos los abonos anteriores; el saldo confirmado no es un pago.
  Object.assign(debt,{kind:'installments',openingAmount:paidPrincipal(money,debt.id)+data.balance,installment:data.installment,count:data.count,firstDue:data.firstDue,dueDay:Number(data.firstDue.slice(8,10)),deferPending:false,configuredAt:M.today()});
}
