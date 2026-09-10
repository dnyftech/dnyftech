const CORS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const users = [
  { id: 1, name: 'Alice',   role: 'admin'  },
  { id: 2, name: 'Bob',     role: 'editor' },
  { id: 3, name: 'Charlie', role: 'viewer' },
];

function json(data, status) {
  return new Response(JSON.stringify(data, null, 2), {
    status: status || 200,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS),
  });
}

addEventListener('fetch', function(event) {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  var url    = new URL(request.url);
  var path   = url.pathname;
  var method = request.method;

  if (method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (path === '/') return json({ name: 'dnyftech API', version: '1.0.0', runtime: 'Cloudflare Workers', base: 'https://api.dnyftech.workers.dev' });
  if (path === '/api/health') return json({ status: 'ok', ts: new Date().toISOString() });
  if (path === '/api/users') return json(users);

  var m = path.match(/^\/api\/users\/(\d+)$/);
  if (m) {
    var user = users.filter(function(u) { return u.id === Number(m[1]); })[0];
    return user ? json(user) : json({ error: 'User not found' }, 404);
  }

  if (path === '/api/echo' && method === 'POST') {
    try {
      var body = await request.json();
      return json({ received: body, ts: new Date().toISOString() });
    } catch(e) {
      return json({ error: 'Invalid JSON body' }, 400);
    }
  }

  return json({ error: 'Route not found: ' + method + ' ' + path }, 404);
}
