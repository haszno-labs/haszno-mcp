/**
 * Shared HTML primitives for MCP Apps UI bundles.
 *
 * Each domain exports a single self-contained HTML string.  At runtime the MCP
 * host fetches this via the registered `ui://haszno/<domain>` resource and
 * mounts it in a sandboxed iframe.  The host then passes the tool-call result
 * via the `ui/notifications/tool-result` postMessage notification.
 *
 * Protocol implemented here:
 *   1. On load: send `ui/initialize` to the parent frame.
 *   2. Listen for `ui/notifications/tool-result` → call the domain's `render(data)`.
 *   3. For action buttons: send `tools/call` JSON-RPC requests and wait for the
 *      matching response.
 *
 * Zero external deps — vanilla JS + inline CSS only, CSP `allow-scripts` safe.
 */

/** CSS design-system tokens that mirror the Haszno web app (index.css §Design-system tokens). */
export const HASZNO_CSS = `
:root {
  --ink:        #23262A;
  --ink-soft:   #5C636B;
  --paper:      #F6F5F2;
  --surface:    #FFFFFF;
  --line:       #E5E4DF;
  --accent:     #0f766e;
  --accent-ink: #ffffff;
  --accent-soft:#ccfbf1;
  --good:       #15803D;
  --warn:       #A16207;
  --bad:        #B42318;
  --brand-50:   #f0fdfa;
  --brand-100:  #ccfbf1;
  --brand-500:  #14b8a6;
  --brand-600:  #0d9488;
  --brand-700:  #0f766e;
  --brand-800:  #115e59;
}
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
body{font-family:Inter,system-ui,sans-serif;background:var(--paper);color:var(--ink);font-size:14px;line-height:1.5;padding:12px;min-height:100vh}
h1{font-size:16px;font-weight:700;margin-bottom:12px;color:var(--ink)}
h2{font-size:13px;font-weight:600;margin-bottom:4px;color:var(--ink)}
p{color:var(--ink-soft);font-size:13px}

/* Card */
.card{border-radius:12px;border:1px solid #E5E4DF;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.06);padding:14px 16px;margin-bottom:10px}
.card:last-child{margin-bottom:0}

/* Buttons */
.btn{display:inline-flex;align-items:center;justify-content:center;gap:6px;border-radius:8px;padding:6px 14px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:background 120ms,opacity 120ms;text-decoration:none}
.btn:disabled{opacity:.5;cursor:not-allowed}
.btn-primary{background:var(--brand-700);color:#fff}
.btn-primary:hover:not(:disabled){background:var(--brand-800)}
.btn-ghost{background:#fff;color:var(--ink);border:1px solid #E5E4DF}
.btn-ghost:hover:not(:disabled){background:var(--paper)}
.btn-danger{background:#FEF2F2;color:var(--bad);border:1px solid #FECACA}
.btn-danger:hover:not(:disabled){background:#FEE2E2}
.btn-sm{padding:4px 10px;font-size:12px}

/* Input */
.input{border-radius:8px;border:1px solid #CBD5E1;background:#fff;padding:6px 10px;font-size:13px;width:100%;outline:none;transition:border-color 120ms,box-shadow 120ms}
.input:focus{border-color:var(--brand-600);box-shadow:0 0 0 2px var(--brand-100)}

/* Status chips */
.chip{display:inline-flex;align-items:center;border-radius:9999px;padding:2px 10px;font-size:11px;font-weight:600}
.chip-good{background:color-mix(in srgb,var(--good) 10%,transparent);color:var(--good)}
.chip-bad{background:color-mix(in srgb,var(--bad) 10%,transparent);color:var(--bad)}
.chip-warn{background:color-mix(in srgb,var(--warn) 10%,transparent);color:var(--warn)}
.chip-accent{background:var(--accent-soft);color:#115e59}
.chip-neutral{background:#F1F5F9;color:#475569}

/* Layout helpers */
.row{display:flex;align-items:center;gap:8px}
.row-between{display:flex;align-items:center;justify-content:space-between;gap:8px}
.col{display:flex;flex-direction:column;gap:6px}
.muted{color:var(--ink-soft);font-size:12px}
.label{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--ink-soft)}
.price{font-size:16px;font-weight:700;font-variant-numeric:tabular-nums}
.price-sm{font-size:13px;font-weight:600;font-variant-numeric:tabular-nums}
.divider{border:none;border-top:1px solid var(--line);margin:10px 0}
.spinner{display:inline-block;width:16px;height:16px;border:2px solid var(--line);border-top-color:var(--accent);border-radius:50%;animation:spin .6s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.empty{text-align:center;padding:32px 16px;color:var(--ink-soft)}
.error-box{border-radius:8px;border:1px solid #FECACA;background:#FEF2F2;padding:12px;color:var(--bad);font-size:13px;margin-bottom:10px}
.success-box{border-radius:8px;border:1px solid #A7F3D0;background:#ECFDF5;padding:12px;color:var(--good);font-size:13px;margin-bottom:10px}
`

/** Minimal MCP Apps wire protocol (vanilla JS, no SDK dependency). */
export const MCP_APPS_PROTOCOL_JS = `
(function(){
  var JSONRPC='2.0';
  var pending={};
  var nextId=1;
  var initialized=false;
  var pendingRender=null;

  // Send ui/initialize handshake
  function init(){
    send({jsonrpc:JSONRPC,id:'mcp-init',method:'ui/initialize',params:{
      appInfo:{name:'haszno-ui',version:'1.0.0'},
      appCapabilities:{},
      protocolVersion:'2025-03-26'
    }});
  }

  function send(msg){
    try{window.parent.postMessage(msg,'*')}catch(e){}
  }

  // Public: call a server tool, returns Promise<result>
  window.__mcpCallTool=function(name,args){
    return new Promise(function(resolve,reject){
      var id=nextId++;
      pending[id]={resolve:resolve,reject:reject};
      send({jsonrpc:JSONRPC,id:id,method:'tools/call',params:{name:name,arguments:args||{}}});
    });
  };

  window.addEventListener('message',function(ev){
    var msg=ev.data;
    if(!msg||typeof msg!=='object')return;

    // init response (id='mcp-init')
    if(msg.id==='mcp-init'&&msg.result){
      initialized=true;
      if(pendingRender){var d=pendingRender;pendingRender=null;window.__render(d);}
      return;
    }

    // tool-result notification
    if(msg.method==='ui/notifications/tool-result'){
      var params=msg.params||{};
      var content=(params.content||[])[0];
      var text=content&&content.type==='text'?content.text:null;
      var data=null;
      if(text){try{data=JSON.parse(text)}catch(e){data={_raw:text}}}
      if(initialized)window.__render(data);
      else pendingRender=data;
      return;
    }

    // tool call response
    if(msg.jsonrpc===JSONRPC&&msg.id!==undefined&&(msg.result!==undefined||msg.error!==undefined)){
      var cb=pending[msg.id];
      if(cb){
        delete pending[msg.id];
        if(msg.error)cb.reject(new Error(msg.error.message||JSON.stringify(msg.error)));
        else cb.resolve(msg.result);
      }
    }
  });

  // kick off after DOM ready
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);
  else init();
})();
`

/** Wraps domain-specific HTML body/script into a full self-contained document. */
export function buildHtmlPage(opts: {
  title: string
  body: string
  script: string
}): string {
  return `<!doctype html>
<html lang="hu">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title}</title>
<style>${HASZNO_CSS}</style>
</head>
<body>
<div id="root"><div class="empty"><span class="spinner"></span></div></div>
${opts.body}
<script>
${MCP_APPS_PROTOCOL_JS}
${opts.script}
</script>
</body>
</html>`
}
