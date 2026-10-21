(function(root){
  // Turno apenas filtra pessoas. O denominador permanece o mesmo do recorte MG4.
  function calculate({numerator,total,turnTotal,operationTotal,personTotal,turn='',operation='',person=''}={}){
    const scope=person?'person':operation?'operation':'soc';
    const raw=scope==='person'?personTotal:scope==='turn'?turnTotal:scope==='operation'?operationTotal:total;
    const denominator=raw==null?null:Number(raw);
    return {scope,denominator:Number.isFinite(denominator)?denominator:null,
      value:Number.isFinite(denominator)&&denominator>0?Math.max(0,Number(numerator)||0)/denominator*100:null};
  }
  function weeklyRow(row,weeks,{turn='',operation=''}={}){
    return {...row,weeks:Object.fromEntries(Object.entries(row.weeks||{}).map(([key,metric])=>{
      const week=weeks.find(w=>w.week===key),totals=week?.shareTotals;
      const numerator=operation==='ESTEIRA'?Number(metric.esteira)||0:operation==='EXPEDIÇÃO'?Number(metric.expedicao)||0:Number(metric.missScan)||0;
      const operationKey=operation==='ESTEIRA'?'esteira':'expedicao';
      const share=calculate({numerator,total:week?.missScan,turnTotal:totals?.turns?.[turn]?.total,operationTotal:totals?.[operationKey],turn,operation});
      return [key,{...metric,missScan:numerator,share:share.value,shareDenominator:share.denominator,shareScope:share.scope}];
    }))};
  }
  root.MisscanOfficialShare={calculate,weeklyRow};
})(globalThis);
