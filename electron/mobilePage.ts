// The one page of the phone view: plain HTML, CSS and JavaScript with no libraries, so it loads fast on any phone and needs nothing from the
// internet. It runs under a strict content security policy (electron/mobile.ts): every figure is put on the page as text, never as markup.
// The client script below uses ordinary quotes, because this whole file is one template string.

export const MOBILE_PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex">
<meta name="theme-color" content="#0F6E56">
<title>InvoiceOn</title>
<style nonce="__NONCE__">
:root{--brand:#0F6E56;--brand-tint:#E6F2EE;--ink:#1A1D1B;--muted:#636B66;--line:#E1E5E2;--canvas:#F7F8F6;--surface:#fff;--bad:#B3261E;--bad-bg:#FBEAE8;--warn:#8A5A00;--warn-bg:#FBF1DC}
@media (prefers-color-scheme:dark){:root{--brand:#3FB592;--brand-tint:#16302A;--ink:#ECEFED;--muted:#9AA39E;--line:#2A302D;--canvas:#111412;--surface:#1A1E1C;--bad:#F2908A;--bad-bg:#3A1D1B;--warn:#E8B64C;--warn-bg:#35290F}}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--canvas);color:var(--ink);font:16px/1.4 system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;padding-bottom:calc(72px + env(safe-area-inset-bottom))}
header{position:sticky;top:0;z-index:2;background:var(--brand);color:#fff;padding:14px 16px calc(10px);padding-top:calc(14px + env(safe-area-inset-top))}
header h1{margin:0;font-size:18px;font-weight:600}
header p{margin:2px 0 0;font-size:12px;opacity:.85}
main{padding:14px 16px;max-width:640px;margin:0 auto}
.card{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin-bottom:12px}
.big{font-size:30px;font-weight:600;letter-spacing:-.02em}
.label{font-size:12px;color:var(--muted)}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
.row{display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid var(--line)}
.row:last-child{border-bottom:0}
.row .name{font-weight:500;overflow-wrap:anywhere}
.row .sub{font-size:13px;color:var(--muted)}
.row .end{text-align:right;white-space:nowrap}
.pill{display:inline-block;border-radius:999px;padding:1px 9px;font-size:12px;background:var(--brand-tint);color:var(--brand)}
.pill.bad{background:var(--bad-bg);color:var(--bad)}
.pill.warn{background:var(--warn-bg);color:var(--warn)}
input[type=search]{width:100%;font:inherit;padding:12px 14px;border-radius:12px;border:1px solid var(--line);background:var(--surface);color:var(--ink);margin-bottom:12px}
nav{position:fixed;left:0;right:0;bottom:0;display:flex;background:var(--surface);border-top:1px solid var(--line);padding-bottom:env(safe-area-inset-bottom)}
nav button{flex:1;font:inherit;font-size:13px;background:none;border:0;color:var(--muted);padding:12px 4px}
nav button[aria-current=page]{color:var(--brand);font-weight:600}
.note{color:var(--muted);text-align:center;padding:24px 8px}
.error{background:var(--bad-bg);color:var(--bad);border-radius:12px;padding:12px 14px;margin-bottom:12px}
a{color:var(--brand)}
</style>
</head>
<body>
<header><h1 id="shop">InvoiceOn</h1><p id="asof">Read only</p></header>
<main id="view"><p class="note">Loading…</p></main>
<nav id="tabs">
<button data-tab="today" aria-current="page">Today</button>
<button data-tab="dues">Dues</button>
<button data-tab="stock">Stock</button>
<button data-tab="invoices">Invoices</button>
</nav>
<script nonce="__NONCE__">
(function(){
  var view=document.getElementById('view');
  var tab='today', timer=null, seq=0;
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!==undefined)e.textContent=text;return e;}
  function rs(p,d){d=d||0;return '\\u20B9'+(p/100).toLocaleString('en-IN',{minimumFractionDigits:d,maximumFractionDigits:d});}
  function plural(n,one,many){return n+' '+(n===1?one:(many||one+'s'));}
  function day(iso){if(!iso)return '';var p=iso.split('-');var m=['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];return parseInt(p[2],10)+' '+m[parseInt(p[1],10)-1]+' '+p[0];}
  function get(path){return fetch('data/'+path,{cache:'no-store'}).then(function(r){if(!r.ok)throw new Error('http '+r.status);return r.json();});}
  function show(nodes){view.replaceChildren.apply(view,nodes);}
  function fail(){show([el('div','error','Cannot reach the shop computer. Is it switched on and on the same Wi-Fi? Pull down or tap a tab to try again.')]);}
  function card(){var c=el('div','card');for(var i=0;i<arguments.length;i++)c.appendChild(arguments[i]);return c;}

  function today(){
    return get('summary').then(function(s){
      document.getElementById('shop').textContent=s.businessName||'InvoiceOn';
      document.getElementById('asof').textContent='Read only \\u00B7 '+day(s.asOf);
      var a=card(el('div','label','Sold today'),el('div','big',rs(s.today.invoicedPaise)),el('div','label',plural(s.today.invoices,'invoice')));
      var g=el('div','grid');
      g.appendChild(card(el('div','label','This month'),el('div','',rs(s.month.invoicedPaise)),el('div','label',plural(s.month.invoices,'invoice'))));
      g.appendChild(card(el('div','label','Received this month'),el('div','',rs(s.month.receivedPaise))));
      g.appendChild(card(el('div','label','To collect'),el('div','',rs(s.outstandingPaise))));
      var od=card(el('div','label','Overdue'),el('div','',rs(s.overduePaise)),el('div','label',plural(s.overdueCount,'invoice')));
      g.appendChild(od);
      var st=card(el('div','label','Stock'),el('div','',plural(s.unitsInStock,'piece')),el('div','label',s.lowStockDesigns+' low, '+s.outOfStockDesigns+' out'));
      show([a,g,st]);
    });
  }
  function dues(){
    return get('dues').then(function(rows){
      if(!rows.length)return show([el('p','note','Nobody owes you anything.')]);
      var c=el('div','card');
      rows.forEach(function(r){
        var row=el('div','row'),left=el('div'),end=el('div','end');
        left.appendChild(el('div','name',r.name));
        var sub=plural(r.openInvoices,'open invoice');
        if(r.overduePaise>0)sub+=' \\u00B7 '+rs(r.overduePaise)+' overdue since '+day(r.oldestDueDate);
        left.appendChild(el('div','sub',sub));
        var phone=(r.phone||'').replace(/[^0-9+]/g,'');
        if(phone){var a=el('a','sub','Call '+phone);a.href='tel:'+phone;left.appendChild(a);}
        end.appendChild(el('div','name',rs(r.outstandingPaise)));
        row.appendChild(left);row.appendChild(end);c.appendChild(row);
      });
      show([c]);
    });
  }
  function stock(){
    var box=el('input');box.type='search';box.placeholder='Search by design, colour or SKU';box.setAttribute('aria-label','Search stock');
    var list=el('div');
    var t=null;
    function run(){
      var mine=++seq;
      get('stock?q='+encodeURIComponent(box.value.trim())).then(function(rows){
        if(mine!==seq)return;
        if(!rows.length){list.replaceChildren(el('p','note','Nothing matches.'));return;}
        var c=el('div','card');
        rows.forEach(function(v){
          var row=el('div','row'),left=el('div'),end=el('div','end');
          left.appendChild(el('div','name',v.designName));
          left.appendChild(el('div','sub',[v.color,v.size,v.sku].filter(Boolean).join(' \\u00B7 ')));
          var pill=el('span','pill'+(v.stock===0?' bad':''),v.stock===0?'Out':plural(v.stock,'piece'));
          end.appendChild(el('div','name',rs(v.sellPricePaise)));
          end.appendChild(pill);
          row.appendChild(left);row.appendChild(end);c.appendChild(row);
        });
        list.replaceChildren(c);
      }).catch(fail);
    }
    box.addEventListener('input',function(){clearTimeout(t);t=setTimeout(run,200);});
    show([box,list]);
    run();
    return Promise.resolve();
  }
  function invoices(){
    return get('invoices').then(function(rows){
      if(!rows.length)return show([el('p','note','No invoices yet.')]);
      var c=el('div','card');
      rows.forEach(function(i){
        var row=el('div','row'),left=el('div'),end=el('div','end');
        left.appendChild(el('div','name',i.number));
        left.appendChild(el('div','sub',i.buyerName+' \\u00B7 '+day(i.issueDate)));
        end.appendChild(el('div','name',rs(i.totalPaise)));
        var label={paid:'Paid',unpaid:'Unpaid',partial:'Part paid',overdue:'Overdue',cancelled:'Cancelled'}[i.status]||i.status;
        end.appendChild(el('span','pill'+(i.status==='overdue'||i.status==='cancelled'?' bad':i.status==='paid'?'':' warn'),label));
        row.appendChild(left);row.appendChild(end);c.appendChild(row);
      });
      show([c]);
    });
  }
  var pages={today:today,dues:dues,stock:stock,invoices:invoices};
  function go(name){
    tab=name;
    Array.prototype.forEach.call(document.querySelectorAll('#tabs button'),function(b){if(b.getAttribute('data-tab')===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});
    seq++;
    pages[name]().catch(fail);
  }
  document.getElementById('tabs').addEventListener('click',function(e){var t=e.target.closest('button');if(t)go(t.getAttribute('data-tab'));});
  timer=setInterval(function(){if(!document.hidden&&tab!=='stock')go(tab);},60000);
  document.addEventListener('visibilitychange',function(){if(!document.hidden&&tab!=='stock')go(tab);});
  go('today');
})();
</script>
</body>
</html>
`;
