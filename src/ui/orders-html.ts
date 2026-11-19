import { buildHtmlPage } from './base.js'

const SCRIPT = `
function fmt(n){return n==null?'—':new Intl.NumberFormat('hu-HU').format(n)+' Ft'}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function fmtDate(s){if(!s)return'—';var d=new Date(s);return d.toLocaleDateString('hu-HU',{month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});}
function showMsg(type,text){
  var box=document.createElement('div');
  box.className=type==='ok'?'success-box':'error-box';box.textContent=text;
  document.getElementById('root').prepend(box);setTimeout(function(){box.remove()},5000);
}
function setLoading(el,v){if(el){el.disabled=v;if(v)el.textContent='…';}}

var STATUS_MAP={
  received:{cls:'chip-warn',label:'Megérkezett'},
  forwarded:{cls:'chip-accent',label:'Továbbítva'},
  shipped:{cls:'chip-good',label:'Kiszállítva'},
  error:{cls:'chip-bad',label:'Hiba'}
};

function renderOrders(data){
  var root=document.getElementById('root');
  var orders=data&&(data.orders||data);
  if(!Array.isArray(orders)||orders.length===0){root.innerHTML='<div class="empty">Nincs rendelés.</div>';return;}
  var total=data.total||orders.length;
  var html='<div class="label" style="margin-bottom:12px">'+orders.length+(total>orders.length?' / '+total:'')+' rendelés</div>';
  for(var i=0;i<orders.length;i++){
    var o=orders[i];
    var sm=STATUS_MAP[o.status]||{cls:'chip-neutral',label:o.status};
    html+='<div class="card" id="ord-'+o.id+'">';
    html+='<div class="row-between" style="margin-bottom:6px">';
    html+='<div><h2 style="margin:0">'+esc(o.customerName||'—')+'</h2>';
    html+='<span class="muted">#'+o.id+(o.externalId?' · '+esc(o.externalId):'')+'</span></div>';
    html+='<span class="chip '+sm.cls+'" id="status-'+o.id+'">'+sm.label+'</span>';
    html+='</div>';
    html+='<div class="row" style="gap:16px;margin-bottom:8px;flex-wrap:wrap">';
    html+='<div><div class="label">Összeg</div><div class="price-sm">'+fmt(o.totalGross)+'</div></div>';
    html+='<div><div class="label">Termék</div><div class="price-sm">'+(o.itemCount||'—')+' db</div></div>';
    if(o.trackingNumber)html+='<div><div class="label">Követés</div><div class="price-sm">'+esc(o.trackingNumber)+'</div></div>';
    html+='<div><div class="label">Dátum</div><div class="price-sm">'+fmtDate(o.createdAt)+'</div></div>';
    html+='</div>';
    if(o.address)html+='<div class="muted" style="margin-bottom:8px">'+esc(o.address)+'</div>';
    if(o.status==='forwarded'){
      html+='<button class="btn btn-primary btn-sm" data-ship="'+o.id+'">✓ Kiszállítva</button>';
    }
    html+='</div>';
  }
  root.innerHTML=html;
  attachShipHandlers();
}

function attachShipHandlers(){
  document.querySelectorAll('[data-ship]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var id=parseInt(btn.dataset.ship,10);
      setLoading(btn,true);
      window.__mcpCallTool('haszno_orders_ship',{id:id,confirm:true})
        .then(function(){
          var chip=document.getElementById('status-'+id);
          if(chip){chip.className='chip chip-good';chip.textContent='Kiszállítva';}
          btn.remove();
          showMsg('ok','Rendelés #'+id+' kiszállítva');
        })
        .catch(function(e){setLoading(btn,false);showMsg('err',e.message)});
    });
  });
}

window.__render=renderOrders;
`

export const ordersHtml: string = buildHtmlPage({
  title: 'Haszno — Rendelések',
  body: '',
  script: SCRIPT,
})
