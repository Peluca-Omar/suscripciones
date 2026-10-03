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
export function initialState() {
  return {version:1,revision:0,movements:[],budgets:{},legacy:{},categories:[
    'Comida','Transporte','Entretenimiento','Pareja / Regalos','Compras','Hogar','Salud','Otros','Juegos','Fiestas',
  ].map((name,i)=>({id:`category-${i}`,name}))};
}
export function readState(value) {
  if(value===undefined)return initialState();
  if(value.version!==1 || !Array.isArray(value.movements) || !Array.isArray(value.categories) || !value.budgets || !value.legacy)throw new Error('El formato de los datos de Mi Dinero no es compatible.');
  return {...structuredClone(value),revision:value.revision || 0};
}
export const sign = movement => ['income','opening'].includes(movement.type)?movement.amount:-movement.amount;
export const balance = state => state.movements.reduce((sum,m)=>sum+sign(m),0);
export function ledger(state) {
  let total=0;
  return [...state.movements].sort((a,b)=>a.date.localeCompare(b.date)||a.order-b.order).map(m=>({...m,balance:total+=sign(m)}));
}
export function summary(state,month) {
  const result={income:0,fixed:0,variable:0,opening:0,previous:0,closing:0,spent:0,net:0};
  state.movements.forEach(m=>{
    const key=m.date.slice(0,7);
    if(key<month)result.previous+=sign(m);
    if(key<=month)result.closing+=sign(m);
    if(key===month && ['income','fixed','variable','opening'].includes(m.type))result[m.type]+=m.amount;
  });
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
  const record={...old,id:old?.id || crypto.randomUUID(),type,description:data.description.trim(),amount:data.amount,date:data.date,categoryId:data.categoryId || '',order:old?.order || state.movements.reduce((max,m)=>Math.max(max,m.order),0)+1};
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
  return record;
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
