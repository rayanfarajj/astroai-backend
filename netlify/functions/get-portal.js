<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<!-- PORTAL-VERSION: RESOURCES-v2 -->
<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">
<meta name="mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<meta name="apple-mobile-web-app-title" content="My Portal">
<meta name="theme-color" content="#0a0e1a">
<link rel="manifest" href="/client-portal-manifest.json">
<link rel="apple-touch-icon" href="/icons/portal-icon-192.png">
<title>Client Portal — Astro AI</title>
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
:root {
  --bg:        #0a0e1a;
  --surface:   #111827;
  --surface-2: #1a2235;
  --surface-3: #1f2d42;
  --border:    rgba(255,255,255,.07);
  --border-2:  rgba(255,255,255,.12);
  --teal:      #00d9a3;
  --teal-dim:  rgba(0,217,163,.12);
  --teal-glow: rgba(0,217,163,.25);
  --orange:    #f97316;
  --orange-dim:rgba(249,115,22,.12);
  --red:       #ef4444;
  --blue:      #3b82f6;
  --text:      #e2e8f0;
  --text-dim:  #8892a4;
  --text-muted:#4a5568;
  --font:      'Plus Jakarta Sans', sans-serif;
  --mono:      'JetBrains Mono', monospace;
  --sidebar-w: 240px;
  --radius:    10px;
}
*{margin:0;padding:0;box-sizing:border-box;}
html{scroll-behavior:smooth;}
body{font-family:var(--font);background:var(--bg);color:var(--text);min-height:100vh;display:flex;font-size:14px;line-height:1.5;}

/* LOADING */
#loading{position:fixed;inset:0;background:var(--bg);display:flex;flex-direction:column;align-items:center;justify-content:center;z-index:9999;transition:opacity .5s .2s;}
#loading.out{opacity:0;pointer-events:none;}
.load-logo{display:flex;align-items:center;gap:10px;margin-bottom:32px;}
.load-logo-icon{width:40px;height:40px;background:var(--teal);border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.2rem;box-shadow:0 0 20px var(--teal-glow);}
.load-logo-text{font-size:1.2rem;font-weight:800;color:var(--text);letter-spacing:-.02em;}
.load-logo-text span{color:var(--teal);}
.load-track{width:180px;height:2px;background:var(--surface-2);border-radius:2px;overflow:hidden;}
.load-bar{height:100%;background:var(--teal);border-radius:2px;animation:loadslide 1.4s ease-in-out infinite;}
@keyframes loadslide{0%{width:0%;transform:translateX(0)}60%{width:70%}100%{width:100%;transform:translateX(100%)}}

/* SIDEBAR */
.sidebar{width:var(--sidebar-w);background:var(--surface);border-right:1px solid var(--border);min-height:100vh;position:fixed;top:0;left:0;display:flex;flex-direction:column;z-index:200;transition:transform .25s cubic-bezier(.4,0,.2,1);}
.sb-top{padding:20px 16px 16px;border-bottom:1px solid var(--border);}
.sb-brand{display:flex;align-items:center;gap:10px;margin-bottom:16px;text-decoration:none;}
.sb-brand-icon{width:32px;height:32px;background:var(--teal);border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:.9rem;flex-shrink:0;box-shadow:0 0 12px var(--teal-glow);}
.sb-brand-name{font-weight:800;font-size:.92rem;color:var(--text);letter-spacing:-.02em;}
.sb-brand-sub{font-size:.62rem;color:var(--text-muted);font-weight:400;}
.sb-client{background:var(--surface-2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;}
.sb-client-name{font-weight:700;font-size:.82rem;color:var(--text);line-height:1.3;}
.sb-client-biz{font-size:.72rem;color:var(--text-dim);margin-top:2px;}

.sb-nav{flex:1;padding:12px 8px;overflow-y:auto;}
.sb-section{font-size:.6rem;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:var(--text-muted);padding:12px 8px 6px;}
.nav-item{display:flex;align-items:center;gap:9px;padding:8px 10px;border-radius:7px;cursor:pointer;color:var(--text-dim);font-size:.82rem;font-weight:500;transition:all .15s;margin-bottom:1px;background:none;border:none;width:100%;text-align:left;font-family:var(--font);}
.nav-item:hover{background:var(--surface-2);color:var(--text);}
.nav-item.active{background:var(--teal-dim);color:var(--teal);border:1px solid rgba(0,217,163,.2);}
.nav-icon{font-size:.9rem;width:18px;text-align:center;flex-shrink:0;}
.nav-badge{margin-left:auto;background:var(--orange);color:#fff;font-size:.58rem;font-weight:700;padding:2px 6px;border-radius:20px;}

.sb-foot{padding:12px 16px;border-top:1px solid var(--border);}
.sb-status{display:flex;align-items:center;gap:7px;font-size:.75rem;color:var(--text-dim);}
.dot{width:7px;height:7px;border-radius:50%;background:var(--teal);box-shadow:0 0 6px var(--teal);animation:blink 2s ease-in-out infinite;flex-shrink:0;}
@keyframes blink{0%,100%{opacity:1}50%{opacity:.3}}

/* OVERLAY */
.overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:150;backdrop-filter:blur(2px);}
.overlay.on{display:block;}

/* MAIN */
.main{margin-left:var(--sidebar-w);flex:1;display:flex;flex-direction:column;min-width:0;}

/* TOPBAR */
.topbar{height:52px;border-bottom:1px solid var(--border);background:var(--surface);display:flex;align-items:center;justify-content:space-between;padding:0 24px;position:sticky;top:0;z-index:100;}
.topbar-left{display:flex;align-items:center;gap:12px;}
.hamburger{display:none;background:none;border:none;color:var(--text-dim);font-size:1.1rem;cursor:pointer;padding:4px;}
.topbar-title{font-weight:700;font-size:.88rem;color:var(--text);}
.topbar-biz{font-size:.75rem;color:var(--text-muted);font-family:var(--mono);}

/* CONTENT */
.content{flex:1;padding:28px;max-width:860px;}
.section{display:none;animation:fadeup .2s ease both;}
.section.active{display:block;}
@keyframes fadeup{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}

/* PAGE HEADER */
.page-hd{margin-bottom:24px;}
.page-hd h1{font-size:1.3rem;font-weight:800;color:var(--text);letter-spacing:-.02em;margin-bottom:3px;}
.page-hd p{font-size:.82rem;color:var(--text-dim);line-height:1.6;}

/* CARDS */
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);margin-bottom:16px;overflow:hidden;}
.card-hd{padding:14px 18px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
.card-hd-left{display:flex;align-items:center;gap:8px;}
.card-icon{font-size:.9rem;}
.card-title{font-size:.82rem;font-weight:700;color:var(--text);}
.card-body{padding:18px;}

/* HERO */
.hero{background:linear-gradient(135deg,var(--surface) 0%,var(--surface-2) 100%);border:1px solid var(--border);border-radius:var(--radius);padding:24px;margin-bottom:16px;position:relative;overflow:hidden;}
.hero::after{content:'';position:absolute;top:-60px;right:-60px;width:200px;height:200px;background:radial-gradient(circle,var(--teal-glow) 0%,transparent 70%);pointer-events:none;}
.hero-biz{font-size:1.4rem;font-weight:800;color:var(--text);letter-spacing:-.03em;margin-bottom:4px;}
.hero-greet{font-size:.8rem;color:var(--text-dim);margin-bottom:18px;}
.hero-badge{display:inline-flex;align-items:center;gap:7px;background:var(--teal-dim);border:1px solid rgba(0,217,163,.25);border-radius:20px;padding:5px 12px;font-size:.75rem;font-weight:600;color:var(--teal);}
.hero-updated{font-size:.7rem;color:var(--text-muted);margin-top:10px;font-family:var(--mono);}

/* STATS */
.stats{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;}
.stat{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;}
.stat-n{font-size:1.5rem;font-weight:800;color:var(--text);letter-spacing:-.03em;font-family:var(--mono);}
.stat-l{font-size:.68rem;color:var(--text-muted);margin-top:2px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;}

/* TIMELINE */
.tl{padding:2px 0;}
.tl-row{display:flex;gap:12px;padding:8px 0;position:relative;}
.tl-row:not(:last-child)::before{content:'';position:absolute;left:13px;top:34px;width:1px;height:calc(100% - 10px);background:var(--border);}
.tl-row.done::before{background:var(--teal);opacity:.4;}
.tl-dot{width:28px;height:28px;border-radius:50%;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700;z-index:1;border:1px solid var(--border);background:var(--surface-2);}
.tl-row.done .tl-dot{background:var(--teal-dim);border-color:rgba(0,217,163,.4);color:var(--teal);}
.tl-row.current .tl-dot{background:rgba(59,130,246,.15);border-color:rgba(59,130,246,.4);box-shadow:0 0 0 3px rgba(59,130,246,.1);}
.tl-info{flex:1;padding-top:4px;}
.tl-label{font-size:.82rem;font-weight:600;color:var(--text);}
.tl-row.pending .tl-label{color:var(--text-muted);}
.tl-desc{font-size:.73rem;color:var(--text-dim);margin-top:1px;line-height:1.5;}

/* INFO TABLE */
.info-table{width:100%;border-collapse:collapse;}
.info-table tr{border-bottom:1px solid var(--border);}
.info-table tr:last-child{border:none;}
.info-table td{padding:10px 0;font-size:.82rem;}
.info-table td:first-child{color:var(--text-muted);width:140px;font-size:.72rem;text-transform:uppercase;letter-spacing:.05em;font-weight:600;}
.info-table td:last-child{color:var(--text);font-weight:500;}

/* OFFER BANNER */
.offer{background:linear-gradient(135deg,rgba(249,115,22,.15),rgba(249,115,22,.05));border:1px solid rgba(249,115,22,.25);border-radius:var(--radius);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:16px;flex-wrap:wrap;}
.offer-tag{font-size:.6rem;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--orange);margin-bottom:4px;}
.offer-title{font-size:.95rem;font-weight:700;color:var(--text);margin-bottom:3px;}
.offer-desc{font-size:.78rem;color:var(--text-dim);line-height:1.5;}
.offer-exp{font-size:.68rem;color:var(--text-muted);margin-top:4px;font-family:var(--mono);}
.offer-btn{background:var(--orange);color:#fff;border:none;border-radius:7px;padding:9px 18px;font-size:.8rem;font-weight:700;cursor:pointer;white-space:nowrap;font-family:var(--font);text-decoration:none;display:inline-block;transition:opacity .15s;flex-shrink:0;}
.offer-btn:hover{opacity:.85;}
/* Billing */
.bill-summary{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden;margin-bottom:14px;}
.bill-summary-hdr{padding:14px 18px;background:var(--surface-2);border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;}
.bill-summary-title{font-size:.78rem;font-weight:700;color:var(--text);}
.bill-summary-badge{font-size:.6rem;font-weight:700;padding:2px 8px;border-radius:10px;background:var(--teal-dim);color:var(--teal);border:1px solid rgba(0,217,163,.2);}
.bill-row{display:flex;align-items:center;justify-content:space-between;padding:11px 18px;border-bottom:1px solid var(--border);gap:12px;}
.bill-row:last-child{border-bottom:none;}
.bill-row-desc{font-size:.82rem;color:var(--text);flex:1;}
.bill-row-freq{font-size:.65rem;color:var(--text-muted);font-family:var(--mono);padding:2px 7px;background:var(--surface-2);border-radius:10px;white-space:nowrap;}
.bill-row-amt{font-family:var(--display);font-size:.9rem;font-weight:700;color:var(--text);white-space:nowrap;}
.bill-footer{padding:14px 18px;background:var(--teal-dim);display:flex;align-items:center;justify-content:space-between;border-top:2px solid rgba(0,217,163,.2);}
.bill-footer-lbl{font-size:.68rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);}
.bill-footer-amt{font-family:var(--display);font-size:1.15rem;font-weight:800;color:var(--teal);}
.bill-notes-box{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);padding:16px 18px;margin-bottom:14px;}
.bill-notes-lbl{font-size:.6rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--text-muted);margin-bottom:8px;}
.bill-notes-text{font-size:.8rem;color:var(--text-dim);line-height:1.7;white-space:pre-wrap;}
.bill-pay-btn{display:inline-flex;align-items:center;gap:8px;padding:11px 22px;background:var(--teal);color:#07090f;border:none;border-radius:8px;font-family:var(--display);font-size:.85rem;font-weight:700;cursor:pointer;text-decoration:none;transition:all .2s;box-shadow:0 4px 14px var(--teal-glow);}
.bill-pay-btn:hover{background:#00ffbf;transform:translateY(-1px);}
.bill-row-date{font-size:.68rem;color:var(--text-muted);font-family:var(--mono);margin-top:2px}
.pstat{display:inline-flex;align-items:center;gap:5px;padding:3px 9px;border-radius:20px;font-size:.63rem;font-weight:700;white-space:nowrap;flex-shrink:0}
.pstat-paid{background:rgba(16,185,129,.12);color:#34d399;border:1px solid rgba(16,185,129,.2)}
.pstat-pending{background:var(--gold-dim);color:var(--gold);border:1px solid rgba(245,158,11,.2)}
.pstat-late{background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.2)}
.pstat-cancelled{background:rgba(255,255,255,.05);color:var(--text-muted);border:1px solid var(--border)}

/* PLATFORM TABS — redesigned */
.ptabs{display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap;}
.ptab{display:flex;align-items:center;gap:6px;padding:7px 14px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);font-size:.76rem;font-weight:600;cursor:pointer;color:var(--text-dim);transition:all .18s;font-family:var(--font);}
.ptab:hover{background:var(--surface-3);color:var(--text);}
.ptab.active{background:color-mix(in srgb, var(--plat-color, var(--teal)) 12%, transparent);border-color:color-mix(in srgb, var(--plat-color, var(--teal)) 40%, transparent);color:var(--text);}
.ptab-pane{display:none;}
.ptab-pane.active{display:block;}
.acc-panel-hd{display:flex;align-items:center;gap:12px;padding:14px 16px;border-radius:10px;border:1px solid;margin-bottom:14px;}
.acc-panel-icon{font-size:1.6rem;line-height:1;}
.acc-panel-title{font-size:.95rem;font-weight:800;color:var(--text);margin-bottom:2px;}
.acc-panel-sub{font-size:.72rem;color:var(--text-muted);}
.acc-subtabs{display:flex;gap:6px;margin-bottom:14px;}
.acc-subtab{flex:1;padding:8px 10px;border-radius:8px;border:1px solid var(--border);background:var(--surface-2);font-size:.75rem;font-weight:600;cursor:pointer;color:var(--text-dim);transition:all .15s;font-family:var(--font);text-align:center;}
.acc-subtab:hover{background:var(--surface-3);}
.acc-subtab.active{background:var(--teal-dim);border-color:rgba(0,217,163,.3);color:var(--teal);}
.acc-subpane{display:none;}
.acc-subpane.active{display:block;}
.acc-new-banner{display:flex;gap:10px;align-items:flex-start;background:rgba(249,115,22,.07);border:1px solid rgba(249,115,22,.2);border-radius:8px;padding:10px 14px;font-size:.78rem;color:#fdba74;line-height:1.5;margin-bottom:12px;}
.acc-new-banner span{font-size:1.2rem;flex-shrink:0;margin-top:1px;}
.acc-steps{list-style:none;margin:0;padding:0;}
.acc-step{display:flex;gap:10px;align-items:flex-start;padding:10px 0;border-bottom:1px solid var(--border);font-size:.8rem;color:var(--text-dim);line-height:1.6;}
.acc-step:last-child{border:none;}
.acc-step-n{min-width:24px;height:24px;border-radius:50%;border:1px solid;display:flex;align-items:center;justify-content:center;font-size:.65rem;font-weight:800;flex-shrink:0;margin-top:1px;}
.acc-step-txt a{color:var(--teal);text-decoration:none;}
.acc-step-txt a:hover{text-decoration:underline;}
.acc-step-txt strong{color:var(--text);}
.acc-note-bar{background:rgba(249,115,22,.07);border:1px solid rgba(249,115,22,.2);border-radius:8px;padding:10px 14px;font-size:.74rem;color:#fdba74;margin-top:14px;line-height:1.5;}

/* FORMS */
.fgrp{margin-bottom:12px;}
.flabel{font-size:.72rem;font-weight:600;color:var(--text-dim);margin-bottom:5px;display:block;text-transform:uppercase;letter-spacing:.05em;}
.finput{width:100%;padding:9px 12px;border:1px solid var(--border-2);border-radius:7px;font-size:.82rem;font-family:var(--font);color:var(--text);background:var(--surface-2);outline:none;transition:border-color .15s;}
.finput:focus{border-color:var(--teal);}
textarea.finput{resize:vertical;line-height:1.6;}
.frow{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.fhint{font-size:.68rem;color:var(--text-muted);margin-top:4px;}
.btn-primary{width:100%;padding:10px;background:var(--teal);color:#0a0e1a;border:none;border-radius:7px;font-size:.84rem;font-weight:700;cursor:pointer;font-family:var(--font);transition:opacity .15s;margin-top:4px;}
.btn-primary:hover{opacity:.85;}
.btn-primary:disabled{opacity:.45;cursor:not-allowed;}
.btn-navy{display:flex;align-items:center;justify-content:center;gap:7px;width:100%;padding:10px;background:var(--surface-3);color:var(--text);border:1px solid var(--border-2);border-radius:7px;font-size:.82rem;font-weight:600;cursor:pointer;font-family:var(--font);text-decoration:none;transition:background .15s;margin-top:12px;}
.btn-navy:hover{background:var(--surface-2);}

/* REFERRAL */
.ref-hero{background:linear-gradient(135deg,var(--surface-2),var(--surface-3));border:1px solid var(--border);border-radius:var(--radius);padding:16px 20px;display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;}
.ref-n{font-size:2rem;font-weight:800;color:var(--teal);font-family:var(--mono);letter-spacing:-.04em;}
.ref-l{font-size:.68rem;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;}
.perks{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px;}
.perk{background:var(--teal-dim);border:1px solid rgba(0,217,163,.2);color:var(--teal);border-radius:20px;padding:4px 10px;font-size:.72rem;font-weight:600;}

/* FILES */
.upload-zone{border:1.5px dashed var(--border-2);border-radius:var(--radius);padding:32px 20px;text-align:center;cursor:pointer;transition:all .2s;background:var(--surface-2);position:relative;}
.upload-zone:hover,.upload-zone.over{border-color:var(--teal);background:rgba(0,217,163,.04);}
.upload-input{position:absolute;inset:0;opacity:0;cursor:pointer;width:100%;}
.upload-icon{font-size:2rem;margin-bottom:8px;}
.upload-t{font-size:.88rem;font-weight:700;color:var(--text);margin-bottom:3px;}
.upload-h{font-size:.76rem;color:var(--text-muted);}
.upload-chips{display:flex;gap:5px;justify-content:center;flex-wrap:wrap;margin-top:10px;}
.uchip{background:var(--surface-3);color:var(--text-muted);border-radius:5px;padding:2px 7px;font-size:.65rem;font-weight:600;font-family:var(--mono);}
.flist{margin-top:12px;display:flex;flex-direction:column;gap:6px;}
.fitem{display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface-2);border:1px solid var(--border);border-radius:8px;}
.fitem-icon{font-size:1.1rem;flex-shrink:0;}
.fitem-info{flex:1;min-width:0;}
.fitem-name{font-size:.8rem;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.fitem-meta{font-size:.68rem;color:var(--text-muted);margin-top:1px;font-family:var(--mono);}
.fitem-st{font-size:.7rem;font-weight:700;flex-shrink:0;}
.fitem-st.uploading{color:var(--orange);}
.fitem-st.done{color:var(--teal);}
.fitem-st.error{color:var(--red);}
.dl-link{font-size:.72rem;font-weight:600;color:var(--teal);text-decoration:none;flex-shrink:0;padding:4px 8px;border:1px solid rgba(0,217,163,.25);border-radius:5px;transition:all .15s;}
.dl-link:hover{background:var(--teal-dim);}

/* SUCCESS */
.success-box{background:rgba(0,217,163,.07);border:1px solid rgba(0,217,163,.2);border-radius:8px;padding:16px;text-align:center;display:none;transition:all .3s;}
.success-box.on{display:block;}
.success-box h3{color:var(--teal);font-size:.88rem;margin-bottom:4px;}
.success-box p{color:var(--text-dim);font-size:.78rem;}

/* TOAST */
.toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%) translateY(8px);background:var(--surface-3);border:1px solid var(--border-2);color:var(--text);padding:10px 18px;border-radius:8px;font-size:.78rem;font-weight:500;opacity:0;transition:all .2s;z-index:9999;pointer-events:none;white-space:nowrap;box-shadow:0 8px 24px rgba(0,0,0,.4);}
.toast.on{opacity:1;transform:translateX(-50%) translateY(0);}

/* MOBILE */
@media(max-width:768px){
  .sidebar{transform:translateX(-100%);}
  .sidebar.open{transform:none;}
  .main{margin-left:0;}
  .hamburger{display:flex;}
  .topbar{padding:0 16px;}
  .content{padding:16px; padding-bottom:80px;}
  .frow{grid-template-columns:1fr;}
  .stats{grid-template-columns:1fr 1fr;}
}
@media(max-width:480px){
  .stats{grid-template-columns:1fr;}
  .offer{flex-direction:column;align-items:flex-start;}
}

/* ── Bottom Tab Bar (mobile only) ── */
.bottom-tabs {
  display: none;
}
@media(max-width:768px){
  .bottom-tabs {
    display: flex;
    position: fixed;
    bottom: 0; left: 0; right: 0;
    background: #111827;
    border-top: 1px solid rgba(255,255,255,.08);
    padding: 8px 0;
    padding-bottom: calc(8px + env(safe-area-inset-bottom));
    z-index: 300;
    justify-content: space-around;
    align-items: flex-end;
  }
  .tab-btn {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 3px;
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px 10px;
    min-width: 56px;
    font-family: var(--font);
    -webkit-tap-highlight-color: transparent;
  }
  .tab-icon {
    font-size: 1.3rem;
    line-height: 1;
    transition: transform .15s;
  }
  .tab-label {
    font-size: .57rem;
    font-weight: 600;
    color: #4a5568;
    letter-spacing: .02em;
    text-transform: uppercase;
    transition: color .15s;
  }
  .tab-btn.active .tab-icon { transform: scale(1.15); }
  .tab-btn.active .tab-label { color: #00d9a3; }
  /* Hide hamburger on mobile — use bottom tabs instead */
  .hamburger { display: none !important; }
}

/* ── PWA / iPhone safe area ── */
@supports(padding: env(safe-area-inset-top)) {
  .topbar {
    padding-left: max(16px, env(safe-area-inset-left));
    padding-right: max(16px, env(safe-area-inset-right));
  }
  .sidebar {
    padding-top: env(safe-area-inset-top);
  }
  body {
    padding-bottom: env(safe-area-inset-bottom);
  }
}
/* Standalone: add top padding for status bar */
@media all and (display-mode: standalone) {
  /* Push topbar below iPhone status bar in standalone/PWA mode */
  .topbar {
    height: calc(52px + env(safe-area-inset-top));
    padding-top: env(safe-area-inset-top);
    padding-left: max(16px, env(safe-area-inset-left));
    padding-right: max(16px, env(safe-area-inset-right));
  }
  .main { padding-top: 0; }
  .sidebar {
    padding-top: env(safe-area-inset-top);
    box-shadow: 2px 0 20px rgba(0,0,0,.5);
  }
  /* Bottom safe area for home bar */
  .sb-foot { padding-bottom: calc(12px + env(safe-area-inset-bottom)); }
}
/* No rubber-band scroll */
html, body { overscroll-behavior: none; }

/* ── Install banner ── */
#pwa-banner {
  display: none;
  position: fixed;
  bottom: 0; left: 0; right: 0;
  background: #111827;
  border-top: 1px solid rgba(0,217,163,.3);
  padding: 14px 20px;
  padding-bottom: calc(14px + env(safe-area-inset-bottom));
  z-index: 9998;
  align-items: center;
  gap: 12px;
  animation: slideup .3s ease;
}
#pwa-banner.show { display: flex; }
@keyframes slideup { from { transform: translateY(100%); } to { transform: translateY(0); } }
.pwa-banner-icon { font-size: 1.8rem; flex-shrink: 0; }
.pwa-banner-text { flex: 1; }
.pwa-banner-title { font-size: .85rem; font-weight: 700; color: #e2e8f0; margin-bottom: 2px; }
.pwa-banner-sub { font-size: .72rem; color: #8892a4; line-height: 1.4; }
.pwa-banner-btn {
  background: #00d9a3; color: #0a0e1a;
  border: none; border-radius: 8px;
  padding: 9px 16px; font-size: .78rem; font-weight: 700;
  cursor: pointer; white-space: nowrap; font-family: inherit;
  flex-shrink: 0;
}
.pwa-banner-close {
  background: none; border: none; color: #4a5568;
  font-size: 1.1rem; cursor: pointer; padding: 4px; flex-shrink: 0;
}

/* ── Push notification permission bar ── */
#notif-bar {
  display: none;
  background: rgba(0,217,163,.08);
  border-bottom: 1px solid rgba(0,217,163,.15);
  padding: 10px 20px;
  align-items: center;
  gap: 10px;
  font-size: .78rem;
}
#notif-bar.show { display: flex; }
.notif-bar-text { flex: 1; color: #8892a4; }
.notif-bar-text strong { color: #e2e8f0; }
.notif-bar-btn {
  background: #00d9a3; color: #0a0e1a;
  border: none; border-radius: 6px;
  padding: 6px 12px; font-size: .74rem; font-weight: 700;
  cursor: pointer; font-family: inherit; flex-shrink: 0;
}
.notif-bar-dismiss {
  background: none; border: none; color: #4a5568;
  cursor: pointer; font-size: .9rem; flex-shrink: 0;
}
</style>
</head>
<body>

<!-- PWA Install Banner (iOS) -->
<div id="pwa-banner">
  <div class="pwa-banner-icon">📱</div>
  <div class="pwa-banner-text">
    <div class="pwa-banner-title">Add to Home Screen</div>
    <div class="pwa-banner-sub">Install your portal for instant access, offline support, and notifications.</div>
  </div>
  <button class="pwa-banner-btn" onclick="showInstallInstructions()">Install</button>
  <button class="pwa-banner-close" onclick="dismissBanner()">✕</button>
</div>

<!-- Push Notification Permission Bar -->
<div id="notif-bar">
  <span class="notif-bar-text" id="notif-bar-text">🔔 <strong>Stay updated</strong> — get notified when your plan is ready.</span>
  <button class="notif-bar-btn" id="notif-bar-btn" onclick="requestNotifPermission()">Enable</button>
  <button class="notif-bar-dismiss" onclick="dismissNotifBar()">✕</button>
</div>

<div id="loading">
  <div class="load-logo">
    <div class="load-logo-icon">🚀</div>
    <div class="load-logo-text">Astro <span>AI</span></div>
  </div>
  <div class="load-track"><div class="load-bar"></div></div>
</div>

<div class="overlay" id="overlay" onclick="closeSB()"></div>

<aside class="sidebar" id="sidebar">
  <div class="sb-top">
    <a class="sb-brand" href="#">
      <div class="sb-brand-icon">🚀</div>
      <div>
        <div class="sb-brand-name">Astro AI</div>
        <div class="sb-brand-sub">Client Portal</div>
      </div>
    </a>
    <div class="sb-client">
      <div class="sb-client-name" id="sb-name">—</div>
      <div class="sb-client-biz" id="sb-biz">Loading...</div>
    </div>
  </div>

  <nav class="sb-nav">
    <div class="sb-section">Overview</div>
    <button class="nav-item active" onclick="go('s-overview',this)"><span class="nav-icon">▣</span> Dashboard</button>
    <button class="nav-item" onclick="go('s-plan',this)"><span class="nav-icon">◈</span> My Plan</button>

    <div class="sb-section">Campaign</div>
    <button class="nav-item" onclick="go('s-access',this)"><span class="nav-icon">◉</span> Ad Account Access</button>
    <button class="nav-item" onclick="go('s-files',this);loadFiles()"><span class="nav-icon">◫</span> Files & Documents</button>
    <button class="nav-item" id="nav-billing" onclick="go('s-billing',this)"><span class="nav-icon">◰</span> Billing</button>

    <div class="sb-section">Connect</div>
    <button class="nav-item" onclick="go('s-resources',this)"><span class="nav-icon">◐</span> Resources</button>
    <button class="nav-item" onclick="go('s-refer',this)"><span class="nav-icon">◎</span> Refer a Friend</button>
    <button class="nav-item" onclick="go('s-message',this)"><span class="nav-icon">◷</span> Message Us</button>
  </nav>

  <div class="sb-foot">
    <div class="sb-status"><div class="dot"></div><span id="sb-status">Loading...</span></div>
    <button id="install-app-btn" onclick="showInstallInstructions()" style="display:none;margin-top:10px;width:100%;padding:8px 10px;background:var(--teal-dim);border:1px solid rgba(0,217,163,.25);border-radius:7px;color:var(--teal);font-size:.75rem;font-weight:700;cursor:pointer;font-family:var(--font);">
      📱 Install App
    </button>
  </div>
</aside>

<div class="main">
  <header class="topbar">
    <div class="topbar-left">
      <button class="hamburger" onclick="openSB()">☰</button>
      <span class="topbar-title" id="tb-title">Dashboard</span>
    </div>
    <span class="topbar-biz" id="tb-biz"></span>
  </header>

  <div class="content">

    <!-- OVERVIEW -->
    <div class="section active" id="s-overview">
      <div id="offer-wrap"></div>

      <!-- Notification enable card — only shown when not yet subscribed -->
      <div id="notif-card" style="display:none;background:linear-gradient(135deg,rgba(0,217,163,.08),rgba(0,217,163,.03));border:1px solid rgba(0,217,163,.25);border-radius:10px;padding:14px 18px;margin-bottom:16px;align-items:center;gap:14px;flex-wrap:wrap;">
        <div style="font-size:1.4rem;flex-shrink:0">🔔</div>
        <div style="flex:1;min-width:180px">
          <div style="font-weight:700;font-size:.85rem;color:#e2e8f0;margin-bottom:2px">Get notified instantly</div>
          <div style="font-size:.75rem;color:#8892a4;line-height:1.4">Get alerts when your plan is ready or your agency has updates — even when the app is closed.</div>
        </div>
        <button id="notif-enable-btn" onclick="requestNotifPermission()" style="background:#00d9a3;color:#0a0e1a;border:none;border-radius:8px;padding:9px 18px;font-size:.8rem;font-weight:700;cursor:pointer;font-family:inherit;white-space:nowrap;flex-shrink:0">Enable Notifications</button>
      </div>

      <div class="hero" id="hero">
        <div class="hero-biz" id="h-biz">—</div>
        <div class="hero-greet" id="h-greet"></div>
        <div class="hero-badge"><div class="dot"></div><span id="h-status">—</span></div>
        <div class="hero-updated" id="h-updated"></div>
      </div>
      <div class="stats">
        <div class="stat"><div class="stat-n" id="st-refs">0</div><div class="stat-l">Referrals</div></div>
        <div class="stat"><div class="stat-n" id="st-files">0</div><div class="stat-l">Files Uploaded</div></div>
        <div class="stat"><div class="stat-n" id="st-days">—</div><div class="stat-l">Days Active</div></div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-hd-left"><span class="card-icon">◈</span><span class="card-title">Campaign Progress</span></div></div>
        <div class="card-body"><div class="tl" id="tl"></div></div>
      </div>
    </div>

    <!-- PLAN -->
    <div class="section" id="s-plan">
      <div class="page-hd"><h1>My Marketing Plan</h1><p>Your campaign strategy and business profile.</p></div>

      <!-- View Plan CTA -->
      <div id="plan-cta-wrap" style="display:none;margin-bottom:16px">
        <a id="plan-link" href="#" target="_blank" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:16px 20px;background:linear-gradient(135deg,rgba(0,217,163,.12),rgba(0,217,163,.06));border:1px solid rgba(0,217,163,.3);border-radius:12px;text-decoration:none;transition:all .2s" onmouseover="this.style.background='linear-gradient(135deg,rgba(0,217,163,.18),rgba(0,217,163,.1))'" onmouseout="this.style.background='linear-gradient(135deg,rgba(0,217,163,.12),rgba(0,217,163,.06))'">
          <div>
            <div style="font-size:.9rem;font-weight:800;color:var(--teal);margin-bottom:2px">📈 View Full Marketing Plan</div>
            <div style="font-size:.73rem;color:var(--text-muted)">Your AI-generated strategy, ad angles, roadmap & more</div>
          </div>
          <span style="color:var(--teal);font-size:1.2rem">→</span>
        </a>
      </div>

      <!-- Business Profile -->
      <div class="card" style="margin-bottom:14px">
        <div class="card-hd">
          <div class="card-hd-left"><span class="card-icon">🏢</span><span class="card-title">Business Profile</span></div>
        </div>
        <div class="card-body" style="padding:0" id="plan-biz-wrap"></div>
      </div>

      <!-- Campaign Details -->
      <div class="card" style="margin-bottom:14px">
        <div class="card-hd">
          <div class="card-hd-left"><span class="card-icon">🎯</span><span class="card-title">Campaign Details</span></div>
        </div>
        <div class="card-body" style="padding:0" id="plan-campaign-wrap"></div>
      </div>

      <!-- Status -->
      <div class="card" id="plan-status-card" style="margin-bottom:14px;display:none">
        <div class="card-hd">
          <div class="card-hd-left"><span class="card-icon">📊</span><span class="card-title">Campaign Status</span></div>
        </div>
        <div class="card-body" style="padding:0" id="plan-status-wrap"></div>
      </div>
    </div>

    <!-- ACCESS -->
    <div class="section" id="s-access">
      <div class="page-hd"><h1>Ad Account Access</h1><p>Grant us access to launch your campaigns.</p></div>
      <div class="card">
        <div class="card-body">
          <div class="ptabs" id="ptabs"></div>
          <div id="ptab-panes"></div>
        </div>
      </div>
    </div>

    <!-- FILES -->
    <div class="section" id="s-files">
      <div class="page-hd"><h1>Files & Documents</h1><p>Upload logos, contracts, photos, or any assets for your campaign.</p></div>
      <div class="card">
        <div class="card-hd"><div class="card-hd-left"><span class="card-icon">↑</span><span class="card-title">Upload Files</span></div></div>
        <div class="card-body">
          <div class="upload-zone" id="uz">
            <input type="file" class="upload-input" id="file-in" multiple accept="image/*,.pdf,.doc,.docx,.xls,.xlsx,.zip,.mp4,.mov">
            <div class="upload-icon">📂</div>
            <div class="upload-t">Drop files here or click to browse</div>
            <div class="upload-h">Max 10MB per file</div>
            <div class="upload-chips">
              <span class="uchip">PDF</span><span class="uchip">PNG</span><span class="uchip">JPG</span>
              <span class="uchip">DOCX</span><span class="uchip">MP4</span><span class="uchip">ZIP</span>
            </div>
          </div>
          <div class="flist" id="up-list"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-hd-left"><span class="card-icon">◫</span><span class="card-title">Uploaded Files</span></div></div>
        <div class="card-body">
          <div class="flist" id="ex-files"><span style="color:var(--text-muted);font-size:.8rem">Loading...</span></div>
        </div>
      </div>
    </div>

    <!-- BILLING -->
    <div class="section" id="s-billing">
      <div class="page-hd"><h1>Billing</h1><p>Your current plan, payment details, and billing history.</p></div>
      <div id="billing-content"></div>
    </div>

    <!-- REFER -->
    <div class="section" id="s-resources">
      <div class="page-hd"><h1>Resources</h1><p>Everything you need to connect with your agency team.</p></div>
      <div id="resources-content">
        <!-- Populated by buildResources() after init() -->
      </div>
    </div>

    <div class="section" id="s-refer">
      <div class="page-hd"><h1>Refer a Friend</h1><p id="ref-page-sub">Know a business that could use great marketing? Send them our way!</p></div>
      <div class="ref-hero">
        <div><div class="ref-l">Referrals Sent</div><div class="ref-n" id="ref-n">0</div></div>
        <div style="font-size:2.5rem">🏆</div>
      </div>
      <div class="card" id="ref-bonus-card" style="display:none">
        <div class="card-body" style="padding:16px 20px">
          <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--teal);margin-bottom:6px">🎁 Referral Bonus</div>
          <div id="ref-bonus-text" style="font-size:.9rem;font-weight:600;color:var(--text);line-height:1.5"></div>
        </div>
      </div>
      <div class="card" id="ref-resources-card" style="display:none">
        <div class="card-hd"><div class="card-hd-left"><span class="card-icon">◎</span><span class="card-title">Resources</span></div></div>
        <div class="card-body">
          <div id="ref-resources-text" style="font-size:.82rem;color:var(--text-dim);line-height:1.8;white-space:pre-wrap"></div>
        </div>
      </div>
      <div class="card">
        <div class="card-hd"><div class="card-hd-left"><span class="card-icon">◎</span><span class="card-title">Send a Referral</span></div></div>
        <div class="card-body">
          <div class="perks">
            <span class="perk" id="perk-bonus">🚀 Fast onboarding</span>
            <span class="perk">❤️ Help a friend grow</span>
          </div>
          <div class="success-box" id="ref-ok" style="margin-bottom:14px"><h3>🎉 Referral Submitted!</h3><p>We'll reach out to them right away. You can submit another referral below.</p></div>
          <div id="ref-form">
            <div class="frow">
              <div class="fgrp"><label class="flabel">Their Name</label><input class="finput" id="rn" type="text" placeholder="Jane Smith"></div>
              <div class="fgrp"><label class="flabel">Their Business</label><input class="finput" id="rb" type="text" placeholder="Smith Co."></div>
            </div>
            <div class="frow">
              <div class="fgrp"><label class="flabel">Email *</label><input class="finput" id="re" type="email" placeholder="jane@business.com"></div>
              <div class="fgrp"><label class="flabel">Phone</label><input class="finput" id="rp" type="tel" placeholder="(512) 555-0000"></div>
            </div>
            <div class="fgrp">
              <label class="flabel">Quick Note</label>
              <input class="finput" id="rnote" type="text" placeholder="They need more leads for their roofing company...">
              <div class="fhint">Helps us personalize their outreach.</div>
            </div>
            <button class="btn-primary" id="ref-btn">Submit Referral</button>
          </div>
        </div>
      </div>
    </div>

    <!-- MESSAGE -->
    <div class="section" id="s-message">
      <div class="page-hd"><h1>Message Us</h1><p>Have a question? Send us a message and we'll follow up fast.</p></div>
      <div class="card">
        <div class="card-hd"><div class="card-hd-left"><span class="card-icon">◷</span><span class="card-title">Send a Message</span></div></div>
        <div class="card-body">
          <div id="msg-form">
            <div class="fgrp"><label class="flabel">Subject</label><input class="finput" id="ms" type="text" placeholder="Question about my campaign..."></div>
            <div class="fgrp"><label class="flabel">Message *</label><textarea class="finput" id="mb" rows="5" placeholder="Type your message here..."></textarea></div>
            <button class="btn-primary" id="msg-btn">Send Message</button>
          </div>
          <div class="success-box" id="msg-ok"><h3>✅ Message Sent!</h3><p>We've received your message and will follow up soon.</p></div>
        </div>
      </div>
    </div>

  </div>
</div>

<div class="toast" id="toast"></div>

<!-- Bottom Tab Bar (mobile / PWA) -->
<nav class="bottom-tabs" id="bottom-tabs">
  <button class="tab-btn active" id="tab-overview" onclick="tabGo('s-overview',this)">
    <span class="tab-icon">▣</span>
    <span class="tab-label">Home</span>
  </button>
  <button class="tab-btn" id="tab-plan" onclick="tabGo('s-plan',this)">
    <span class="tab-icon">◈</span>
    <span class="tab-label">My Plan</span>
  </button>
  <button class="tab-btn" id="tab-files" onclick="tabGo('s-files',this);loadFiles()">
    <span class="tab-icon">◫</span>
    <span class="tab-label">Files</span>
  </button>
  <button class="tab-btn" id="tab-message" onclick="tabGo('s-message',this)">
    <span class="tab-icon">◷</span>
    <span class="tab-label">Message</span>
  </button>
  <button class="tab-btn" id="tab-more" onclick="openSB()">
    <span class="tab-icon">☰</span>
    <span class="tab-label">More</span>
  </button>
</nav>

<script>
const API  = 'https://marketingplan.astroaibots.com/api';
const _urlp = new URLSearchParams(location.search);
const slug = _urlp.get('s') || _urlp.get('slug') || '';
const _agencyId = _urlp.get('a') || '';
let C = null;
let _sessionRefCount = -1; // -1 means not yet set; once set, never decremented

const TITLES = {'s-overview':'Dashboard','s-plan':'My Plan','s-access':'Ad Account Access','s-files':'Files & Documents','s-billing':'Billing','s-resources':'Resources','s-refer':'Refer a Friend','s-message':'Message Us'};
const STEPS  = [
  {label:'Onboarding Complete',  desc:'Your info has been received and your plan is being prepared.', icon:'✓'},
  {label:'Marketing Plan Ready', desc:'Your AI strategy, ad copy, and targeting plan are finalized.', icon:'◈'},
  {label:'Campaign Live',        desc:'Your ads are running across your selected platforms.',          icon:'▶'},
  {label:'Campaign Complete',    desc:'Campaign wrapped up. Ready to scale? Let\'s talk!',            icon:'★'},
];
// ── Ad Account Platforms ─────────────────────────────────────────
// Each platform: label, icon, agencyIdField (filled at runtime), existingSteps, newSteps, note
const PLAT_DEFS = {
  meta: {
    label: 'Meta / Facebook',
    icon: '📘',
    color: '#1877f2',
    idLabel: 'Partner Business ID',
    idField: 'metaBusinessId',
    existing: [
      'Go to <a href="https://business.facebook.com" target="_blank" rel="noopener">business.facebook.com</a> and log in.',
      'Click the grid icon (⊞) in the top left → select your <strong>Business Account</strong>.',
      'Go to <strong>Settings → Users → Partners</strong>.',
      'Click <strong>"Add Partner"</strong> → enter our Partner Business ID: <span class="bid-placeholder" data-field="metaBusinessId">your agency will provide this</span>',
      'Under your Ad Account, grant <strong>Manage Campaigns</strong> access.',
      'Click <strong>Save</strong> — we\'ll begin setup within 24 hours. 🎉',
    ],
    newAcct: [
      'Go to <a href="https://business.facebook.com" target="_blank" rel="noopener">business.facebook.com</a> → click <strong>"Create Account"</strong>.',
      'Enter your business name, your name, and your work email → click <strong>Next</strong>.',
      'Fill in your business details and click <strong>Submit</strong>.',
      'Inside Business Manager, click <strong>Accounts → Ad Accounts → Add → Create a New Ad Account</strong>.',
      'Name it, set your time zone and currency → click <strong>Next</strong>.',
      '⚠️ <strong>Add a payment method</strong>: go to <strong>Billing → Payment Settings → Add Payment Method</strong> (credit card or PayPal).',
      'Now follow the <em>I already have an account</em> steps above to grant us access.',
    ],
    note: 'A Business Manager account is required to run ads. Personal Facebook accounts cannot run campaigns.',
  },
  google: {
    label: 'Google Ads',
    icon: '🎯',
    color: '#4285f4',
    idLabel: 'Manager Account ID',
    idField: 'googleManagerId',
    existing: [
      'Sign in to <a href="https://ads.google.com" target="_blank" rel="noopener">ads.google.com</a> with the Google account linked to your Ads account.',
      'Click the <strong>⚙️ Settings</strong> icon (top right) → <strong>Setup → Access and security</strong>.',
      'Click the <strong>Managers</strong> tab → click the <strong>+</strong> button.',
      'Enter our Manager Account ID: <span class="bid-placeholder" data-field="googleManagerId">your agency will provide this</span>',
      'Click <strong>Send Request</strong> — we\'ll accept and begin setup within 24 hours. 🎉',
    ],
    newAcct: [
      'Go to <a href="https://ads.google.com" target="_blank" rel="noopener">ads.google.com</a> → click <strong>"Start now"</strong>.',
      'Sign in with your Google account (or create one at google.com).',
      'Google will try to guide you through a "Smart Campaign" — click <strong>"Switch to Expert Mode"</strong> at the bottom to skip.',
      'Click <strong>"Create an account without a campaign"</strong>.',
      'Confirm your billing country, time zone, and currency → click <strong>Submit</strong>.',
      '⚠️ <strong>Add a payment method</strong>: go to <strong>Tools → Billing → Summary → Add payment method</strong>.',
      'Now follow the <em>I already have an account</em> steps above to grant us access.',
    ],
    note: 'Use the same Google account you want linked to your ads. You can change billing settings at any time.',
  },
  tiktok: {
    label: 'TikTok Ads',
    icon: '🎵',
    color: '#fe2c55',
    idLabel: 'Agency Account ID',
    idField: 'tiktokAgencyId',
    existing: [
      'Go to <a href="https://ads.tiktok.com" target="_blank" rel="noopener">ads.tiktok.com</a> and log in.',
      'Click your <strong>account name</strong> (top right) → <strong>Account Settings</strong>.',
      'Go to <strong>User Management → Users → Assign Role</strong>.',
      'Enter our agency email: <span class="bid-placeholder" data-field="tiktokAgencyId">your agency will provide this</span>',
      'Assign the <strong>Operator</strong> role → click <strong>Confirm</strong>.',
      'We\'ll begin setup within 24 hours. 🎉',
    ],
    newAcct: [
      'Go to <a href="https://ads.tiktok.com" target="_blank" rel="noopener">ads.tiktok.com</a> → click <strong>"Get started"</strong>.',
      'Sign up with your email or log in with an existing TikTok account.',
      'Select your <strong>country</strong>, enter your <strong>business name</strong>, and set your <strong>currency</strong>.',
      'Complete email verification → click <strong>Register</strong>.',
      '⚠️ <strong>Add a payment method</strong>: go to <strong>Billing → Payment → Add Payment Method</strong>.',
      'Your account must be a <strong>Business account</strong> to run ads.',
      'Now follow the <em>I already have an account</em> steps above to grant us access.',
    ],
    note: 'TikTok Ads require a Business Center account. Personal TikTok accounts cannot run ads.',
  },
  linkedin: {
    label: 'LinkedIn Ads',
    icon: '💼',
    color: '#0a66c2',
    idLabel: 'Agency Account ID',
    idField: 'linkedinAgencyId',
    existing: [
      'Go to <a href="https://www.linkedin.com/campaignmanager" target="_blank" rel="noopener">Campaign Manager</a> and log in.',
      'Select your <strong>Ad Account</strong> from the list.',
      'Click <strong>Account Settings</strong> (top right gear icon).',
      'Go to <strong>Manage Access → Users</strong> → click <strong>"Add User"</strong>.',
      'Enter our agency email: <span class="bid-placeholder" data-field="linkedinAgencyId">your agency will provide this</span>',
      'Set role to <strong>Campaign Manager</strong> → click <strong>Save</strong>. 🎉',
    ],
    newAcct: [
      'Go to <a href="https://www.linkedin.com/campaignmanager" target="_blank" rel="noopener">linkedin.com/campaignmanager</a>.',
      'Click <strong>"Create Account"</strong> — you\'ll need a LinkedIn personal profile first.',
      'Enter your <strong>Account Name</strong> (your business name) and select your <strong>currency</strong>.',
      'Associate a <strong>LinkedIn Page</strong> for your business (create one free at linkedin.com/company/setup/new/).',
      '⚠️ <strong>Add a payment method</strong>: go to <strong>Billing Center → Add a Payment Method</strong>.',
      'Now follow the <em>I already have an account</em> steps above to grant us access.',
    ],
    note: 'LinkedIn Ads work best for B2B. You need a LinkedIn Company Page before running ads.',
  },
  wordpress: {
    label: 'WordPress',
    icon: '🌐',
    color: '#21759b',
    idLabel: 'WordPress Site URL',
    idField: 'wordpressSiteUrl',
    existing: [
      'Log in to your WordPress dashboard at <strong>yoursite.com/wp-admin</strong>.',
      'Go to <strong>Users → Add New</strong>.',
      'Enter our agency email: <span class="bid-placeholder" data-field="wordpressSiteUrl">your agency will provide this</span>',
      'Set the <strong>Role</strong> to <strong>Administrator</strong>.',
      'Click <strong>"Add New User"</strong> — we\'ll receive an email invitation. 🎉',
    ],
    newAcct: [
      'Go to <a href="https://wordpress.com" target="_blank" rel="noopener">wordpress.com</a> → click <strong>"Start your website"</strong>.',
      'Enter your email, username, and password → click <strong>Create Account</strong>.',
      'Choose a <strong>domain name</strong> (or use a free .wordpress.com subdomain to start).',
      'Select a <strong>plan</strong> — the Business plan is needed for plugins and custom themes.',
      '⚠️ <strong>Add a payment method</strong> if you choose a paid plan: enter your card details at checkout.',
      'Once your site is live, follow the <em>I already have an account</em> steps above.',
    ],
    note: 'For best results give us Administrator access. This lets us install plugins, manage SEO, and build landing pages.',
  },
};

function copyBid(id) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(id).then(() => toast('✅ Copied!')).catch(() => toast('Copy: ' + id));
  } else { toast('ID: ' + id); }
}

function copyBid(id) {
  if (navigator.clipboard) {
    navigator.clipboard.writeText(id).then(() => toast('✅ Copied!')).catch(() => toast('Copy: ' + id));
  } else {
    toast('ID: ' + id);
  }
}
function toast(m,d=3000){const t=document.getElementById('toast');t.textContent=m;t.classList.add('on');setTimeout(()=>t.classList.remove('on'),d);}
function statusStep(s){return{new:0,active:1,launched:2,paused:2,completed:3}[s]??0;}
function fmtBytes(b){b=parseInt(b)||0;if(b<1024)return b+' B';if(b<1048576)return(b/1024).toFixed(1)+' KB';return(b/1048576).toFixed(1)+' MB';}
function fIcon(n){const e=(n||'').split('.').pop().toLowerCase();if(['jpg','jpeg','png','gif','webp'].includes(e))return'🖼️';if(e==='pdf')return'📄';if(['doc','docx'].includes(e))return'📝';if(['xls','xlsx'].includes(e))return'📊';if(['mp4','mov','avi'].includes(e))return'🎬';if(e==='zip')return'📦';return'📎';}

function go(id, btn) {
  document.querySelectorAll('.section').forEach(s=>s.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n=>n.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  if(btn) btn.classList.add('active');
  document.getElementById('tb-title').textContent = TITLES[id]||'';
  closeSB();
}
function tabGo(id, btn) {
  go(id, null);
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
  if (btn) btn.classList.add('active');
}
function openSB(){document.getElementById('sidebar').classList.add('open');document.getElementById('overlay').classList.add('on');}
function closeSB(){document.getElementById('sidebar').classList.remove('open');document.getElementById('overlay').classList.remove('on');}

function buildTL(status) {
  const cur = statusStep(status);
  return STEPS.map((s,i)=>{
    const state = i<cur?'done':i===cur?'current':'pending';
    return `<div class="tl-row ${state}">
      <div class="tl-dot">${i<cur?'✓':s.icon}</div>
      <div class="tl-info"><div class="tl-label">${s.label}</div><div class="tl-desc">${s.desc}</div></div>
    </div>`;
  }).join('');
}

function buildPlatforms(adPlatforms, agencyIds) {
  // Always show all 5 platforms
  const allKeys = ['meta','google','tiktok','linkedin','wordpress'];
  const wrap = document.getElementById('ptab-panes');
  const tabBar = document.getElementById('ptabs');

  // Build platform selector tabs
  tabBar.innerHTML = allKeys.map((k,i) => {
    const pl = PLAT_DEFS[k];
    return `<button class="ptab ${i===0?'active':''}" onclick="switchPT('${k}',this)" style="--plat-color:${pl.color}">
      <span>${pl.icon}</span><span>${pl.label}</span>
    </button>`;
  }).join('');

  // Build each platform panel
  wrap.innerHTML = allKeys.map((k,i) => {
    const pl = PLAT_DEFS[k];
    const agencyVal = agencyIds[pl.idField] || '';

    const renderSteps = (steps) => steps.map((s,si) => {
      // Replace bid-placeholder with actual value if available
      let html = s;
      if (agencyVal && s.includes('bid-placeholder')) {
        const display = `<span style="font-family:monospace;background:var(--surface-3);border:1px solid var(--border-2);padding:2px 10px;border-radius:6px;color:var(--teal);font-weight:700">${agencyVal}</span> <button onclick="copyBid('${agencyVal}')" style="background:var(--teal-dim);border:1px solid rgba(0,217,163,.3);color:var(--teal);border-radius:6px;padding:2px 10px;font-size:.72rem;font-weight:700;cursor:pointer;font-family:var(--font);margin-left:4px">📋 Copy</button>`;
        html = s.replace(/<span class="bid-placeholder"[^>]*>[^<]*<\/span>/, display);
      } else if (!agencyVal && s.includes('bid-placeholder')) {
        html = s.replace(/<span class="bid-placeholder"[^>]*>[^<]*<\/span>/, '<em style="color:var(--text-muted)">Contact your agency for this ID</em>');
      }
      return `<li class="acc-step"><div class="acc-step-n" style="background:${pl.color}20;border-color:${pl.color}40;color:${pl.color}">${si+1}</div><div class="acc-step-txt">${html}</div></li>`;
    }).join('');

    return `<div class="ptab-pane ${i===0?'active':''}" id="ptp-${k}">
      <div class="acc-panel-hd" style="border-color:${pl.color}30;background:${pl.color}08">
        <span class="acc-panel-icon">${pl.icon}</span>
        <div>
          <div class="acc-panel-title">${pl.label} Access</div>
          <div class="acc-panel-sub">Follow the steps below to connect your account</div>
        </div>
      </div>
      <div class="acc-subtabs">
        <button class="acc-subtab active" onclick="switchSubtab('${k}','existing',this)">✅ I have an account</button>
        <button class="acc-subtab" onclick="switchSubtab('${k}','new',this)">🆕 I need an account</button>
      </div>
      <div class="acc-subpane active" id="acc-${k}-existing">
        <ul class="acc-steps">${renderSteps(pl.existing)}</ul>
      </div>
      <div class="acc-subpane" id="acc-${k}-new">
        <div class="acc-new-banner">
          <span>🚀</span>
          <div><strong>Creating a new ${pl.label} account?</strong> Follow these steps to get set up, then come back here to grant us access.</div>
        </div>
        <ul class="acc-steps">${renderSteps(pl.newAcct)}</ul>
      </div>
      <div class="acc-note-bar">💡 ${pl.note}</div>
    </div>`;
  }).join('');
}

function switchPT(key, btn) {
  document.querySelectorAll('.ptab').forEach(t=>t.classList.remove('active'));
  document.querySelectorAll('.ptab-pane').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('ptp-'+key)?.classList.add('active');
}

function switchSubtab(platKey, tab, btn) {
  const panel = document.getElementById('ptp-'+platKey);
  panel.querySelectorAll('.acc-subtab').forEach(t=>t.classList.remove('active'));
  panel.querySelectorAll('.acc-subpane').forEach(p=>p.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById(`acc-${platKey}-${tab}`)?.classList.add('active');
}

async function uploadFile(file) {
  if(file.size>10*1024*1024){toast('❌ File too large (max 10MB)');return;}
  const id='up-'+Date.now()+Math.random().toString(36).slice(2);
  document.getElementById('up-list').insertAdjacentHTML('beforeend',`
    <div class="fitem" id="${id}">
      <div class="fitem-icon">${fIcon(file.name)}</div>
      <div class="fitem-info"><div class="fitem-name">${file.name}</div><div class="fitem-meta">${fmtBytes(file.size)}</div></div>
      <div class="fitem-st uploading" id="${id}-s">⏳ Uploading...</div>
    </div>`);
  const reader=new FileReader();
  reader.onload=async(e)=>{
    const b64=e.target.result.split(',')[1];
    try{
      const res=await fetch(API+'/upload-file',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug,fileName:file.name,fileBase64:b64,fileType:file.type,fileSize:file.size})});
      const data=await res.json();
      if(data.success){
        document.getElementById(id+'-s').textContent='✅ Saved';
        document.getElementById(id+'-s').className='fitem-st done';
        const sf=document.getElementById('st-files');sf.textContent=parseInt(sf.textContent||'0')+1;
        loadFiles();
      } else {
        document.getElementById(id+'-s').textContent='❌ '+(data.error||'Failed');
        document.getElementById(id+'-s').className='fitem-st error';
      }
    }catch(err){
      document.getElementById(id+'-s').textContent='❌ '+err.message;
      document.getElementById(id+'-s').className='fitem-st error';
    }
  };
  reader.readAsDataURL(file);
}

async function loadFiles() {
  const el=document.getElementById('ex-files');
  el.innerHTML='<span style="color:var(--text-muted);font-size:.8rem">Loading...</span>';
  try{
    const res=await fetch(`${API}/list-files?slug=${encodeURIComponent(slug)}`);
    const data=await res.json();
    if(!data.files||!data.files.length){el.innerHTML='<span style="color:var(--text-muted);font-size:.8rem">No files uploaded yet.</span>';return;}
    document.getElementById('st-files').textContent=data.files.length;
    el.innerHTML=data.files.map(f=>`
      <div class="fitem">
        <div class="fitem-icon">${fIcon(f.name)}</div>
        <div class="fitem-info"><div class="fitem-name">${f.name}</div><div class="fitem-meta">${fmtBytes(f.size)} · ${f.uploadedAt?new Date(f.uploadedAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):''}</div></div>
        ${f.url?`<a class="dl-link" href="${f.url}" target="_blank">↓ Download</a>`:''}
      </div>`).join('');
  }catch(e){el.innerHTML=`<span style="color:var(--text-muted);font-size:.8rem">Could not load files.</span>`;}
}

document.getElementById('file-in').addEventListener('change',e=>{[...e.target.files].forEach(uploadFile);e.target.value='';});
const uz=document.getElementById('uz');
uz.addEventListener('dragover',e=>{e.preventDefault();uz.classList.add('over');});
uz.addEventListener('dragleave',()=>uz.classList.remove('over'));
uz.addEventListener('drop',e=>{e.preventDefault();uz.classList.remove('over');[...e.dataTransfer.files].forEach(uploadFile);});

document.getElementById('ref-btn').addEventListener('click',async()=>{
  if(!C)return;
  const btn=document.getElementById('ref-btn');
  const email=document.getElementById('re').value.trim();
  if(!email){toast('❌ Please enter their email');return;}
  btn.disabled=true;btn.textContent='Submitting...';
  try{
    const res=await fetch(API+'/submit-referral',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({referrerSlug:slug,agencyId:_agencyId,referrerName:C.clientName,referrerBusiness:C.businessName,refereeName:document.getElementById('rn').value.trim(),refereeBusinessName:document.getElementById('rb').value.trim(),refereeEmail:email,refereePhone:document.getElementById('rp').value.trim(),refereeNote:document.getElementById('rnote').value.trim()})});
    const data=await res.json();
    if(data.success){
      // Increment count permanently in DOM
      // Increment session count — this persists even if page re-fetches from Firestore
      _sessionRefCount = (_sessionRefCount < 0 ? 0 : _sessionRefCount) + 1;
      document.getElementById('ref-n').textContent = _sessionRefCount;
      const sr = document.getElementById('st-refs');
      if(sr) sr.textContent = _sessionRefCount;
      if(C) C.referralCount = String(_sessionRefCount);
      // Show success banner temporarily
      const ok=document.getElementById('ref-ok');
      ok.classList.add('on');
      // Reset all form fields so they can submit another referral
      document.getElementById('rn').value='';
      document.getElementById('rb').value='';
      document.getElementById('re').value='';
      document.getElementById('rp').value='';
      document.getElementById('rnote').value='';
      // Hide success banner after 4 seconds — form stays visible
      setTimeout(()=>ok.classList.remove('on'), 4000);
    }else toast('❌ '+(data.error||'Failed'));
  }catch(e){toast('❌ '+e.message);}
  finally{btn.disabled=false;btn.textContent='Submit Referral';}
});

document.getElementById('msg-btn').addEventListener('click',async()=>{
  if(!C)return;
  const btn=document.getElementById('msg-btn');
  const body=document.getElementById('mb').value.trim();
  if(!body){toast('❌ Please enter a message');return;}
  btn.disabled=true;btn.textContent='Sending...';
  try{
    const res=await fetch(API+'/send-message',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({slug,clientName:C.clientName,businessName:C.businessName,clientEmail:C.clientEmail,subject:document.getElementById('ms').value.trim(),message:body})});
    const data=await res.json();
    if(data.success){document.getElementById('msg-form').style.display='none';document.getElementById('msg-ok').classList.add('on');}
    else toast('❌ '+(data.error||'Failed'));
  }catch(e){toast('❌ '+e.message);}
  finally{btn.disabled=false;btn.textContent='Send Message';}
});

function buildResources(data) {
  const wrap = document.getElementById('resources-content');
  if (!wrap) return;

  const { bookingUrl, supportPhone, supportEmail, agencyWebsite, customLinks } = data;
  const hasAny = bookingUrl || supportPhone || supportEmail || agencyWebsite || customLinks;

  if (!hasAny) {
    wrap.innerHTML = '<div style="text-align:center;padding:48px 20px;color:var(--text-muted);font-size:.85rem">Your agency has not added resources yet.</div>';
    return;
  }

  let html = '';

  // ── Booking / Scheduling ──
  if (bookingUrl) {
    const url = bookingUrl.startsWith('http') ? bookingUrl : 'https://' + bookingUrl;
    html += `
    <div class="card" style="margin-bottom:14px">
      <div class="card-hd">
        <div class="card-hd-left"><span class="card-icon">📅</span><span class="card-title">Schedule a Call</span></div>
      </div>
      <div class="card-body" style="padding:16px 18px">
        <p style="font-size:.82rem;color:var(--text-dim);margin-bottom:12px;line-height:1.6">Book a time to speak with your agency team about your campaign.</p>
        <a href="${url}" target="_blank" rel="noopener" style="display:inline-flex;align-items:center;gap:7px;background:var(--teal);color:#0a0e1a;padding:9px 20px;border-radius:8px;font-weight:700;font-size:.84rem;text-decoration:none;transition:opacity .15s" onmouseover="this.style.opacity='.85'" onmouseout="this.style.opacity='1'">📅 Book Now</a>
      </div>
    </div>`;
  }

  // ── Contact ──
  if (supportPhone || supportEmail || agencyWebsite) {
    html += `<div class="card" style="margin-bottom:14px"><div class="card-hd"><div class="card-hd-left"><span class="card-icon">📞</span><span class="card-title">Contact Your Agency</span></div></div><div class="card-body" style="padding:0">`;

    if (supportPhone) {
      html += `<a href="tel:${supportPhone}" style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border);text-decoration:none;transition:background .15s" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
        <div style="width:34px;height:34px;border-radius:8px;background:rgba(59,130,246,.12);border:1px solid rgba(59,130,246,.2);display:flex;align-items:center;justify-content:center;font-size:.9rem;flex-shrink:0">📞</div>
        <div><div style="font-size:.82rem;font-weight:600;color:var(--text)">${supportPhone}</div><div style="font-size:.72rem;color:var(--text-muted)">Tap to call</div></div>
      </a>`;
    }

    if (supportEmail) {
      html += `<a href="mailto:${supportEmail}" style="display:flex;align-items:center;gap:12px;padding:14px 18px;border-bottom:1px solid var(--border);text-decoration:none;transition:background .15s" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
        <div style="width:34px;height:34px;border-radius:8px;background:rgba(249,115,22,.1);border:1px solid rgba(249,115,22,.2);display:flex;align-items:center;justify-content:center;font-size:.9rem;flex-shrink:0">✉️</div>
        <div><div style="font-size:.82rem;font-weight:600;color:var(--text)">${supportEmail}</div><div style="font-size:.72rem;color:var(--text-muted)">Send an email</div></div>
      </a>`;
    }

    if (agencyWebsite) {
      const wsUrl = agencyWebsite.startsWith('http') ? agencyWebsite : 'https://' + agencyWebsite;
      html += `<a href="${wsUrl}" target="_blank" rel="noopener" style="display:flex;align-items:center;gap:12px;padding:14px 18px;text-decoration:none;transition:background .15s" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
        <div style="width:34px;height:34px;border-radius:8px;background:var(--teal-dim);border:1px solid rgba(0,217,163,.2);display:flex;align-items:center;justify-content:center;font-size:.9rem;flex-shrink:0">🌐</div>
        <div><div style="font-size:.82rem;font-weight:600;color:var(--text)">${agencyWebsite}</div><div style="font-size:.72rem;color:var(--text-muted)">Visit website</div></div>
      </a>`;
    }

    html += '</div></div>';
  }

  // ── Custom Links ──
  if (customLinks && customLinks.trim()) {
    const links = customLinks.split('\n')
      .map(l => l.trim()).filter(Boolean)
      .map(l => {
        const parts = l.split('|');
        const label = parts[0]?.trim() || l;
        const url   = (parts[1]?.trim() || l).startsWith('http') ? (parts[1]?.trim() || l) : 'https://' + (parts[1]?.trim() || l);
        return { label, url };
      });

    if (links.length) {
      html += `<div class="card" style="margin-bottom:14px"><div class="card-hd"><div class="card-hd-left"><span class="card-icon">🔗</span><span class="card-title">Links & Resources</span></div></div><div class="card-body" style="padding:0">`;
      links.forEach((link, i) => {
        const border = i < links.length - 1 ? 'border-bottom:1px solid var(--border);' : '';
        html += `<a href="${link.url}" target="_blank" rel="noopener" style="display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 18px;${border}text-decoration:none;transition:background .15s" onmouseover="this.style.background='var(--surface-2)'" onmouseout="this.style.background=''">
          <span style="font-size:.82rem;font-weight:600;color:var(--text)">${link.label}</span>
          <span style="color:var(--text-muted);font-size:.8rem">↗</span>
        </a>`;
      });
      html += '</div></div>';
    }
  }

  wrap.innerHTML = html;
}

async function init() {
  if(!slug){document.getElementById('loading').classList.add('out');document.getElementById('h-biz').textContent='Portal not found';return;}
  try{
    const res=await fetch(`${API}/get-portal?slug=${encodeURIComponent(slug)}${_agencyId?'&a='+encodeURIComponent(_agencyId):''}`);
    const data=await res.json();
    if(!data.client)throw new Error(data.error||'Client not found');
    C=data.client;
    const offer=data.offer;

    // Sidebar + topbar
    document.getElementById('sb-name').textContent=C.clientName;
    document.getElementById('sb-biz').textContent=C.businessName;
    document.getElementById('sb-status').textContent=C.statusLabel||C.status||'Active';
    document.getElementById('tb-biz').textContent=C.businessName;

    // Hero
    document.getElementById('h-biz').textContent=C.businessName;
    document.getElementById('h-greet').textContent=`Welcome back, ${C.clientName} 👋`;
    document.getElementById('h-status').textContent=C.statusLabel||C.status||'Active';
    if(C.statusUpdated) document.getElementById('h-updated').textContent='Updated '+new Date(C.statusUpdated).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});

    // Stats
    // Use whichever is higher: Firestore count or our session count (accounts for lag)
    const _fsCount = parseInt(C.referralCount||'0');
    if (_sessionRefCount < _fsCount) _sessionRefCount = _fsCount;
    document.getElementById('st-refs').textContent = _sessionRefCount;
    document.getElementById('ref-n').textContent = _sessionRefCount;
    if(C.createdAt) document.getElementById('st-days').textContent=Math.floor((Date.now()-new Date(C.createdAt))/86400000);

    // Timeline
    document.getElementById('tl').innerHTML=buildTL(C.status);

    // Plan info
    // ── Render My Plan tab ────────────────────────────────────────────────
    // Plan CTA button
    if (C.dashboardUrl) {
      document.getElementById('plan-link').href = C.dashboardUrl;
      document.getElementById('plan-cta-wrap').style.display = 'block';
    }

    // Helper: render a list of label/value rows into a container
    function planRows(containerId, rows) {
      const wrap = document.getElementById(containerId);
      if (!wrap) return;
      const visible = rows.filter(([,v]) => v);
      if (!visible.length) { wrap.closest('.card').style.display='none'; return; }
      wrap.innerHTML = visible.map(([label, value], i) => `
        <div style="display:flex;align-items:flex-start;gap:12px;padding:12px 18px;${i < visible.length-1 ? 'border-bottom:1px solid var(--border)' : ''}">
          <div style="font-size:.72rem;font-weight:700;color:var(--text-muted);text-transform:uppercase;letter-spacing:.06em;min-width:120px;padding-top:2px;flex-shrink:0">${label}</div>
          <div style="font-size:.82rem;color:var(--text);line-height:1.5;font-weight:500">${value}</div>
        </div>`).join('');
    }

    // Business Profile card
    planRows('plan-biz-wrap', [
      ['Business', C.businessName],
      ['Contact', C.clientName],
      ['Email', C.clientEmail ? `<a href="mailto:${C.clientEmail}" style="color:var(--teal);text-decoration:none">${C.clientEmail}</a>` : ''],
      ['Phone', C.phone ? `<a href="tel:${C.phone}" style="color:var(--teal);text-decoration:none">${C.phone}</a>` : ''],
      ['Industry', C.industry],
      ['Member Since', C.createdAt ? new Date(C.createdAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : ''],
    ]);

    // Campaign Details card
    planRows('plan-campaign-wrap', [
      ['Ad Platforms', C.adPlatforms],
      ['Monthly Budget', C.adBudget],
      ['90-Day Goal', C.goal90],
      ['Notes', C.notes],
    ]);

    // Status card
    if (C.statusLabel || C.statusUpdated) {
      document.getElementById('plan-status-card').style.display = 'block';
      planRows('plan-status-wrap', [
        ['Status', C.statusLabel],
        ['Last Updated', C.statusUpdated ? new Date(C.statusUpdated).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}) : ''],
      ]);
    }

    // Platforms
    buildPlatforms(C.adPlatforms, {
      metaBusinessId:   data.metaBusinessId   || '',
      googleManagerId:  data.googleManagerId  || '',
      tiktokAgencyId:   data.tiktokAgencyId   || '',
      linkedinAgencyId: data.linkedinAgencyId || '',
      wordpressSiteUrl: data.wordpressSiteUrl  || '',
    });

    // Offer
    if(offer&&offer.title&&offer.ctaUrl){
      const url=offer.ctaUrl.startsWith('http')?offer.ctaUrl:'https://'+offer.ctaUrl;
      document.getElementById('offer-wrap').innerHTML=`
        <div class="offer">
          <div>
            <div class="offer-tag">🎁 Special Offer</div>
            <div class="offer-title">${offer.title}</div>
            ${offer.description?`<div class="offer-desc">${offer.description}</div>`:''}
            ${offer.expiresAt?`<div class="offer-exp">Expires ${new Date(offer.expiresAt).toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div>`:''}
          </div>
          <a href="${url}" target="_blank" class="offer-btn">${offer.ctaText||'Claim Offer'}</a>
        </div>`;
    }

    // Billing - always render, show empty state if not configured
    const billing = data.billing;
    renderBilling(billing);

    // Referral bonus from agency settings
    const refBonus = data.referralBonus || '';
    const refResources = data.referralResources || '';
    if (refBonus) {
      document.getElementById('ref-bonus-card').style.display = 'block';
      document.getElementById('ref-bonus-text').textContent = refBonus;
      document.getElementById('perk-bonus').textContent = '🎁 ' + refBonus;
      document.getElementById('ref-page-sub').textContent = 'Know a business that could use great marketing? Send them our way!';
    }
    if (refResources) {
      document.getElementById('ref-resources-card').style.display = 'block';
      document.getElementById('ref-resources-text').textContent = refResources;
    }

    // Build resources tab
    buildResources({
      bookingUrl:    data.bookingUrl    || '',
      supportPhone:  data.supportPhone  || '',
      supportEmail:  data.supportEmail  || '',
      agencyWebsite: data.agencyWebsite || '',
      customLinks:   data.customLinks   || '',
    });

    document.getElementById('loading').classList.add('out');
    // Show notification card if eligible (backup trigger independent of SW)
    setTimeout(showNotifCardIfNeeded, 1500);
  }catch(e){
    document.getElementById('loading').classList.add('out');
    document.getElementById('h-biz').textContent='Portal not found';
    document.getElementById('h-greet').textContent=e.message;
  }
}
function renderBilling(b) {
  const el = document.getElementById('billing-content');
  if (!el) return;
  if (!b) {
    el.innerHTML = '<div class="bill-empty"><div class="bill-empty-icon">💳</div><div class="bill-empty-text" style="font-size:.85rem;line-height:1.6">No billing information available yet.<br><span style="font-size:.75rem;opacity:.7">Your agency will add your billing details here.</span></div></div>';
    return;
  }
  const curr = b.currency || 'USD';
  const sym  = {USD:'$',CAD:'$',EUR:'€',GBP:'£',AUD:'$'}[curr] || '$';
  const fmt  = amt => sym + parseFloat(amt||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2});
  const termLabels = {'month-to-month':'Month-to-Month','monthly':'Monthly','quarterly':'Quarterly','biannual':'Semi-Annual','annual':'Annual','custom':'Custom'};
  const cycleLabels = {'monthly':'Monthly','weekly':'Weekly','biweekly':'Bi-Weekly','quarterly':'Quarterly','biannual':'Semi-Annual','annual':'Annual','one-time':'One-Time'};
  const bonusLabels = {'none':'','free-website':'Free Website Included','free-trial':'Free Trial Period','free-months':'Free Month(s) Included','free-setup':'Setup Fee Waived','discount':'Discounted Rate','custom':'Special Bonus'};
  const statusMap = {pending:{label:'⏳ Pending',col:'var(--gold)'},paid:{label:'✅ Paid',col:'var(--teal)'},late:{label:'🔴 Overdue',col:'var(--red)'},cancelled:{label:'❌ Cancelled',col:'var(--text-muted)'},waived:{label:'🟤 Waived',col:'var(--purple)'}};
  const payments = b.payments || [];
  const today = new Date().toISOString().slice(0,10);
  const nextPayment = payments.find(p => p.status==='pending' || p.status==='late');
  const nextDueDate = nextPayment?.dueDate;
  const isLate = nextDueDate && nextDueDate < today;

  let html = '';

  // Plan summary
  html += `<div class="bill-summary">
    <div class="bill-summary-hdr">
      <span class="bill-summary-title">📋 Your Plan</span>
      ${b.planType?`<span class="bill-summary-badge">${esc(b.planType)}</span>`:''}
    </div>
    ${b.contractTerm?`<div class="bill-row"><div class="bill-row-desc" style="color:var(--text-muted);font-size:.72rem">Contract Term</div><div class="bill-row-amt" style="font-family:var(--font);font-size:.82rem;color:var(--text)">${termLabels[b.contractTerm]||b.contractTerm}</div></div>`:''}
    ${b.billingCycle&&b.billingCycle!=='one-time'?`<div class="bill-row"><div class="bill-row-desc" style="color:var(--text-muted);font-size:.72rem">Billing Cycle</div><div class="bill-row-amt" style="font-family:var(--font);font-size:.82rem;color:var(--text)">${cycleLabels[b.billingCycle]||b.billingCycle}</div></div>`:''}
    ${b.startDate?`<div class="bill-row"><div class="bill-row-desc" style="color:var(--text-muted);font-size:.72rem">Start Date</div><div class="bill-row-amt" style="font-family:var(--font);font-size:.82rem;color:var(--text)">${new Date(b.startDate+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}</div></div>`:''}
    ${b.setupFee>0?`<div class="bill-row"><div class="bill-row-desc" style="color:var(--text-muted);font-size:.72rem">Setup / Deposit</div><div class="bill-row-amt">${fmt(b.setupFee)} ${b.setupFeePaid?'<span style="font-size:.62rem;color:var(--teal)">✅ Paid</span>':'<span style="font-size:.62rem;color:var(--gold)">⏳ Pending</span>'}</div></div>`:''}
    ${b.recurringAmount>0?`<div class="bill-footer"><div><div class="bill-footer-lbl">Recurring</div></div><div class="bill-footer-amt">${fmt(b.recurringAmount)}<span style="font-size:.65rem;font-weight:400;color:var(--text-muted)"> /${(cycleLabels[b.billingCycle]||'cycle').toLowerCase()}</span></div></div>`:''}
    ${b.autoRenew?'<div style="padding:8px 18px;font-size:.7rem;color:var(--teal)">✅ Auto-renewal enabled</div>':''}
    ${b.bonus&&b.bonus!=='none'?`<div style="padding:10px 18px;background:rgba(249,115,22,.08);border-top:1px solid rgba(249,115,22,.15);font-size:.78rem;color:var(--orange)">🎁 ${esc(bonusLabels[b.bonus]||b.bonus)}${b.bonusDetail?' — '+esc(b.bonusDetail):''}${b.bonusDuration?' ('+esc(b.bonusDuration)+')':''}</div>`:''}
  </div>`;

  // Next payment highlight
  if (nextPayment) {
    const dueStr = nextDueDate?new Date(nextDueDate+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'}):'—';
    html += `<div style="background:${isLate?'var(--red-dim)':'rgba(0,217,163,.08)'};border:1px solid ${isLate?'rgba(239,68,68,.3)':'rgba(0,217,163,.25)'};border-radius:var(--radius);padding:16px 20px;margin-bottom:14px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
      <div>
        <div style="font-size:.62rem;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:${isLate?'var(--red)':'var(--teal)'};margin-bottom:4px">${isLate?'⚠️ Payment Overdue':'💳 Next Payment Due'}</div>
        <div style="font-family:var(--display);font-size:1.2rem;font-weight:800;color:var(--text)">${fmt(nextPayment.amount)}</div>
        <div style="font-size:.75rem;color:var(--text-muted);margin-top:2px">Due: ${dueStr}</div>
      </div>
      ${b.paymentLink?`<a href="${esc(b.paymentLink)}" target="_blank" class="bill-pay-btn">${isLate?'⚠️ Pay Now →':'💳 Pay Now →'}</a>`:''}
    </div>`;
  } else if (!payments.length && b.paymentLink) {
    html += `<div style="margin-bottom:14px"><a href="${esc(b.paymentLink)}" target="_blank" class="bill-pay-btn">💳 Pay Now →</a></div>`;
  }

  // Payment history
  if (payments.length) {
    html += `<div class="bill-summary"><div class="bill-summary-hdr"><span class="bill-summary-title">📊 Payment History</span></div>`;
    payments.forEach(p => {
      const isOvd = p.status==='pending' && p.dueDate && p.dueDate < today;
      const s = statusMap[isOvd?'late':p.status] || statusMap.pending;
      const dueStr = p.dueDate?new Date(p.dueDate+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'—';
      const paidStr = p.paidAt?new Date(p.paidAt).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'}):'';
      html += `<div class="bill-row">
        <div style="flex:1"><div class="bill-row-desc">${esc(p.label||'Payment')}</div>
        <div style="font-size:.68rem;color:var(--text-muted);margin-top:2px">Due: ${dueStr}${paidStr?' · Paid: '+paidStr:''}</div></div>
        <div style="display:flex;align-items:center;gap:10px">
          <div class="bill-row-amt">${sym}${parseFloat(p.amount||0).toLocaleString('en-US',{minimumFractionDigits:2,maximumFractionDigits:2})}</div>
          <span style="font-size:.62rem;font-weight:700;color:${s.col};white-space:nowrap">${s.label}</span>
        </div>
      </div>`;
    });
    html += '</div>';
  }

  if (b.notes) {
    html += `<div class="bill-notes-box"><div class="bill-notes-lbl">📋 Notes</div><div class="bill-notes-text">${esc(b.notes)}</div></div>`;
  }

  if (!html || !html.trim()) {
    el.innerHTML = '<div class="bill-empty"><div class="bill-empty-icon">💳</div><div class="bill-empty-text" style="font-size:.85rem;line-height:1.6">No billing information available yet.<br><span style="font-size:.75rem;opacity:.7">Your agency will add your billing details here.</span></div></div>';
    return;
  }

  el.innerHTML = html;
}


function esc(s){return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}

init();

// ── Real-time status polling — updates UI without reopening app ──────────────
let _lastStatus = null;
let _lastDashUrl = null;

async function pollStatus() {
  if (!slug) return;
  try {
    const res = await fetch(`${API}/get-portal?slug=${encodeURIComponent(slug)}${_agencyId?'&a='+encodeURIComponent(_agencyId):''}`, {
      cache: 'no-store'
    });
    const data = await res.json();
    if (!data.client) return;
    const fresh = data.client;

    // Status changed — update UI live
    if (_lastStatus !== null && fresh.status !== _lastStatus) {
      console.log('[portal] Status changed:', _lastStatus, '→', fresh.status);

      // Update status badge and timeline
      const statusEl = document.getElementById('h-status');
      const sbStatusEl = document.getElementById('sb-status');
      if (statusEl) statusEl.textContent = fresh.statusLabel || fresh.status;
      if (sbStatusEl) sbStatusEl.textContent = fresh.statusLabel || fresh.status;
      document.getElementById('tl').innerHTML = buildTL(fresh.status);
      if (fresh.statusUpdated) {
        const updEl = document.getElementById('h-updated');
        if (updEl) updEl.textContent = 'Updated ' + new Date(fresh.statusUpdated).toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'});
      }

      // Push notification if app has permission
      if ('Notification' in window && Notification.permission === 'granted') {
        const labels = {
          active: 'Your campaign is now active!',
          launched: '🚀 Your ads are live!',
          completed: '✅ Campaign completed!',
          paused: 'Your campaign has been paused.',
          new: 'Your onboarding is being reviewed.',
        };
        const msg = labels[fresh.status] || `Status updated to: ${fresh.statusLabel || fresh.status}`;
        new Notification('Campaign Update 📢', {
          body: msg,
          icon: '/icons/portal-icon-192.png',
          tag: 'status-update',
        });
      }
      toast('📢 Status updated: ' + (fresh.statusLabel || fresh.status));
    }

    // Plan URL available now — update button
    if (fresh.dashboardUrl && fresh.dashboardUrl !== _lastDashUrl) {
      const planLink = document.getElementById('plan-link');
      if (planLink) planLink.href = fresh.dashboardUrl;
      _lastDashUrl = fresh.dashboardUrl;
      if (_lastStatus !== null && !_lastDashUrl) toast('✨ Your marketing plan is ready!');
    }

    _lastStatus = fresh.status;
    _lastDashUrl = fresh.dashboardUrl || _lastDashUrl;
    C = fresh; // Update global client object
  } catch(e) {
    // Silent fail — don't disrupt UX on network error
    console.log('[portal] Poll error:', e.message);
  }
}

// Start polling after portal loads, every 30 seconds
window.addEventListener('portalLoaded', () => {
  if (C) { _lastStatus = C.status; _lastDashUrl = C.dashboardUrl; }
  // Poll every 30s while app is visible
  let pollInterval = setInterval(pollStatus, 30000);
  // Pause polling when app is backgrounded, resume on foreground
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clearInterval(pollInterval);
    } else {
      // Immediate poll on return, then resume interval
      pollStatus();
      pollInterval = setInterval(pollStatus, 30000);
    }
  });
});

// ── PWA: Debug reset (add ?reset_pwa=1 to URL to clear dismissal flags) ─────
if (new URLSearchParams(location.search).get('reset_pwa') === '1') {
  localStorage.removeItem('pwa-banner-dismissed');
  localStorage.removeItem('notif-bar-dismissed');
  localStorage.removeItem('notif-enabled');
  console.log('[PWA] Reset all PWA flags');
}

// ── PWA: Service Worker inlined as blob — Netlify won't intercept it ────────
// ── PWA: Service Worker at /sw.js (served by Netlify function with correct headers)
let _swReg = null;

window.addEventListener('load', () => {
  if (!('serviceWorker' in navigator)) {
    setTimeout(showNotifCardIfNeeded, 500);
    return;
  }
  // /sw.js is served by a Netlify function with Content-Type: application/javascript
  // and Service-Worker-Allowed: / — required by iOS Safari
  navigator.serviceWorker.register('/sw.js', { scope: '/' })
    .then(async reg => {
      _swReg = reg;
      console.log('[PWA] SW registered:', reg.scope);
      setTimeout(showNotifCardIfNeeded, 500);
      // Re-save push subscription on every open — refreshes stale APNS tokens
      // iOS rotates push tokens after app suspension; stale tokens = silent drop
      if (Notification.permission === 'granted' && slug && _agencyId) {
        try {
          const sub = await reg.pushManager.getSubscription();
          if (sub) {
            fetch('/api/save-push-subscription', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ agencyId: _agencyId, clientId: slug, subscription: sub.toJSON() }),
            }).catch(() => {});
          }
        } catch(e) {}
      }
    })
    .catch(err => {
      console.warn('[PWA] SW failed:', err.message);
      setTimeout(showNotifCardIfNeeded, 500);
    });
});

// ── PWA: iOS Install Banner ──────────────────────────────────────────────────
function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}
function isStandalone() {
  return window.matchMedia('(display-mode: standalone)').matches ||
         window.navigator.standalone === true;
}
// Android/Chrome: capture beforeinstallprompt for native install
let _deferredInstallPrompt = null;
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  _deferredInstallPrompt = e;
  // Show our banner immediately
  const dismissed = localStorage.getItem('pwa-banner-dismissed');
  if (!dismissed && !isStandalone()) {
    setTimeout(() => document.getElementById('pwa-banner').classList.add('show'), 2000);
  }
});

window.addEventListener('DOMContentLoaded', function() {
  // Small delay so iOS has time to correctly report standalone mode
  setTimeout(function() {
    if (isStandalone()) return; // Already installed — hide button
    const dismissed = localStorage.getItem('pwa-banner-dismissed');
    if (dismissed && Date.now() - parseInt(dismissed) < 86400000) return;
    const installBtn = document.getElementById('install-app-btn');
    if (installBtn) installBtn.style.display = 'flex';
  }, 100);

  setTimeout(() => {
    if (!isStandalone()) {
      const b = document.getElementById('pwa-banner');
      if (b) b.classList.add('show');
    }
  }, 3000);
});

function dismissBanner() {
  document.getElementById('pwa-banner').classList.remove('show');
  localStorage.setItem('pwa-banner-dismissed', Date.now().toString());
}

async function showInstallInstructions() {
  // Android/Chrome: use native install prompt
  if (_deferredInstallPrompt) {
    _deferredInstallPrompt.prompt();
    const { outcome } = await _deferredInstallPrompt.userChoice;
    _deferredInstallPrompt = null;
    dismissBanner();
    if (outcome === 'accepted') toast('✅ App installed! Find it on your home screen.');
    return;
  }
  // iOS Safari: show visual modal instead of alert()
  dismissBanner();
  const isIpad = /ipad/i.test(navigator.userAgent);
  let modal = document.getElementById('ios-install-modal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'ios-install-modal';
    modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:99999;display:flex;align-items:flex-end;justify-content:center;padding:0 12px 12px;backdrop-filter:blur(4px)';
    modal.innerHTML = `
      <div style="background:#1a2235;border-radius:16px;padding:24px 20px;width:100%;max-width:440px;border:1px solid rgba(0,217,163,.2)">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:18px">
          <div style="font-size:1rem;font-weight:800;color:#e2e8f0">Install Your Portal App</div>
          <button onclick="document.getElementById('ios-install-modal').remove()" style="background:none;border:none;color:#8892a4;font-size:1.2rem;cursor:pointer;padding:4px">✕</button>
        </div>
        <div style="display:flex;flex-direction:column;gap:14px;margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:14px;background:#111827;border-radius:10px;padding:12px 14px">
            <div style="background:#00d9a3;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">${isIpad ? '⬆️' : '⬜️'}</div>
            <div>
              <div style="font-weight:700;font-size:.88rem;color:#e2e8f0;margin-bottom:2px">Step 1 — Tap Share</div>
              <div style="font-size:.78rem;color:#8892a4">Tap the <strong style="color:#e2e8f0">${isIpad ? '↑ Share' : '□↑ Share'}</strong> button in ${isIpad ? "Safari's top bar" : "Safari's bottom toolbar"}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;background:#111827;border-radius:10px;padding:12px 14px">
            <div style="background:#00d9a3;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">➕</div>
            <div>
              <div style="font-weight:700;font-size:.88rem;color:#e2e8f0;margin-bottom:2px">Step 2 — Add to Home Screen</div>
              <div style="font-size:.78rem;color:#8892a4">Scroll down in the menu and tap <strong style="color:#e2e8f0">"Add to Home Screen"</strong></div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;background:#111827;border-radius:10px;padding:12px 14px">
            <div style="background:#00d9a3;border-radius:8px;width:36px;height:36px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0">✅</div>
            <div>
              <div style="font-weight:700;font-size:.88rem;color:#e2e8f0;margin-bottom:2px">Step 3 — Tap Add</div>
              <div style="font-size:.78rem;color:#8892a4">Tap <strong style="color:#e2e8f0">"Add"</strong> in the top right — your portal icon appears on your home screen!</div>
            </div>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;background:rgba(0,217,163,.08);border:1px solid rgba(0,217,163,.2);border-radius:8px;padding:10px 12px">
          <span style="font-size:1rem">💡</span>
          <span style="font-size:.75rem;color:#8892a4;line-height:1.5">Once installed, open from your home screen to enable notifications and get updates when your plan is ready.</span>
        </div>
      </div>`;
    document.body.appendChild(modal);
    // Tap outside to dismiss
    modal.addEventListener('click', e => { if(e.target===modal) modal.remove(); });
  }
}

// ── PWA: Push Notification Bar ───────────────────────────────────────────────
// Show notification card — called both from SW registration and from init()
function showNotifCardIfNeeded() {
  const card = document.getElementById('notif-card');
  if (!card) return;

  // Only show if: installed PWA on iOS OR desktop browser with push support
  if (isIOS() && !isStandalone()) return;
  if (!('Notification' in window) || !('PushManager' in window)) return;

  // Already denied — can't do anything
  if (Notification.permission === 'denied') return;

  // Already enabled (saved to localStorage on successful subscribe + server save)
  if (localStorage.getItem('notif-enabled') === '1') return;

  // Already granted permission — show card briefly then check subscription async
  // This handles the case where permission was granted but subscription wasn't saved
  card.style.display = 'flex';

  // Async: if already subscribed AND saved, hide immediately
  if (Notification.permission === 'granted' && 'serviceWorker' in navigator) {
    navigator.serviceWorker.getRegistration('/').then(reg => {
      if (!reg) return;
      return reg.pushManager.getSubscription();
    }).then(sub => {
      if (sub) {
        // Have a subscription — mark as enabled and hide
        localStorage.setItem('notif-enabled', '1');
        card.style.display = 'none';
      }
    }).catch(() => {});
  }
}

async function checkNotifBar(reg) {
  // Push not supported on this browser — hide everything silently
  if (!('Notification' in window) || !('PushManager' in window)) return;

  // iOS Safari NOT installed as PWA — push doesn't work until installed
  if (isIOS() && !isStandalone()) return;

  // Already denied — nothing we can do
  if (Notification.permission === 'denied') return;

  // Already granted and subscribed — card stays hidden
  if (Notification.permission === 'granted') {
    try {
      const sub = await reg.pushManager.getSubscription();
      if (sub) return; // already subscribed — hide card
    } catch(e) {}
  }

  // Show the in-dashboard notification card (no annoying auto-popup)
  const card = document.getElementById('notif-card');
  if (card) card.style.display = 'flex';
}

function dismissNotifBar() {
  document.getElementById('notif-bar').classList.remove('show');
  localStorage.setItem('notif-bar-dismissed', '1');
}

// VAPID public key from server
const VAPID_PUBLIC_KEY = 'BO99Hx_tAxUQczsG3r2i206DZFc0V7ASqM4gcTBmct4X9x3axqbLrsjNY3t4eqHioXCu_Pr1ohJNArFgfxQJKJs';

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64   = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw      = window.atob(base64);
  return Uint8Array.from([...raw].map(char => char.charCodeAt(0)));
}

async function requestNotifPermission() {
  dismissNotifBar();
  // Show loading state on button
  const enableBtn = document.getElementById('notif-enable-btn');
  if (enableBtn) { enableBtn.textContent = '⏳ Enabling...'; enableBtn.disabled = true; }
  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      if (enableBtn) { enableBtn.textContent = 'Enable Notifications'; enableBtn.disabled = false; }
      toast('Notifications blocked — enable in iPhone Settings → Notifications');
      return;
    }

    // Use the globally stored SW registration
    // If not ready yet, wait up to 5 seconds for it
    let reg = _swReg;
    if (!reg) {
      reg = await Promise.race([
        new Promise(resolve => {
          const check = setInterval(() => { if (_swReg) { clearInterval(check); resolve(_swReg); } }, 200);
        }),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Service worker not ready — try again in a moment')), 5000))
      ]);
    }

    // Subscribe to Web Push with VAPID
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
    });

    // Mark as enabled immediately — so card stays hidden even if API call fails
    localStorage.setItem('notif-enabled', '1');

    // Hide card and show success RIGHT NOW — don't wait for server
    const card = document.getElementById('notif-card');
    if (card) card.style.display = 'none';
    document.getElementById('notif-bar').classList.remove('show');
    reg.showNotification('Notifications Enabled! 🔔', {
      body: "You'll get notified when your plan is ready and when your agency has updates.",
      icon: '/icons/portal-icon-192.png',
      tag:  'welcome',
      data: { url: `/onboard/portal?a=${_agencyId}&s=${slug}` },
    });
    toast('✅ Notifications enabled!');

    // Save subscription to server in background (non-blocking)
    fetch('/api/save-push-subscription', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agencyId: _agencyId, clientId: slug, subscription: subscription.toJSON() }),
    }).then(r => r.json()).then(r => {
      if (!r.ok) console.warn('[PWA] Subscription save failed:', r);
    }).catch(e => console.warn('[PWA] Subscription save error:', e.message));
  } catch(e) {
    console.log('[PWA] Push subscription error:', e.message);
    if (enableBtn) { enableBtn.textContent = 'Enable Notifications'; enableBtn.disabled = false; }
    if (e.name === 'NotSupportedError' || e.message.includes('not supported')) {
      toast('Push notifications require iOS 16.4+ or Chrome');
    } else {
      toast('Could not enable: ' + e.message.slice(0, 60));
    }
  }
}

// ── PWA: Handle URL shortcuts (goto param) ───────────────────────────────────
(function handleShortcuts() {
  const goto = new URLSearchParams(location.search).get('goto');
  if (goto && document.getElementById(goto)) {
    // Navigate to the section after portal loads
    window.addEventListener('portalLoaded', () => {
      const btn = document.querySelector(`[onclick*="${goto}"]`);
      go(goto, btn);
    });
  }
})();

// ── PWA: Fire portalLoaded event when init completes ────────────────────────
// (patched into init success path via MutationObserver on loading div)
const _loadObs = new MutationObserver(() => {
  const loading = document.getElementById('loading');
  if (loading && loading.classList.contains('out')) {
    window.dispatchEvent(new Event('portalLoaded'));
    _loadObs.disconnect();
  }
});
_loadObs.observe(document.getElementById('loading'), { attributes: true, attributeFilter: ['class'] });
</script>
</body>
</html>
