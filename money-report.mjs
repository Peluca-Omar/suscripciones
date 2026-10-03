import {validMonth,validDate,today,summary} from './money-model.mjs';

const escape=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(value/100);
const dateLabel=value=>new Intl.DateTimeFormat('es',{day:'numeric',month:'long',year:'numeric'}).format(new Date(value+'T12:00:00'));
const monthLabel=value=>new Intl.DateTimeFormat('es',{month:'long',year:'numeric'}).format(new Date(value+'-01T12:00:00'));

export function monthlyReport(state,month,owner='',issued=today()) {
  if(!validMonth(month) || !validDate(issued))throw new Error('Selecciona un mes válido para el informe.');
  const current=issued.slice(0,7), status=month<current?'Histórico':month===current?'Provisional':'Mes futuro';
  const end=new Date(Number(month.slice(0,4)),Number(month.slice(5)),0).getDate();
  return {version:1,month,owner,issued,status,currency:'USD',cutoff:month<current?`${month}-${end}`:month===current?issued:'',
    ...summary(state,month),count:state.movements.filter(m=>m.date.slice(0,7)===month).length};
}

export function reportCSV(report) {
  // Columnas estables para importar siempre la misma plantilla. Los importes
  // son números decimales en USD, sin símbolos ni separadores de miles.
  const headers=['version_plantilla','mes','moneda','fecha_emision','estado','fecha_corte','saldo_anterior','saldo_inicial_del_mes','ingresos','gastos_fijos_pagados','gastos_variables','gastos_totales','resultado_del_mes','saldo_al_cierre','numero_movimientos'];
  const values=[report.version,report.month,report.currency,report.issued,report.status,report.cutoff,
    ...['previous','opening','income','fixed','variable','spent','net','closing'].map(key=>(report[key]/100).toFixed(2)),report.count];
  const row=values=>values.map(value=>`"${String(value).replace(/"/g,'""')}"`).join(',');
  return '\uFEFF'+row(headers)+'\r\n'+row(values)+'\r\n';
}

export function reportHTML(report,stylesheet) {
  const result=report.net>0?'Resultado positivo':report.net<0?'Gastos superiores a los ingresos':'Ingresos y gastos equilibrados';
  const rows=[['Saldo anterior',report.previous,'Saldo acumulado antes del mes'],
    ...(report.opening?[['Saldo inicial registrado en el mes',report.opening,'Capital de partida · no es un ingreso']]:[]),
    ['Ingresos del mes',report.income,'Entradas registradas'],['Gastos fijos pagados',-report.fixed,'Pagos realizados por fecha de movimiento'],
    ['Gastos variables',-report.variable,'Gastos diarios registrados']];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Informe-financiero-${escape(report.month)}</title><link rel="stylesheet" href="${escape(stylesheet)}"></head><body>
    <main class="report">
      <header class="report-header"><div class="report-brand">CONTROL PERSONAL <span>FINANZAS PERSONALES</span></div><div class="report-reference">INFORME MENSUAL<br><b>${escape(report.month)}</b></div></header>
      <section class="report-title"><p class="report-eyebrow">RESUMEN EJECUTIVO</p><h1>Informe financiero<br>personal</h1><p class="report-period">${escape(monthLabel(report.month))}</p><div class="report-meta"><span>Preparado para <b>${escape(report.owner || 'Mi cuenta')}</b></span><span>Emitido el ${escape(dateLabel(report.issued))}</span><span class="report-badge">${escape(report.status)}</span></div></section>
      <section class="report-kpis" aria-label="Indicadores principales">${[['Ingresos',report.income,''],['Gastos totales',report.spent,''],['Resultado del mes',report.net,report.net<0?'negative':'positive'],['Saldo al cierre¹',report.closing,'featured']].map(([label,value,style])=>`<article class="${style}"><span>${label}</span><strong>${money(value)}</strong></article>`).join('')}</section>
      <section class="report-section"><h2>Estado de cuentas <span>Importes en USD</span></h2><table><thead><tr><th scope="col">Concepto</th><th scope="col">Importe</th></tr></thead><tbody>${rows.map(([label,value,note])=>`<tr><th scope="row">${label}<small>${note}</small></th><td>${money(value)}</td></tr>`).join('')}<tr class="report-total"><th scope="row">Saldo al cierre del mes¹</th><td>${money(report.closing)}</td></tr></tbody></table></section>
      <section class="report-insight"><div class="report-insight-mark">${report.net<0?'−':report.net>0?'+':'='}</div><div><h2>${result}</h2><p>${report.net<0?'Los gastos registrados superan los ingresos del mes en '+money(-report.net)+'.':report.net>0?'Los ingresos superan los gastos del mes en '+money(report.net)+'.':'El resultado de ingresos menos gastos del mes es '+money(0)+'.'} El resultado del mes excluye el saldo anterior y el saldo inicial.</p></div></section>
      <section class="report-notes"><h2>Alcance del informe</h2><p>¹ ${report.status==='Histórico'?'Saldo según los movimientos registrados hasta el '+dateLabel(report.cutoff)+'.':report.status==='Provisional'?'Mes en curso: cifras provisionales con corte al '+dateLabel(report.cutoff)+'.':'Mes futuro: saldo acumulado disponible; todavía no existe un cierre mensual.'} Se incluyen únicamente movimientos registrados; los gastos pendientes de pago no se descuentan.</p><p>${report.count?report.count+' movimiento'+(report.count===1?'':'s')+' registrado'+(report.count===1?'':'s')+' en el mes.':'No hay movimientos registrados en este mes; el saldo refleja el historial anterior.'} ${report.opening?'El saldo inicial del mes se presenta por separado para explicar el saldo al cierre.':''}</p></section>
      <footer class="report-footer"><span>CONTROL PERSONAL · Informe financiero personal</span><span>Plantilla mensual v${report.version} · USD</span></footer>
    </main></body></html>`;
}
