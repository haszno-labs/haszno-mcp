import { buildHtmlPage } from './base.js'

const SCRIPT = `
function fmt(n){return n==null?'—':new Intl.NumberFormat('hu-HU').format(n)+' Ft'}
function fmtDiff(d){
  if(d==null)return'—';
  var abs=Math.abs(d);
  var s=new Intl.NumberFormat('hu-HU').format(abs)+' Ft';
  return d>0?'+'+s:(d<0?'-'+s:s);
}
function statusChip(s){
  var map={pending:'chip-warn',approved:'chip-good',rejected:'chip-neutral',rolled_back:'chip-neutral'};
  var label={pending:'Várakozó',approved:'Jóváhagyva',rejected:'Elutasítva',rolled_back:'Visszavonva'};
  return '<span class="chip '+(map[s]||'chip-neutral')+'">'+(label[s]||s)+'</span>';
}

function renderProposals(data){
  var root=document.getElementById('root');
  var list=data&&data.proposals;
  if(!list||list.length===0){root.innerHTML='<div class="empty">Nincs megjeleníthető javaslat.</div>';return;}
  var meta=data._meta||{};
  var html='';
  if(meta.total>0){
    html+='<div class="row-between" style="margin-bottom:12px"><span class="label">'+
      list.length+' / '+meta.total+' javaslat</span>';
    var pending=list.filter(function(p){return p.status==='pending'});
    if(pending.length>0){
      html+='<button class="btn btn-primary btn-sm" id="approve-all" data-ids="'+
        pending.map(function(p){return p.id}).join(',')+'">'
        +'Összes jóváhagyása ('+pending.length+')</button>';
    }
    html+='</div>';
  }
  for(var i=0;i<list.length;i++){
    var p=list[i];
    var diff=p.diffGross||0;
    var diffClass=diff>0?'chip-good':diff<0?'chip-bad':'chip-neutral';
    html+='<div class="card" id="prop-'+p.id+'">';
    html+='<div class="row-between" style="margin-bottom:8px">';
    html+='<div><h2 style="margin:0">'+esc(p.productName||'—')+'</h2>';
    html+='<span class="muted">'+esc(p.productSku||'')+'</span></div>';
    html+=statusChip(p.status);
    html+='</div>';
    html+='<div class="row" style="gap:16px;margin-bottom:8px">';
    html+='<div><div class="label">Jelenlegi ár</div><div class="price-sm">'+fmt(p.oldPriceGross)+'</div></div>';
    html+='<div style="color:var(--ink-soft);font-size:18px">→</div>';
    html+='<div><div class="label">Javasolt ár</div><div class="price-sm">'+fmt(p.proposedPriceGross)+'</div></div>';
    html+='<div><div class="label">Különbség</div><div class="price-sm"><span class="chip '+diffClass+'">'+fmtDiff(diff)+'</span></div></div>';
    html+='</div>';
    if(p.reason){html+='<div class="muted" style="margin-bottom:8px">'+esc(p.reason)+'</div>';}
    if(p.status==='pending'){
      html+='<div class="row">';
      html+='<button class="btn btn-primary btn-sm" data-approve="'+p.id+'">Jóváhagyás</button>';
      html+='<button class="btn btn-ghost btn-sm" data-reject="'+p.id+'">Elutasítás</button>';
      html+='</div>';
    }
    html+='</div>';
  }
  root.innerHTML=html;
  attachHandlers();
}

function esc(s){
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function setLoading(el,v){if(el){el.disabled=v;if(v)el.textContent='…';}}

function showMsg(type,text){
  var box=document.createElement('div');
  box.className=type==='ok'?'success-box':'error-box';
  box.textContent=text;
  document.getElementById('root').prepend(box);
  setTimeout(function(){box.remove()},5000);
}

function attachHandlers(){
  document.querySelectorAll('[data-approve]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var id=parseInt(btn.dataset.approve,10);
      setLoading(btn,true);
      window.__mcpCallTool('haszno_proposals_approve',{ids:[id],confirm:true})
        .then(function(r){
          var t=(r.content||[])[0];var d=t&&t.text?JSON.parse(t.text):{};
          showMsg('ok','Jóváhagyva — batchId: '+(d.batchId||'?'));
          document.getElementById('prop-'+id).querySelector('[data-approve]').closest('.row').remove();
          document.getElementById('prop-'+id).querySelector('.chip').outerHTML=
            '<span class="chip chip-good">Jóváhagyva</span>';
        })
        .catch(function(e){setLoading(btn,false);showMsg('err',e.message)});
    });
  });
  document.querySelectorAll('[data-reject]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var id=parseInt(btn.dataset.reject,10);
      setLoading(btn,true);
      window.__mcpCallTool('haszno_proposals_reject',{ids:[id],confirm:true})
        .then(function(){
          showMsg('ok','Elutasítva');
          var card=document.getElementById('prop-'+id);
          if(card){card.querySelector('.row:last-child').remove();}
        })
        .catch(function(e){setLoading(btn,false);showMsg('err',e.message)});
    });
  });
  var approveAll=document.getElementById('approve-all');
  if(approveAll){
    approveAll.addEventListener('click',function(){
      var ids=approveAll.dataset.ids.split(',').map(Number);
      setLoading(approveAll,true);
      window.__mcpCallTool('haszno_proposals_approve',{ids:ids,confirm:true})
        .then(function(r){
          var t=(r.content||[])[0];var d=t&&t.text?JSON.parse(t.text):{};
          showMsg('ok',d.applied+' javaslat jóváhagyva — batchId: '+(d.batchId||'?'));
          approveAll.remove();
          document.querySelectorAll('[data-approve]').forEach(function(b){b.closest('.row').remove();});
        })
        .catch(function(e){setLoading(approveAll,false);showMsg('err',e.message)});
    });
  }
}

window.__render=renderProposals;
`

export const proposalsHtml: string = buildHtmlPage({
  title: 'Haszno — Árajánlatok',
  body: '',
  script: SCRIPT,
})
