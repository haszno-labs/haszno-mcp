import { buildHtmlPage } from './base.js'

const SCRIPT = `
function esc(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function showMsg(type,text){
  var box=document.createElement('div');
  box.className=type==='ok'?'success-box':'error-box';box.textContent=text;
  document.getElementById('root').prepend(box);setTimeout(function(){box.remove()},5000);
}
function setLoading(el,v){if(el){el.disabled=v;}}

function renderRules(data){
  var root=document.getElementById('root');
  // data might be {rules:[...]} or the raw array from client.rules.list()
  var rules=data&&(data.rules||data);
  if(!Array.isArray(rules)||rules.length===0){root.innerHTML='<div class="empty">Nincs automatika konfigurálva.</div>';return;}
  var html='<div class="label" style="margin-bottom:12px">'+rules.length+' automatika</div>';
  for(var i=0;i<rules.length;i++){
    var r=rules[i];
    html+='<div class="card" id="rule-'+r.id+'">';
    html+='<div class="row-between" style="margin-bottom:6px">';
    html+='<div><h2 style="margin:0">'+esc(r.name||'—')+'</h2>';
    html+='<span class="muted">Trigger: '+esc(r.trigger||'')+(r.template?' · Sablon: '+esc(r.template):'')+'</span></div>';
    html+='<div class="row" style="gap:6px">';
    html+='<span class="chip '+(r.enabled?'chip-good':'chip-neutral')+'" id="rule-status-'+r.id+'">'+(r.enabled?'Aktív':'Szünetel')+'</span>';
    html+='<button class="btn btn-sm btn-ghost" data-toggle-rule="'+r.id+'" data-enabled="'+(r.enabled?'1':'0')+'">'+(r.enabled?'⏸ Szüneteltet':'▶ Aktivál')+'</button>';
    html+='</div></div>';
    if(r.conditions&&r.conditions.length){
      html+='<div class="label" style="margin-top:8px;margin-bottom:4px">Feltételek</div>';
      html+='<div class="col" style="gap:3px">';
      for(var j=0;j<r.conditions.length;j++){
        var c=r.conditions[j];
        html+='<div class="muted">'+esc(c.field)+' '+esc(c.op)+(c.value!=null?' '+esc(String(c.value)):'')+'</div>';
      }
      html+='</div>';
    }
    if(r.actions&&r.actions.length){
      html+='<div class="label" style="margin-top:8px;margin-bottom:4px">Műveletek</div>';
      html+='<div class="col" style="gap:3px">';
      for(var k=0;k<r.actions.length;k++){
        var a=r.actions[k];
        html+='<div class="muted">'+esc(a.type)+(a.params?' — '+esc(JSON.stringify(a.params)):'')+'</div>';
      }
      html+='</div>';
    }
    html+='</div>';
  }
  root.innerHTML=html;
  attachToggleHandlers();
}

function attachToggleHandlers(){
  document.querySelectorAll('[data-toggle-rule]').forEach(function(btn){
    btn.addEventListener('click',function(){
      var id=parseInt(btn.dataset.toggleRule,10);
      var curEnabled=btn.dataset.enabled==='1';
      var newEnabled=!curEnabled;
      setLoading(btn,true);
      window.__mcpCallTool('haszno_rules_update',{id:id,enabled:newEnabled,confirm:true})
        .then(function(){
          btn.dataset.enabled=newEnabled?'1':'0';
          btn.textContent=newEnabled?'⏸ Szüneteltet':'▶ Aktivál';
          btn.disabled=false;
          var chip=document.getElementById('rule-status-'+id);
          if(chip){chip.className='chip '+(newEnabled?'chip-good':'chip-neutral');chip.textContent=newEnabled?'Aktív':'Szünetel';}
          showMsg('ok','Automatika #'+id+(newEnabled?' aktiválva':' szüneteltetve'));
        })
        .catch(function(e){setLoading(btn,false);showMsg('err',e.message)});
    });
  });
}

window.__render=renderRules;
`

export const rulesHtml: string = buildHtmlPage({
  title: 'Haszno — Automatikák',
  body: '',
  script: SCRIPT,
})
