(function(global){
 const valid=value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&Number.isFinite(Date.parse(value+'T12:00:00Z'))&&new Date(value+'T12:00:00Z').toISOString().slice(0,10)===value;
 function date(value){const text=String(value||'').trim();if(valid(text))return text;const m=text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);const normalized=m?`${m[3]}-${m[2]}-${m[1]}`:'';return valid(normalized)?normalized:'';}
 function today(now=new Date()){const parts=new Intl.DateTimeFormat('en-US',{timeZone:'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(now),get=k=>parts.find(x=>x.type===k).value;return `${get('year')}-${get('month')}-${get('day')}`;}
 function anniversary(admission){const parsed=date(admission);if(!parsed)return '';const [year,month,day]=parsed.split('-').map(Number),next=new Date(Date.UTC(year,month,1)),last=new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate();return `${next.getUTCFullYear()}-${String(next.getUTCMonth()+1).padStart(2,'0')}-${String(Math.min(day,last)).padStart(2,'0')}`;}
 function classify(record,day=today()){
  if(!record)return {group:'REVIEW',reason:'Data de admissão não confirmada',admissionDate:'',transferDate:''};
  if(record.conflict)return {group:'REVIEW',reason:'Datas de admissão conflitantes na ABS',admissionDate:'',transferDate:''};
  const admissionDate=date(record.admissionDate);
  if(!admissionDate)return {group:'REVIEW',reason:record.admissionDate?'Data de admissão inválida':'Data de admissão não informada',admissionDate:'',transferDate:''};
  const transferDate=anniversary(admissionDate);
  if(admissionDate>day)return {group:'REVIEW',reason:'Data de admissão futura',admissionDate,transferDate};
  return {group:day<transferDate?'NEW':'MAIN',reason:'',admissionDate,transferDate};
 }
 const matches=(record,scope='MAIN',day=today())=>scope==='NEW'?classify(record,day).group==='NEW':classify(record,day).group!=='NEW';
 global.MisscanNewHirePolicy={date,today,anniversary,classify,matches};
})(globalThis);
