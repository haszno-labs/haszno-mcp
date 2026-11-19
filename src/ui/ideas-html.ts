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
function setLoading(el,v){if(el){el.disabled=v;if(v)el.textContent='…';}}

function renderIdeas(data){
  var root=document.getElementById('root');
  // Handle both shortlist (data.picks) and list (data.items)
  var picks=data&&data.picks;
  if(picks){renderShortlist(data,root);return;}
  var items=data&&data.items;
  if(items){renderList(data,root);return;}
  root.innerHTML='<div class="empty">Nincs megjeleníthető termékötlet.</div>';
}

function renderShortlist(data,root){
  var picks=data.picks||[];
  if(picks.length===0){root.innerHTML='<div class="empty">Nincs AI-javasolt termék.</div>';return;}
  var html='';
  if(data.summary){html+='<div class="card" style="background:var(--accent-soft);border-color:#99f6e4"><p style="color:#115e59">'+esc(data.summary)+'</p>';
    if(data.cached)html+='<span class="muted">Gyorsítótárból (24 ó)</span>';
    html+='</div>';}
  for(var i=0;i<picks.length;i++){
    var p=picks[i];
    html+='<div class="card" id="pick-'+(p.productId||p.networkProductId||i)+'">';
    html+='<div class="row-between" style="margin-bottom:8px">';
    html+='<div><h2 style="margin:0">'+esc(p.name||'—')+'</h2>';
    html+='<span class="muted">'+esc(p.supplier||'')+'</span></div>';
    if(p.fit!=null)html+='<span class="chip chip-accent">'+p.fit+'/100</span>';
    html+='</div>';
    if(p.aiReason)html+='<div class="muted" style="margin-bottom:8px">'+esc(p.aiReason)+'</div>';
    html+='<div class="row" style="gap:16px;margin-bottom:10px">';
    html+='<div><div class="label">Ajánlott ár</div><div class="price-sm">'+fmt(p.recommendedPriceGross_HUF)+'</div></div>';
    if(p.marginPct!=null)html+='<div><div class="label">Haszonkulcs</div><div class="price-sm">'+pct(p.marginPct)+'</div></div>';
    if(p.marginNet_HUF!=null)html+='<div><div class="label">Nettó nyereség</div><div class="price-sm">'+fmt(p.marginNet_HUF)+'</div></div>';
    html+='</div>';
    if(p.networkProductId!=null){
      html+='<button class="btn btn-primary btn-sm" data-add-network="'+p.networkProductId+'">+ Importlistára</button>';
    }
    html+='</div>';
  }
  root.innerHTML=html;
  attachAddHandlers();
}

function renderList(data,root){
  var items=data.items||[];
  if(items.length===0){root.innerHTML='<div class="empty">Nincs termékötlet.</div>';return;}
  var html='<div class="label" style="margin-bottom:12px">'+items.length+(data.truncated?' (csonkított)':'')+' ötlet</div>';
  for(var i=0;i<items.length;i++){
    var item=items[i];
    html+='<div class="card">';
    html+='<div class="row-between" style="margin-bottom:6px">';
    html+='<div><h2 style="margin:0">#'+item.rank+' '+esc(item.name||'—')+'</h2>';
    html+='<span class="muted">'+esc(item.supplier||'')+'</span></div>';
    if(item.trendScore!=null)html+='<span class="chip chip-accent">Trend: '+item.trendScore+'</span>';
    html+='</div>';
    html+='<div class="row" style="gap:16px;flex-wrap:wrap">';
    html+='<div><div class="label">Ajánlott ár</div><div class="price-sm">'+fmt(item.suggestedPriceGross_HUF)+'</div></div>';
    if(item.marginPct!=null)html+='<div><div class="label">Marzs</div><div class="price-sm">'+pct(item.marginPct)+'</div></div>';
    if(item.stock!=null)html+='<div><div class="label">Készlet</div><div class="price-sm">'+item.stock+' db</div></div>';
    html+='</div></div>';
  }
  root.innerHTML=html;
}

function attachAddHandlers(){
  document.querySelectorAll('[data-add-network]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var networkId=parseInt(btn.dataset.addNetwork,10);
      setLoading(btn,true);
      window.__mcpCallTool('haszno_catalogue_import_list_add',{networkProductIds:[networkId]})
        .then(function(){showMsg('ok','Hozzáadva az importlistához');btn.textContent='✓ Hozzáadva';btn.disabled=true;})
        .catch(function(e){setLoading(btn,false);showMsg('err',e.message)});
    });
  });
}

window.__render=renderIdeas;
`

export const ideasHtml: string = buildHtmlPage({
  title: 'Haszno — Termékötletek',
  body: '',
  script: SCRIPT,
})
