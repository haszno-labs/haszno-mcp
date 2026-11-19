import { buildHtmlPage } from './base.js'

const SCRIPT = `
function fmt(n){return n==null?'—':new Intl.NumberFormat('hu-HU').format(n)+' Ft'}
function pct(n){return n==null?'—':n.toFixed(1)+'%'}
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function showMsg(type,text){
  var box=document.createElement('div');
  box.className=type==='ok'?'success-box':'error-box';box.textContent=text;
  document.getElementById('root').prepend(box);setTimeout(function(){box.remove()},5000);
}
function setLoading(el,v){if(el){el.disabled=v;}}

function renderProducts(data){
  var root=document.getElementById('root');
  var list=data&&(data.products||data);
  if(!Array.isArray(list)||list.length===0){root.innerHTML='<div class="empty">Nincs termék.</div>';return;}
  var html='<div class="label" style="margin-bottom:12px">'+list.length+' termék</div>';
  for(var i=0;i<list.length;i++){
    var p=list[i];
    var margin=p.current&&p.current.marginPct!=null?p.current.marginPct:(p.recommended&&p.recommended.marginPct);
    var floor=p.recommended&&p.recommended.floorGross;
    var marginClass=margin!=null&&margin<5?'chip-bad':margin!=null&&margin<15?'chip-warn':'chip-accent';
    html+='<div class="card" id="prod-'+p.id+'">';
    html+='<div class="row-between" style="margin-bottom:8px">';
    html+='<div><h2 style="margin:0;max-width:220px">'+esc(p.name||'—')+'</h2>';
    html+='<span class="muted">'+esc(p.sku||'')+(p.supplierName?' · '+esc(p.supplierName):'')+'</span></div>';
    html+='<div class="row" style="gap:6px">';
    if(margin!=null)html+='<span class="chip '+marginClass+'">'+pct(margin)+'</span>';
    html+='<button class="btn btn-sm '+(p.listed?'btn-ghost':'btn-primary')+'" data-toggle="'+p.id+'" data-listed="'+(p.listed?'1':'0')+'" title="'+(p.listed?'Levesz':'Felrak')+'">'+(p.listed?'⏸ Listázott':'▶ Felrak')+'</button>';
    html+='</div></div>';
    html+='<div class="row" style="gap:16px;flex-wrap:wrap">';
    html+='<div><div class="label">Bruttó ár</div><div class="price-sm">'+fmt(p.priceGross)+'</div></div>';
    if(floor!=null)html+='<div><div class="label">Ár minimum</div><div class="price-sm">'+fmt(floor)+'</div></div>';
    if(p.costNet!=null)html+='<div><div class="label">Nettó ár</div><div class="price-sm">'+fmt(p.costNet)+'</div></div>';
    if(p.stock!=null)html+='<div><div class="label">Készlet</div><div class="price-sm">'+p.stock+' db</div></div>';
    html+='</div>';
    html+='</div>';
  }
  root.innerHTML=html;
  attachToggleHandlers();
}

function attachToggleHandlers(){
  document.querySelectorAll('[data-toggle]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var id=parseInt(btn.dataset.toggle,10);
      var curListed=btn.dataset.listed==='1';
      var newListed=!curListed;
      setLoading(btn,true);
      window.__mcpCallTool('haszno_products_set_listing',{id:id,listed:newListed,confirm:true})
        .then(function(){
          btn.dataset.listed=newListed?'1':'0';
          btn.className='btn btn-sm '+(newListed?'btn-ghost':'btn-primary');
          btn.textContent=newListed?'⏸ Listázott':'▶ Felrak';
          btn.disabled=false;
          showMsg('ok',(newListed?'Felrakva':'Levéve')+' — termék #'+id);
        })
        .catch(function(e){setLoading(btn,false);showMsg('err',e.message)});
    });
  });
}

window.__render=renderProducts;
`

export const productsHtml: string = buildHtmlPage({
  title: 'Haszno — Termékek',
  body: '',
  script: SCRIPT,
})
