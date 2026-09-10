const API = 'https://api.dnyftech.workers.dev';
const counter = document.getElementById('req-counter');
let count = Math.floor(Math.random() * 4000) + 8000;
setInterval(() => {
  count += Math.floor(Math.random() * 12) + 1;
  counter.textContent = count.toLocaleString();
}, 600);
const dot  = document.getElementById('status-dot');
const text = document.getElementById('status-text');
async function ping() {
  try {
    const res = await fetch(API + '/api/health', { signal: AbortSignal.timeout(5000) });
    dot.className    = res.ok ? 'online' : 'offline';
    text.textContent = res.ok ? 'API Online' : 'API Error';
  } catch {
    dot.className    = 'offline';
    text.textContent = 'API Offline';
  }
}
ping();
setInterval(ping, 30000);
