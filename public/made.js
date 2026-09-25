/* TRIUMP AI — galeri "Made with TRIUMP AI".
   Semua karya di sini dibuat oleh Studio / TriumpCode sendiri. Dipakai homepage (kartu,
   carousel, slideshow), halaman made.html, dan dashboard.
   Menambah karya: screenshot 1280x720 ke img/made/<slug>.jpg, lalu tambah satu baris di bawah
   (d = id desain Studio, atau p = id project TriumpCode). */
window.TRIUMP_MADE = [
  { slug: "terminal",    title: "TRIUMP Trade", kind: "Trading terminal",    by: "Studio", d: "2cW90gNXgkxf", img: "./img/made/terminal.jpg",
    prompt: "Trading terminal on Robinhood Chain with a candlestick chart, order book, buy/sell panel and live trades, dark neon green and blue" },
  { slug: "launch",      title: "NEON FROG",    kind: "Meme token",   by: "Studio", d: "tZzLtE-My0yg", img: "./img/made/launch.jpg",
    prompt: "Launch page for a meme token on Robinhood Chain with a glowing pixel-art mascot, countdown, tokenomics and how-to-buy, dark neon" },
  { slug: "agent",       title: "ORACLE-7",     kind: "AI agent",    by: "Studio", d: "7g8AVuYdHnmF", img: "./img/made/agent.jpg",
    prompt: "AI agent console with a hacker terminal look, streaming logs, agent status cards and a neural network graph, dark neon" },
  { slug: "nft",         title: "Glitch Punks", kind: "NFT collection",      by: "Studio", d: "fDjE52bQTtE1", img: "./img/made/nft.jpg",
    prompt: "NFT collection page with pixel-art glitch characters, rarity filters and a mint panel, dark neon green and blue" },
  { slug: "wallet",      title: "Hood Wallet",  kind: "Mobile wallet",   by: "Studio", d: "Y-9Y5zBKg7bL", img: "./img/made/wallet.jpg",
    prompt: "Mobile crypto wallet app, three phone screens: balance, send and activity, dark neon green and blue" },
  { slug: "explorer",    title: "RoboScan",     kind: "Chain explorer",      by: "Studio", d: "ulOw6Y8ZogBo", img: "./img/made/explorer.jpg",
    prompt: "Blockchain explorer for Robinhood Chain with network stats, latest blocks and transactions, dark neon" },
  { slug: "startup",     title: "SYNAPSE",      kind: "AI startup site",     by: "Studio", d: "yj30CW74J7QK", img: "./img/made/startup.jpg",
    prompt: "Landing page for an AI startup with a giant headline, glowing orb, feature grid and pricing teaser, dark neon" },
  { slug: "leaderboard", title: "Top Hoods",    kind: "Holder leaderboard",  by: "Studio", d: "Tdc9wzMjl1td", img: "./img/made/leaderboard.jpg",
    prompt: "Token holder leaderboard with a glowing top-3 podium, ranked table and rewards panel, dark neon" },
  { slug: "visualizer",  title: "WAVEFORM",     kind: "Music visualizer",    by: "Studio", d: "0nhdFXO93WrR", img: "./img/made/visualizer.jpg",
    prompt: "AI music visualizer with animated audio bars and a circular spectrum, track info and controls, dark neon" },
  { slug: "bridge",      title: "PORTAL",       kind: "Cross-chain bridge",  by: "Studio", d: "GVm_xXIskgmH", img: "./img/made/bridge.jpg",
    prompt: "Cross-chain bridge app from Ethereum to Robinhood Chain with a swap card and glowing route, dark neon" },
  { slug: "launch-2",    title: "NEON FROG",    kind: "Meme token",  by: "Studio", d: "tZzLtE-My0yg", img: "./img/made/launch-2.jpg",
    prompt: "Tokenomics section for a meme token with bold stat cards, dark neon green and blue" },
  { slug: "nft-2",       title: "Glitch Punks", kind: "NFT collection",     by: "Studio", d: "fDjE52bQTtE1", img: "./img/made/nft-2.jpg",
    prompt: "NFT collection feed with pixel-art character cards and a mint terminal, dark neon" },
  { slug: "agent-2",     title: "ORACLE-7",     kind: "AI agent",  by: "Studio", d: "7g8AVuYdHnmF", img: "./img/made/agent-2.jpg",
    prompt: "Capabilities section for an AI agent platform, terminal style, dark neon" },
  { slug: "explorer-2",  title: "RoboScan",     kind: "Chain explorer", by: "Studio", d: "ulOw6Y8ZogBo", img: "./img/made/explorer-2.jpg",
    prompt: "Latest blocks and transactions tables for a blockchain explorer, dark neon" },
  { slug: "startup-2",   title: "SYNAPSE",      kind: "AI startup",            by: "Studio", d: "yj30CW74J7QK", img: "./img/made/startup-2.jpg",
    prompt: "Feature grid for an AI startup, dark neon green and blue" },
  { slug: "leaderboard-2", title: "Top Hoods",  kind: "Holder leaderboard",            by: "Studio", d: "Tdc9wzMjl1td", img: "./img/made/leaderboard-2.jpg",
    prompt: "Ranked holder table with wallet badges, dark neon" }
];

(function () {
  var KEY = "triump_pending_made";
  function find(slug) { return (window.TRIUMP_MADE || []).filter(function (m) { return m.slug === slug; })[0]; }
  window.triumpMadeFind = find;
  /* buka karya: wajib sign in dulu; setelah masuk langsung dibuka */
  window.triumpOpenMade = function (slug) {
    if (!find(slug)) return;
    if (window.TRIUMP_USER) { location.href = "made.html?d=" + encodeURIComponent(slug); return; }
    try { sessionStorage.setItem(KEY, slug); } catch (e) {}
    if (window.triumpSignIn) window.triumpSignIn();
  };
  window.addEventListener("triump:user", function (e) {
    var s = null; try { s = sessionStorage.getItem(KEY); } catch (err) {}
    if (e.detail && s) { try { sessionStorage.removeItem(KEY); } catch (err) {} location.href = "made.html?d=" + encodeURIComponent(s); }
  });
}());
