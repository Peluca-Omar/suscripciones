// El CSV se analiza localmente. Solo se extraen campos explícitamente permitidos.
export function parseCSV(text) {
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  text=String(text).replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++) {
    const ch=text[i];
    if(quoted) {
      if(ch==='"' && text[i+1]==='"'){cell+='"';i++;}
      else if(ch==='"'){quoted=false;closed=true;}
      else cell+=ch;
    } else if(ch==='"' && !cell && !closed)quoted=true;
    else if(ch===','){row.push(cell);cell='';closed=false;}
    else if(ch==='\n' || ch==='\r'){
      if(ch==='\r' && text[i+1]==='\n')i++;
      row.push(cell);if(row.some(Boolean))rows.push(row);row=[];cell='';closed=false;
    } else {if(closed || ch==='"')throw new Error('El CSV tiene comillas inválidas.');cell+=ch;}
  }
  if(quoted)throw new Error('El CSV está incompleto: falta cerrar una comilla.');
  if(cell || row.length){row.push(cell);rows.push(row);}
  return rows;
}
const number=(value,label)=>{
  const s=String(value ?? '').trim();
  if(!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(s) || !Number.isFinite(Number(s)))throw new Error(`Dato inválido o ausente: ${label}.`);
  return Number(s);
};
function endDate(period) {
  const months={enero:1,febrero:2,marzo:3,abril:4,mayo:5,junio:6,julio:7,agosto:8,septiembre:9,octubre:10,noviembre:11,diciembre:12,january:1,february:2,march:3,april:4,may:5,june:6,july:7,august:8,september:9,october:10,november:11,december:12};
  const value=period.split(/\s+-\s+/).at(-1).trim();
  let year,month,day;
  const iso=value.match(/^(\d{4})-(\d{2})-(\d{2})$/),named=value.match(/^([a-záéíóú]+)\s+(\d{1,2}),?\s+(\d{4})$/i),spanish=value.match(/^(\d{1,2})\s+de\s+([a-záéíóú]+)\s+de\s+(\d{4})$/i);
  if(iso)[,year,month,day]=iso;
  else if(named){month=months[named[1].toLowerCase()];day=named[2];year=named[3];}
  else if(spanish){day=spanish[1];month=months[spanish[2].toLowerCase()];year=spanish[3];}
  if(!year || !month || !day)throw new Error('No se reconoce la fecha final del extracto. Usa un informe de actividad CSV de IBKR.');
  const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
  const parsed=new Date(date+'T00:00:00Z');
  if(!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0,10)!==date)throw new Error('La fecha final del extracto no es válida.');
  return date;
}
export function importStatement(text) {
  if(String(text).replace(/^\uFEFF/,'').startsWith('Introduction,Header,'))return importPortfolioReport(text);
  const rows=parseCSV(text), find=(section,key)=>rows.find(r=>r[0]===section && r[1]==='Data' && r[2]===key)?.[3];
  if(find('Statement','Title')!=='Informe de actividad')throw new Error('Selecciona un informe de actividad de Interactive Brokers en español.');
  if(find('Información sobre la cuenta','Divisa base')!=='USD')throw new Error('Por ahora solo se admiten extractos con divisa base USD.');
  const date=endDate(find('Statement','Period') || '');
  const nav=rows.find(r=>r[0]==='Valor liquidativo' && r[1]==='Data' && r[2]==='Total');
  if(!nav)throw new Error('El extracto no contiene el valor liquidativo total.');
  const value=number(nav[6],'valor total'),cash=rows.find(r=>r[0]==='Valor liquidativo' && r[1]==='Data' && r[2]==='Efectivo');
  const cashValue=cash?number(cash[6],'efectivo'):null;
  const rateIndex=rows.findIndex(r=>r[0]==='Valor liquidativo' && r[1]==='Header' && r[2]==='Tasa de rendimiento ponderada por tiempo');
  const rateRow=rateIndex>=0?rows[rateIndex+1]:null,rateText=rateRow?.[0]==='Valor liquidativo' && rateRow[1]==='Data'?rateRow[2]?.trim():'';
  const rate=rateText && /^-?\d+(?:\.\d+)?%$/.test(rateText)?number(rateText.slice(0,-1),'rendimiento'):null;
  const navField=key=>{const value=find('Cambio en NAV',key);return value===undefined?null:number(value,key);};
  if(!rows.some(r=>r[0]==='Posiciones abiertas' && r[1]==='Header'))throw new Error('El extracto no incluye la sección Posiciones abiertas.');
  const positions=rows.filter(r=>r[0]==='Posiciones abiertas' && r[1]==='Data' && r[2]==='Summary').map(r=>{
    if(r[4]!=='USD')throw new Error('El extracto contiene posiciones en otra divisa; esta versión solo admite USD.');
    if(!r[5] || r[5].length>40)throw new Error('Símbolo de inversión inválido.');
    return {symbol:r[5],quantity:number(r[7],'cantidad'),price:number(r[11],'precio'),value:number(r[12],'valor de posición'),profit:number(r[13],'resultado no realizado')};
  });
  return {date,value,cash:cashValue,rate,netDeposits:navField('Depósitos y retiradas'),commissions:navField('Comisiones'),grant:navField('Actividad de la subvención'),positions};
}
function importPortfolioReport(text) {
  // Se descartan antes del análisis las secciones de identidad, notas y datos
  // que no se utilizan. Las notas pueden contener comillas CSV no escapadas.
  const lines=String(text).replace(/^\uFEFF/,'').split(/\r?\n/);
  const introHeader=parseCSV(lines.find(line=>line.startsWith('Introduction,Header,')) || '')[0];
  const currencyIndex=introHeader?.indexOf('BaseCurrency');
  const intro=lines.find(line=>line.startsWith('Introduction,Data,'));
  if(currencyIndex<0 || !intro || parseCSV(intro)[0]?.[currencyIndex]!=='USD')throw new Error('Por ahora solo se admiten informes con divisa base USD.');
  const allowed=['Key Statistics,','Open Position Summary,','Allocation by Asset Class,'];
  const rows=parseCSV(lines.filter(line=>allowed.some(prefix=>line.startsWith(prefix))).join('\n'));
  const get=(section,type)=>rows.find(r=>r[0]===section && r[1]===type);
  const keyHeader=get('Key Statistics','Header'),key=get('Key Statistics','Data'),period=get('Key Statistics','MetaInfo');
  if(!keyHeader || !key || !period)throw new Error('El informe no contiene las estadísticas necesarias.');
  const lookup=(header,row,name)=>{const index=header.indexOf(name,2);if(index<0)throw new Error(`Falta la columna ${name}.`);return row[index];};
  const date=endDate(period[3] || ''),value=number(lookup(keyHeader,key,'EndingNAV'),'valor final');
  const optional=name=>{const v=lookup(keyHeader,key,name);return v==='' || v==='-'?null:number(v,name);};
  const header=get('Open Position Summary','Header');
  if(!header)throw new Error('Falta la sección de posiciones del informe.');
  const positions=rows.filter(r=>r[0]==='Open Position Summary' && r[1]==='Data' && /^\d{2}\/\d{2}\/\d{4}$/.test(r[2]) && lookup(header,r,'FinancialInstrument')!=='Cash').map(r=>{
    if(lookup(header,r,'Currency')!=='USD')throw new Error('Por ahora solo se admiten posiciones en USD.');
    const symbol=lookup(header,r,'Symbol');if(!symbol || symbol.length>40)throw new Error('Símbolo de inversión inválido.');
    return {symbol,quantity:number(lookup(header,r,'Quantity'),'cantidad'),price:number(lookup(header,r,'ClosePrice'),'precio'),value:number(lookup(header,r,'Value'),'valor de posición'),profit:number(lookup(header,r,'UnrealizedP&L'),'resultado no realizado')};
  });
  const allocationHeader=get('Allocation by Asset Class','Header');
  if(!allocationHeader)throw new Error('El informe no incluye la evolución del valor de cartera.');
  const data=rows.filter(r=>r[0]==='Allocation by Asset Class' && r[1]==='Data');
  const history=data.map(r=>{
    const key=lookup(allocationHeader,r,'Date');
    if(!/^\d{6}$/.test(key))throw new Error('La frecuencia histórica no es mensual o no se reconoce.');
    const year=Number(key.slice(0,4)),month=Number(key.slice(4,6));
    if(year<1900 || month<1 || month>12)throw new Error('Fecha histórica inválida.');
    const last=new Date(Date.UTC(year,month,0)).getUTCDate();
    const end=`${key.slice(0,4)}-${key.slice(4,6)}-${String(last).padStart(2,'0')}`;
    const pointDate=key===date.slice(0,7).replace('-','')?date:end;
    if(pointDate>date)throw new Error('El historial incluye fechas posteriores al informe.');
    return {date:pointDate,value:number(lookup(allocationHeader,r,'NAV'),'valor histórico')};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  if(!history.length || new Set(history.map(p=>p.date)).size!==history.length)throw new Error('El historial mensual está vacío o tiene fechas duplicadas.');
  const last=data.find(r=>lookup(allocationHeader,r,'Date')===date.slice(0,7).replace('-',''));
  if(!last || Math.abs(number(lookup(allocationHeader,last,'NAV'),'valor final histórico')-value)>0.02)throw new Error('El valor final no coincide con el historial del informe.');
  return {date,value,cash:number(lookup(allocationHeader,last,'Cash'),'efectivo'),rate:optional('CumulativeReturn'),netDeposits:optional('Deposits & Withdrawals'),commissions:optional('Fees & Commissions'),grant:null,positions,history};
}
export function projection(initial,monthly,annual,years) {
  if(![initial,monthly,annual,years].every(Number.isFinite) || initial<0 || monthly<0 || annual<0 || annual>100 || !Number.isInteger(years) || years<1 || years>50 || initial>1e9 || monthly>1e9)throw new Error('Revisa los valores: plazo de 1 a 50 años y rendimiento de 0 a 100 %.');
  let balance=initial;const points=[{year:0,balance,contributed:initial}],rate=Math.pow(1+annual/100,1/12)-1;
  for(let month=1;month<=years*12;month++){balance=balance*(1+rate)+monthly;if(month%12===0)points.push({year:month/12,balance,contributed:initial+monthly*month});}
  return points;
}
