(function(global){
 const options=[
  [1,'Acúmulo de pacotes nas mesas e ilhas acima do limite permitido.'],
  [2,'Pacotes caídos no chão durante o processamento nas esteiras.'],
  [3,'Indução de volumes acima da capacidade de escoamento da esteira.'],
  [4,'Sobrecarga do goleiro, com risco de transbordamento e parada da esteira.'],
  [5,'Ausência de bipagem dos volumes no goleiro.'],
  [6,'Falta de espelhamento durante o processamento.'],
  [7,'Falta de acompanhamento da liderança e de rondas operacionais.'],
  [8,'Suportes de sacas sem lateralização, permitindo a queda de pacotes em sacas já prontas.'],
  [9,'Bipagem de pacotes sobre mesas com outros volumes próximos.'],
  [10,'Acúmulo de pacotes nas mãos para alocação conjunta.'],
  [11,'Unitizadores com volumes em Packed sem o devido endereçamento.'],
  [12,'Divergência entre a rua física do unitizador e a localização registrada no sistema.'],
  [13,'Unitizadores presentes fisicamente, mas sem atrelamento à rua.'],
  [14,'Unitizadores registrados no sistema e não localizados na rua indicada.'],
  [15,'Bipagem de unitizadores nas ruas, fora da área correta de carregamento.'],
  [16,'Envio sistêmico de sacas e unitizadores sem o correspondente carregamento físico.'],
  [17,'Alteração de status das ruas do Outbound por pessoas fora do COP.'],
  [18,'Falha de comunicação de pendências operacionais entre turnos.'],
  [19,'Stretchamento de unitizadores fora do padrão, com risco de queda dos pacotes.'],
  [20,'Scuttles com volumes acima do limite permitido.'],
  [21,'Endereçamento de cargas em paletes quebrados.'],
  [22,'Posicionamento incorreto de gaylords na indução.'],
  [24,'Produtos oriundos de pacotes vazios expostos na operação, sem encaminhamento imediato à área de tratativas.'],
  [25,'Colagem de TOs nos flow racks para identificação de fanouts.'],
  [26,'Papéis de auditoria espalhados nas mesas de endereçamento.'],
  [27,'Materiais e mobiliários em locais não demarcados.'],
  [28,'Poliondas desmontadas ocupando ruas produtivas de endereçamento.'],
  [29,'Colaboradores realizando a pesca de pacotes sem luvas.'],
  [30,'Esteira mantida ligada durante a ausência da equipe no intervalo.']
 ].map(([number,text])=>({number,text}));
 function resolve(process,other){const value=String(process||'').trim();if(value!=='Outros')return value;const reason=String(other||'').trim();if(!reason)throw new Error('Ao selecionar Outros, digite o motivo.');if(reason.length>232)throw new Error('O motivo de Outros deve ter até 232 caracteres.');return 'Outros: '+reason;}
 function attach(select,input,wrapper,preview){const refresh=()=>{const other=select.value==='Outros';wrapper.hidden=!other;input.disabled=!other;input.required=other;preview.textContent=select.value&& !other?select.value:'';};select.addEventListener('change',refresh);refresh();return {validate:()=>resolve(select.value,input.value)};}
 global.MisscanAnomalyProcesses={options,resolve,attach};
})(globalThis);
