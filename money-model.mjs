export const today = () => {
  const date=new Date();
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
};
export const monthKey = () => today().slice(0,7);
export const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(value) && Number(value.slice(0,4))>=1900;
export function validDate(value) {
  if(!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0,4))<1900)return false;
  const date=new Date(value+'T12:00:00Z');
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0,10)===value;
}
export function cents(value) {
  if(!/^\d+(\.\d{1,2})?$/.test(String(value).trim()))throw new Error('Introduce un valor válido con hasta dos decimales.');
  const amount=Math.round(Number(value)*100);
  if(!Number.isSafeInteger(amount) || amount>100000000000)throw new Error('El valor es demasiado grande.');
  return amount;
}
export const ACCOUNT_DEFINITIONS=[
  {id:'pichincha',name:'Banco Pichincha'},
  {id:'flexi-ahorro',name:'Flexi Ahorro · Pichincha'},
  {id:'bolivariano',name:'Banco Bolivariano'},
  {id:'jep',name:'Coop. JEP'},
  {id:'cash',name:'Efectivo'},
];
const ADDITIONAL_ACCOUNT_IDS=new Set(['flexi-ahorro']);
const defaultAccounts=()=>ACCOUNT_DEFINITIONS.map(account=>({...account,openingBalance:0,needsOpeningBalance:false}));
export function initialState() {
  return {version:2,revision:0,movements:[],budgets:{},legacy:{},accounts:defaultAccounts(),accountsActivatedAt:'',lastAccountId:'',categories:[
    'Comida','Transporte','Entretenimiento','Pareja / Regalos','Compras','Hogar','Salud','Otros','Juegos','Fiestas',
  ].map((name,i)=>({id:`category-${i}`,name}))};
}
export function readState(value) {
  if(value===undefined)return initialState();
  if(!value || ![1,2].includes(value.version) || !Array.isArray(value.movements) || !Array.isArray(value.categories) || !value.budgets || !value.legacy)throw new Error('El formato de los datos de Mi Dinero no es compatible.');
  const state={...structuredClone(value),version:2,revision:value.revision || 0};
  if(value.version===1) {
    // Los movimientos anteriores se conservan exactamente como están. Como no
    // guardaban cuenta, se tratan como historial previo al inicio de cuentas.
    state.accounts=defaultAccounts();state.accountsActivatedAt='';state.lastAccountId='';
    return state;
  }
  const savedAccounts=Array.isArray(value.accounts)?value.accounts:[];
  if(value.accountsActivatedAt && ACCOUNT_DEFINITIONS.some(definition=>!savedAccounts.some(account=>account.id===definition.id) && !ADDITIONAL_ACCOUNT_IDS.has(definition.id)))throw new Error('Faltan datos de una cuenta configurada. No se modificó el historial.');
  state.accounts=ACCOUNT_DEFINITIONS.map(definition=>{
    const saved=savedAccounts.find(account=>account.id===definition.id);
    if(saved && (!Number.isSafeInteger(saved.openingBalance) || saved.openingBalance<0 || saved.openingBalance>100000000000))throw new Error('El saldo inicial de una cuenta no es válido.');
    const newlyAdded=!saved && !!value.accountsActivatedAt && ADDITIONAL_ACCOUNT_IDS.has(definition.id);
    return {...definition,openingBalance:saved?.openingBalance || 0,needsOpeningBalance:!!saved?.needsOpeningBalance || newlyAdded};
  });
  state.accountsActivatedAt=value.accountsActivatedAt || '';
  if(state.accountsActivatedAt && !validDate(state.accountsActivatedAt))throw new Error('La fecha de inicio de las cuentas no es válida.');
  const hasAccountMovements=state.movements.some(m=>m.accountId || m.type==='transfer');
  if(!state.accountsActivatedAt && (hasAccountMovements || state.accounts.some(account=>account.openingBalance)))throw new Error('El estado de las cuentas está incompleto. No se modificó el historial.');
  if(state.accountsActivatedAt && !Number.isSafeInteger(accountOpeningTotal(state)))throw new Error('La suma de los saldos iniciales no es válida.');
  if(state.accountsActivatedAt && state.movements.some(m=>(m.accountId && !state.accounts.some(account=>account.id===m.accountId)) || (m.type==='transfer' && (!state.accounts.some(account=>account.id===m.fromAccountId) || !state.accounts.some(account=>account.id===m.toAccountId)))))throw new Error('Hay movimientos asociados a una cuenta desconocida. No se modificó el historial.');
  if(state.accountsActivatedAt && state.movements.some(m=>state.accounts.some(account=>account.needsOpeningBalance && (m.accountId===account.id || m.fromAccountId===account.id || m.toAccountId===account.id))))throw new Error('Una cuenta pendiente ya tiene movimientos. No se modificó el historial.');
  state.lastAccountId=state.accounts.some(account=>account.id===value.lastAccountId)?value.lastAccountId:'';
  return state;
}
export const accountsActive=state=>!!state.accountsActivatedAt;
export const accountName=(state,id)=>state.accounts.find(account=>account.id===id)?.name || '';
export const sign = movement => movement.type==='transfer'?0:['income','opening','account-opening'].includes(movement.type)?movement.amount:-movement.amount;
export function accountMovementSign(movement,id) {
  if(movement.type==='transfer')return movement.toAccountId===id?movement.amount:movement.fromAccountId===id?-movement.amount:0;
  return movement.accountId===id?sign(movement):0;
}
export function accountBalance(state,id) {
  const account=state.accounts.find(entry=>entry.id===id);
  if(!account)return 0;
  return account.openingBalance+state.movements.reduce((sum,m)=>sum+accountMovementSign(m,id),0);
}
export const accountBalances=state=>state.accounts.map(account=>({...account,balance:accountBalance(state,account.id)}));
export const accountOpeningTotal=state=>state.accounts.reduce((sum,account)=>sum+account.openingBalance,0);
export const balance = state => accountsActive(state)?state.accounts.reduce((sum,account)=>sum+accountBalance(state,account.id),0):state.movements.reduce((sum,m)=>sum+sign(m),0);
export function initializeAccounts(state,balances,date=today()) {
  if(accountsActive(state))throw new Error('Las cuentas ya están configuradas.');
  if(!validDate(date) || date>today())throw new Error('La fecha de inicio no es válida.');
  const values=ACCOUNT_DEFINITIONS.map(account=>{
    const amount=balances[account.id];
    if(!Number.isSafeInteger(amount) || amount<0 || amount>100000000000)throw new Error(`Ingresa un saldo válido para ${account.name}.`);
    return {...account,openingBalance:amount,needsOpeningBalance:false};
  });
  const total=values.reduce((sum,account)=>sum+account.openingBalance,0);
  if(!Number.isSafeInteger(total))throw new Error('La suma de los saldos es demasiado grande.');
  state.accounts=values;state.accountsActivatedAt=date;state.lastAccountId=values[0].id;
  return total;
}
export function initializeAddedAccounts(state,balances,date=today()) {
  if(!accountsActive(state))throw new Error('Configura primero tus cuentas.');
  if(!validDate(date) || date>today() || date<state.accountsActivatedAt)throw new Error('La fecha de inicio de la cuenta no es válida.');
  const pending=state.accounts.filter(account=>account.needsOpeningBalance);
  if(!pending.length)throw new Error('No hay cuentas pendientes de configurar.');
  const values=pending.map(account=>{
    const amount=balances[account.id];
    if(!Number.isSafeInteger(amount) || amount<0 || amount>100000000000)throw new Error(`Ingresa un saldo válido para ${account.name}.`);
    return {account,amount};
  });
  values.forEach(({account,amount})=>{
    account.needsOpeningBalance=false;
    if(amount)state.movements.push({id:crypto.randomUUID(),type:'account-opening',description:`Saldo inicial · ${account.name}`,amount,date,accountId:account.id,order:state.movements.reduce((max,m)=>Math.max(max,m.order),0)+1});
  });
  state.lastAccountId=values[0].account.id;
  return values.reduce((sum,item)=>sum+item.amount,0);
}
export function ledger(state) {
  let historicalTotal=0,accountTotal=accountOpeningTotal(state);
  return [...state.movements].sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order).map(m=>{
    if(accountsActive(state) && (m.accountId || m.type==='transfer')) {
      accountTotal+=sign(m);
      return {...m,balance:accountTotal};
    }
    historicalTotal+=sign(m);
    return {...m,balance:historicalTotal};
  });
}
export function summary(state,month) {
  const result={income:0,fixed:0,variable:0,opening:0,accountOpening:0,previous:0,closing:0,spent:0,net:0};
  result.setupAdjustment=0;
  const activationMonth=accountsActive(state)?state.accountsActivatedAt.slice(0,7):'';
  if(!activationMonth || month<activationMonth) {
    state.movements.forEach(m=>{
      const key=m.date.slice(0,7);
      if(key<month)result.previous+=sign(m);
      if(key<=month)result.closing+=sign(m);
      if(key===month && ['income','fixed','variable','opening'].includes(m.type))result[m.type]+=m.amount;
    });
  } else if(month===activationMonth) {
    state.movements.forEach(m=>{
      const key=m.date.slice(0,7);
      if(key<month)result.previous+=sign(m);
      if(key===month && ['income','fixed','variable','opening'].includes(m.type))result[m.type]+=m.amount;
      if(key===month && m.type==='account-opening')result.accountOpening+=m.amount;
    });
    const legacyAtActivation=state.movements.filter(m=>!m.accountId && m.type!=='transfer' && m.date<=state.accountsActivatedAt).reduce((sum,m)=>sum+sign(m),0);
    result.setupAdjustment=accountOpeningTotal(state)-legacyAtActivation;
    result.closing=result.previous+result.setupAdjustment+state.movements.filter(m=>m.date.slice(0,7)===month).reduce((sum,m)=>sum+sign(m),0);
  } else {
    result.previous=accountOpeningTotal(state)+state.movements.filter(m=>(m.accountId || m.type==='transfer') && m.date.slice(0,7)<month).reduce((sum,m)=>sum+sign(m),0);
    const current=state.movements.filter(m=>(m.accountId || m.type==='transfer') && m.date.slice(0,7)===month);
    current.forEach(m=>{
      if(['income','fixed','variable','opening'].includes(m.type))result[m.type]+=m.amount;
      if(m.type==='account-opening')result.accountOpening+=m.amount;
    });
    result.closing=result.previous+current.reduce((sum,m)=>sum+sign(m),0);
  }
  result.spent=result.fixed+result.variable;
  result.net=result.income-result.spent;
  return result;
}
export const payment = (state,id,period) => state.movements.find(m=>m.type==='fixed' && m.subscriptionId===id && m.period===period);
export const legacyKey = item => `${item.id}:${item.paidMonth}`;
export function saveMovement(state,data,id) {
  const old=id?state.movements.find(m=>m.id===id):null;
  if(id && !old)throw new Error('El movimiento ya no existe.');
  const type=old?.type || data.type;
  if(!['opening','income','variable','fixed'].includes(type))throw new Error('Tipo de movimiento inválido.');
  if(!data.description?.trim() || data.description.length>160)throw new Error('Escribe una descripción de hasta 160 caracteres.');
  if(!Number.isSafeInteger(data.amount) || data.amount<=0 || data.amount>100000000000)throw new Error('El valor debe ser mayor que cero.');
  if(!validDate(data.date) || data.date>today())throw new Error('La fecha debe ser válida y no puede ser posterior a hoy.');
  if(type==='opening' && state.movements.some(m=>m.type==='opening' && m.id!==id))throw new Error('Ya tienes un saldo inicial. Puedes editarlo.');
  if(['income','variable'].includes(type)) {
    if(type==='variable' && !data.categoryId)throw new Error('Selecciona una categoría.');
    if(data.categoryId && !state.categories.some(c=>c.id===data.categoryId))throw new Error('La categoría ya no existe.');
  }
  const selectedAccount=data.accountId || old?.accountId || '';
  if(state.accountsActivatedAt && ['income','variable','fixed'].includes(type) && !old && !selectedAccount)throw new Error('Selecciona la cuenta de este movimiento.');
  if(old && !old.accountId && data.accountId && accountsActive(state))throw new Error('Los movimientos anteriores al inicio de cuentas no se pueden asignar sin alterar sus saldos iniciales.');
  if(selectedAccount) {
    validateAccount(state,selectedAccount);
    if(data.date<state.accountsActivatedAt)throw new Error('La fecha no puede ser anterior al inicio del seguimiento por cuentas.');
  }
  const record={...old,id:old?.id || crypto.randomUUID(),type,description:data.description.trim(),amount:data.amount,date:data.date,categoryId:data.categoryId || '',order:old?.order || state.movements.reduce((max,m)=>Math.max(max,m.order),0)+1};
  if(selectedAccount)record.accountId=selectedAccount;
  if(type==='fixed') {
    record.subscriptionId=old?.subscriptionId || data.subscriptionId;
    record.period=old?.period || data.period;
    record.categoryId='';
    record.category=old?.category || data.category || 'Gasto fijo';
    if(!record.subscriptionId || !validMonth(record.period))throw new Error('El pago mensual no es válido.');
    if(state.movements.some(m=>m.type==='fixed' && m.subscriptionId===record.subscriptionId && m.period===record.period && m.id!==id))throw new Error('Ya se registró el pago de esa cuota mensual.');
  }
  if(old)state.movements[state.movements.indexOf(old)]=record;
  else state.movements.push(record);
  if(selectedAccount)state.lastAccountId=selectedAccount;
  return record;
}
export function saveTransfer(state,data) {
  if(!accountsActive(state))throw new Error('Configura primero los saldos de tus cuentas.');
  validateAccount(state,data.fromAccountId);validateAccount(state,data.toAccountId);
  if(data.fromAccountId===data.toAccountId)throw new Error('El origen y el destino deben ser cuentas diferentes.');
  if(!Number.isSafeInteger(data.amount) || data.amount<=0 || data.amount>100000000000)throw new Error('El valor de la transferencia debe ser mayor que cero.');
  if(!validDate(data.date) || data.date>today() || data.date<state.accountsActivatedAt)throw new Error('La fecha de la transferencia no es válida.');
  if(data.amount>accountBalance(state,data.fromAccountId))throw new Error('El saldo de la cuenta de origen no alcanza para esta transferencia.');
  const record={id:crypto.randomUUID(),type:'transfer',description:data.description?.trim() || 'Transferencia entre mis cuentas',amount:data.amount,date:data.date,fromAccountId:data.fromAccountId,toAccountId:data.toAccountId,order:state.movements.reduce((max,m)=>Math.max(max,m.order),0)+1};
  state.movements.push(record);state.lastAccountId=data.toAccountId;
  return record;
}
export function validateAccount(state,id) {
  if(!accountsActive(state) || !state.accounts.some(account=>account.id===id))throw new Error('Selecciona una cuenta válida.');
  const account=state.accounts.find(entry=>entry.id===id);
  if(account.needsOpeningBalance)throw new Error(`Registra primero el saldo inicial de ${account.name}.`);
  return id;
}
export function assignFixedPaymentAccount(state,subscriptionId,accountId,period=monthKey()) {
  validateAccount(state,accountId);
  const movement=payment(state,subscriptionId,period);
  if(movement?.accountId)movement.accountId=accountId;
  state.lastAccountId=accountId;
}
// Las versiones anteriores guardaban únicamente el último mes pagado.
// Se incorpora una sola vez ese pago conocido, sin inventar meses anteriores.
export function importLegacyPayment(state,item) {
  if(!validMonth(item.paidMonth) || state.legacy[legacyKey(item)])return false;
  if(!payment(state,item.id,item.paidMonth)) {
    const timestamp=typeof item.paidAt==='string'?new Date(item.paidAt):null;
    const sourceDate=timestamp && Number.isFinite(timestamp.getTime())
      ? `${timestamp.getFullYear()}-${String(timestamp.getMonth()+1).padStart(2,'0')}-${String(timestamp.getDate()).padStart(2,'0')}` : '';
    const exactDate=validDate(sourceDate) && sourceDate<=today();
    const date=exactDate?sourceDate:`${item.paidMonth}-01`;
    const record=saveMovement(state,{
      type:'fixed',description:item.name,amount:cents(item.price),date,
      subscriptionId:item.id,period:item.paidMonth,category:item.category,
    });
    record.imported=true;
    record.estimatedDate=!exactDate;
  }
  state.legacy[legacyKey(item)]=true;
  return true;
}
export function deleteMovement(state,id) {
  const item=state.movements.find(m=>m.id===id);
  if(!item)throw new Error('El movimiento ya no existe.');
  state.movements=state.movements.filter(m=>m.id!==id);
  return item;
}
export function renameCategory(state,id,name) {
  const trimmed=name.trim();
  if(!trimmed || trimmed.length>60)throw new Error('El nombre debe tener de 1 a 60 caracteres.');
  if(state.categories.some(c=>c.id!==id && c.name.toLocaleLowerCase()===trimmed.toLocaleLowerCase()))throw new Error('Ya existe una categoría con ese nombre.');
  const category=state.categories.find(c=>c.id===id);
  if(id && !category)throw new Error('La categoría ya no existe.');
  if(category)category.name=trimmed;
  else {const created={id:crypto.randomUUID(),name:trimmed};state.categories.push(created);return created.id;}
  return id;
}
