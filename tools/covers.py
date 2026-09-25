#!/usr/bin/env python3
"""Pasang hero "cover" (gambar seni full-bleed + navbar + nama project) di atas tiap desain galeri.
Idempoten: blok lama di antara penanda dibuang dulu. Menulis ke data/studio DAN seed/studio.
Jalankan dari root project: python3 tools/covers.py"""
import json, re, shutil, os
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
IMG = ROOT / "public/img"
(IMG / "cover").mkdir(exist_ok=True)

# slug -> (id desain, [gambar cover], aksen, font display, nama, kind, tagline, menu, tombol utama)
P = {
 "terminal":    ("2cW90gNXgkxf", ["show-3"], "#39ff14", "Unbounded", "TRIUMP Trade", "Trading terminal",
                 "Trade the chain at the speed of thought. Deep books, zero-lag fills.", ["Terminal","Perps","Pools","Docs"], "Start trading"),
 "launch":      ("tZzLtE-My0yg", ["hydra","onlook"], "#8dff3a", "Bebas Neue", "NEON FROG", "Meme token",
                 "Spiked, radioactive and unstoppable. The loudest frog on Robinhood Chain.", ["Story","Tokenomics","How to buy","Community"], "Buy $NFROG"),
 "agent":       ("7g8AVuYdHnmF", ["opengenerative-ui","chatgl"], "#ff3b6b", "Syne", "ORACLE-7", "AI agent",
                 "An autonomous agent that watches, reasons and acts while you sleep.", ["Console","Skills","Logs","API"], "Deploy agent"),
 "nft":         ("fDjE52bQTtE1", ["comfyui","dyad"], "#ff4fd8", "Anton", "Glitch Punks", "NFT collection",
                 "10,000 corrupted citizens. Every one of them glitched differently.", ["Collection","Rarity","Roadmap","Mint"], "Mint now"),
 "wallet":      ("Y-9Y5zBKg7bL", ["three-js"], "#4fe6ff", "Unbounded", "Hood Wallet", "Mobile wallet",
                 "Your keys, your coins, your colors. A wallet that feels alive.", ["Features","Security","Download","Help"], "Get the app"),
 "explorer":    ("ulOw6Y8ZogBo", ["tldraw-make-real","open-generative-ai"], "#7c6bff", "Space Grotesk", "RoboScan", "Chain explorer",
                 "X-ray vision for Robinhood Chain. Every block, every wallet, in real time.", ["Blocks","Txns","Tokens","Charts"], "Search the chain"),
 "startup":     ("yj30CW74J7QK", ["p5-js","open-design"], "#c8ff00", "Archivo Black", "SYNAPSE", "AI startup",
                 "Reasoning infrastructure for autonomous systems. Think bigger, ship faster.", ["Product","Research","Pricing","Careers"], "Request access"),
 "leaderboard": ("Tdc9wzMjl1td", ["awesome-creative-coding","show-4"], "#ffc83d", "Playfair Display", "Top Hoods", "Holder leaderboard",
                 "Hold like royalty. The biggest hoods on the chain, ranked live.", ["Rankings","Rewards","Seasons","Rules"], "Check my rank"),
 "visualizer":  ("0nhdFXO93WrR", ["shadergif"], "#ffd400", "Bebas Neue", "WAVEFORM", "Music visualizer",
                 "Drop a track. Watch it explode into color, beat by beat.", ["Visualize","Presets","Gallery","Pro"], "Drop a track"),
 "bridge":      ("GVm_xXIskgmH", ["bolt-diy"], "#2ee6c5", "Syne", "PORTAL", "Cross-chain bridge",
                 "Fly your assets from Ethereum to Robinhood Chain in one move.", ["Bridge","Routes","History","Docs"], "Open the portal"),
}

BAKED = {"terminal"}  # gambar cover sudah memuat kata TRIUMP
A0, A1 = "<!--tr-cover-->", "<!--/tr-cover-->"

def block(slug, cfg):
    _id, imgs, acc, font, name, kind, tag, menu, cta = cfg
    for n in imgs:
        shutil.copyfile(IMG / f"{n}.jpg", IMG / "cover" / f"{n}.jpg")
    fam = font.replace(" ", "+")
    slides = "".join(f'<div class="trc-s{" on" if i==0 else ""}" style="background-image:url(/img/cover/{n}.jpg)"></div>' for i, n in enumerate(imgs))
    dots = "" if len(imgs) < 2 else '<div class="trc-dots">' + "".join(f'<i{" class=on" if i==0 else ""}></i>' for i in range(len(imgs))) + f'<span>01 / 0{len(imgs)}</span></div>'
    links = "".join(f'<a href="#">{m}</a>' for m in menu)
    words = name.split(" ")
    title = " ".join(words[:-1]) + (" " if len(words) > 1 else "") + f'<em>{words[-1]}</em>'
    if slug in BAKED: title = f'<em>{words[-1]}</em>'
    return f'''{A0}
<link href="https://fonts.googleapis.com/css2?family={fam}:wght@400;700;800;900&family=Inter:wght@400;500;700&display=swap" rel="stylesheet">
<style>
.trc{{--a:{acc};position:relative;z-index:1000;height:100vh;min-height:620px;overflow:hidden;background:#000;color:#fff;font-family:Inter,system-ui,sans-serif;isolation:isolate}}
.trc-s{{position:absolute;inset:-4%;background-size:cover;background-position:center;opacity:0;transition:opacity 1.4s ease;animation:trcKen 18s ease-in-out infinite alternate}}
.trc-s.on{{opacity:1}}
@keyframes trcKen{{from{{transform:scale(1) translate3d(0,0,0)}}to{{transform:scale(1.09) translate3d(-1.5%,-1%,0)}}}}
.trc::before{{content:"";position:absolute;inset:0;z-index:1;background:linear-gradient(180deg,rgba(0,0,0,.55) 0%,rgba(0,0,0,0) 22%,rgba(0,0,0,0) 48%,rgba(0,0,0,.82) 100%)}}
.trc-nav{{position:absolute;z-index:3;top:18px;left:24px;right:24px;display:flex;align-items:center;gap:26px;padding:10px 12px 10px 16px;border-radius:14px;background:rgba(10,10,12,.42);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px);border:1px solid rgba(255,255,255,.12)}}
.trc-logo{{display:flex;align-items:center;gap:10px;font-weight:800;font-size:15px;letter-spacing:-.01em;white-space:nowrap}}
.trc-logo i{{width:26px;height:26px;border-radius:7px;background:var(--a);box-shadow:0 0 22px var(--a);display:grid;place-items:center;font-style:normal;color:#000;font-size:13px;font-weight:900}}
.trc-links{{display:flex;gap:22px;flex:1}}
.trc-links a{{color:rgba(255,255,255,.78);text-decoration:none;font-size:13.5px;font-weight:500}}
.trc-links a:hover{{color:#fff}}
.trc-btn{{height:38px;padding:0 16px;border-radius:10px;border:1px solid rgba(255,255,255,.22);background:rgba(255,255,255,.06);color:#fff;font:600 13px Inter,sans-serif;cursor:pointer;white-space:nowrap}}
.trc-btn.pri{{background:var(--a);border-color:var(--a);color:#000;box-shadow:0 8px 28px -8px var(--a)}}
.trc-copy{{position:absolute;z-index:3;left:48px;right:48px;bottom:56px;max-width:880px}}
.trc-chip{{display:inline-flex;align-items:center;gap:8px;padding:6px 12px;border-radius:999px;background:rgba(0,0,0,.45);border:1px solid rgba(255,255,255,.18);font-size:11.5px;font-weight:700;letter-spacing:.14em;text-transform:uppercase}}
.trc-chip b{{width:7px;height:7px;border-radius:50%;background:var(--a);box-shadow:0 0 10px var(--a)}}
.trc h1{{font-family:"{font}",Inter,sans-serif;font-weight:900;font-size:clamp(44px,9vw,150px);line-height:.9;white-space:nowrap;letter-spacing:-.02em;margin:18px 0 14px;text-shadow:0 8px 40px rgba(0,0,0,.45)}}
.trc h1 em{{font-style:normal;color:var(--a)}}
.trc p{{font-size:clamp(16px,1.6vw,20px);line-height:1.45;color:rgba(255,255,255,.86);max-width:560px;margin:0 0 24px}}
.trc-ctas{{display:flex;gap:10px;flex-wrap:wrap}}
.trc-ctas .trc-btn{{height:48px;padding:0 22px;font-size:14.5px;border-radius:12px}}
.trc-dots{{position:absolute;z-index:3;right:48px;bottom:64px;display:flex;align-items:center;gap:8px;font:600 12px Inter,sans-serif;color:rgba(255,255,255,.75)}}
.trc-dots i{{width:22px;height:3px;border-radius:3px;background:rgba(255,255,255,.3);transition:.4s}}
.trc-dots i.on{{width:44px;background:var(--a)}}
.trc-dots span{{margin-left:8px;letter-spacing:.08em}}
@media(max-width:760px){{.trc-links{{display:none}}.trc-nav{{left:12px;right:12px;gap:10px;justify-content:space-between}}.trc-nav .trc-btn:not(.pri){{display:none}}.trc-copy{{left:20px;right:20px;bottom:40px}}.trc-dots{{display:none}}}}
</style>
<section class="trc" data-trc="{slug}">
  {slides}
  <nav class="trc-nav"><div class="trc-logo"><i>{name[0]}</i>{name}</div><div class="trc-links">{links}</div><button class="trc-btn">Sign in</button><button class="trc-btn pri">{cta}</button></nav>
  <div class="trc-copy"><span class="trc-chip"><b></b>{kind} · Robinhood Chain</span><h1>{title}</h1><p>{tag}</p>
    <div class="trc-ctas"><button class="trc-btn pri">{cta}</button><button class="trc-btn">Learn more</button></div></div>
  {dots}
</section>
<script>(function(){{var r=document.querySelector('[data-trc]'),s=r.querySelectorAll('.trc-s'),d=r.querySelectorAll('.trc-dots i'),n=r.querySelector('.trc-dots span'),k=0;
function go(i){{k=i%s.length;s.forEach(function(e,j){{e.classList.toggle('on',j===k)}});d.forEach(function(e,j){{e.classList.toggle('on',j===k)}});if(n)n.textContent='0'+(k+1)+' / 0'+s.length}}
var h=/#s(\\d)/.exec(location.hash);if(h)go(+h[1]-1);else if(s.length>1)setInterval(function(){{go(k+1)}},5200);}}());</script>
{A1}'''

for slug, cfg in P.items():
    b = block(slug, cfg)
    for d in ("data/studio", "seed/studio"):
        f = ROOT / d / f"{cfg[0]}.json"
        j = json.loads(f.read_text())
        h = j["versions"][-1]["html"]
        h = re.sub(re.escape(A0) + r".*?" + re.escape(A1) + r"\n?", "", h, flags=re.S)
        h = re.sub(r"(<body[^>]*>)", lambda m: m.group(1) + "\n" + b + "\n", h, count=1)
        j["versions"][-1]["html"] = h
        f.write_text(json.dumps(j, ensure_ascii=False))
    print("ok", slug, cfg[1])
