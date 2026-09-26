// ════════════════════════════════════════════════════════════════
//  dnyftech API  —  Production Worker
//  Runtime : Cloudflare Workers (no npm, no bundler)
//  Base    : https://api.dnyftech.workers.dev
// ════════════════════════════════════════════════════════════════

const VERSION   = '2.0.0';
const API_BASE  = 'https://api.dnyftech.workers.dev';
const STARTED   = Date.now();

// ── CORS ─────────────────────────────────────────────────────────
const CORS_HEADERS = {
  'Access-Control-Allow-Origin':      '*',
  'Access-Control-Allow-Methods':     'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers':     'Content-Type, Authorization, X-API-Key, X-Request-ID',
  'Access-Control-Expose-Headers':    'X-Request-ID, X-Rate-Limit-Remaining',
  'Access-Control-Max-Age':           '86400',
};

// ── In-memory stores (swap with KV / D1 in production) ──────────
const DB = {
  users: [
    { id: 1,  name: 'Alice Johnson',   email: 'alice@dnyftech.com',  role: 'admin',   status: 'active',   createdAt: '2026-01-01T00:00:00Z' },
    { id: 2,  name: 'Bob Smith',       email: 'bob@dnyftech.com',    role: 'editor',  status: 'active',   createdAt: '2026-01-02T00:00:00Z' },
    { id: 3,  name: 'Charlie Davis',   email: 'charlie@dnyftech.com',role: 'viewer',  status: 'inactive', createdAt: '2026-01-03T00:00:00Z' },
    { id: 4,  name: 'Diana Prince',    email: 'diana@dnyftech.com',  role: 'editor',  status: 'active',   createdAt: '2026-01-04T00:00:00Z' },
    { id: 5,  name: 'Evan Taylor',     email: 'evan@dnyftech.com',   role: 'viewer',  status: 'active',   createdAt: '2026-01-05T00:00:00Z' },
  ],
  products: [
    { id: 1, name: 'Edge API Plan',    price: 29.99,  category: 'api',     stock: 999, status: 'active',   description: 'Serverless API hosting on Cloudflare Edge' },
    { id: 2, name: 'Pages Pro',        price: 19.99,  category: 'hosting', stock: 999, status: 'active',   description: 'Frontend hosting with CI/CD pipeline' },
    { id: 3, name: 'KV Storage 10GB', price: 9.99,   category: 'storage', stock: 500, status: 'active',   description: 'Edge key-value storage 10GB tier' },
    { id: 4, name: 'D1 Database',      price: 14.99,  category: 'storage', stock: 750, status: 'active',   description: 'SQLite-compatible edge database' },
    { id: 5, name: 'Stream CDN',       price: 49.99,  category: 'media',   stock: 200, status: 'active',   description: 'Video streaming and delivery network' },
    { id: 6, name: 'Zero Trust VPN',   price: 39.99,  category: 'security',stock: 300, status: 'active',   description: 'Secure network access for teams' },
  ],
  posts: [
    { id: 1, title: 'Getting Started with Cloudflare Workers', slug: 'getting-started-workers', body: 'Cloudflare Workers let you deploy serverless functions globally...', author: 1, tags: ['cloudflare','workers','serverless'], published: true,  views: 1240, createdAt: '2026-03-01T00:00:00Z' },
    { id: 2, title: 'Edge Computing in 2026',                  slug: 'edge-computing-2026',      body: 'Edge computing has transformed how we think about latency...', author: 2, tags: ['edge','computing','2026'],        published: true,  views: 980,  createdAt: '2026-03-15T00:00:00Z' },
    { id: 3, title: 'Building a REST API on the Edge',         slug: 'rest-api-edge',            body: 'Building REST APIs on the edge brings unique challenges...', author: 1, tags: ['api','rest','edge'],               published: true,  views: 2100, createdAt: '2026-04-01T00:00:00Z' },
    { id: 4, title: 'D1 Database Deep Dive',                   slug: 'd1-database-deep-dive',    body: 'Cloudflare D1 is a SQLite-compatible database running at edge...', author: 4, tags: ['d1','database','sql'],     published: false, views: 0,    createdAt: '2026-04-10T00:00:00Z' },
  ],
  orders: [
    { id: 1, userId: 1, productId: 1, quantity: 1, total: 29.99,  status: 'completed', createdAt: '2026-05-01T00:00:00Z' },
    { id: 2, userId: 2, productId: 2, quantity: 1, total: 19.99,  status: 'completed', createdAt: '2026-05-02T00:00:00Z' },
    { id: 3, userId: 1, productId: 3, quantity: 2, total: 19.98,  status: 'pending',   createdAt: '2026-05-10T00:00:00Z' },
    { id: 4, userId: 4, productId: 5, quantity: 1, total: 49.99,  status: 'processing',createdAt: '2026-06-01T00:00:00Z' },
  ],
  apiKeys: {
    'dnyftech-key-admin-001': { name: 'Admin Key',     role: 'admin',  active: true },
    'dnyftech-key-public-001':{ name: 'Public Key',    role: 'viewer', active: true },
  },
};

// Auto-increment counters
let nextId = { users: 6, products: 7, posts: 5, orders: 5 };

// Rate limit store  { ip: { count, resetAt } }
const rateLimits = {};
const RATE_LIMIT  = 100;   // requests
const RATE_WINDOW = 60000; // 1 minute ms

// ══════════════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════════════

function uid() {
  return Math.random().toString(36).slice(2, 10).toUpperCase();
}

function res(body, status, extra) {
  return new Response(JSON.stringify(body, null, 2), {
    status: status || 200,
    headers: Object.assign({
      'Content-Type':  'application/json',
      'X-Powered-By':  'dnyftech/' + VERSION,
    }, CORS_HEADERS, extra || {}),
  });
}

function ok(data, meta, status) {
  return res({ success: true, data: data, meta: meta || null, ts: new Date().toISOString() }, status || 200);
}

function err(message, code, status, details) {
  return res({ success: false, error: { code: code || 'ERROR', message: message, details: details || null }, ts: new Date().toISOString() }, status || 400);
}

function notFound(what) {
  return err((what || 'Resource') + ' not found', 'NOT_FOUND', 404);
}

function paginate(arr, page, limit) {
  var p   = Math.max(1, parseInt(page)  || 1);
  var l   = Math.min(100, parseInt(limit) || 10);
  var total = arr.length;
  var pages = Math.ceil(total / l);
  var start = (p - 1) * l;
  return {
    data: arr.slice(start, start + l),
    meta: { page: p, limit: l, total: total, pages: pages, hasNext: p < pages, hasPrev: p > 1 },
  };
}

function validate(obj, rules) {
  var errors = [];
  Object.keys(rules).forEach(function(key) {
    var rule = rules[key];
    var val  = obj[key];
    if (rule.required && (val === undefined || val === null || val === '')) {
      errors.push(key + ' is required');
    }
    if (val !== undefined && rule.type && typeof val !== rule.type) {
      errors.push(key + ' must be a ' + rule.type);
    }
    if (val !== undefined && rule.min && val.length < rule.min) {
      errors.push(key + ' must be at least ' + rule.min + ' characters');
    }
    if (val !== undefined && rule.max && val.length > rule.max) {
      errors.push(key + ' must be at most ' + rule.max + ' characters');
    }
    if (val !== undefined && rule.enum && !rule.enum.includes(val)) {
      errors.push(key + ' must be one of: ' + rule.enum.join(', '));
    }
    if (val !== undefined && rule.match && !rule.match.test(val)) {
      errors.push(key + ' format is invalid');
    }
  });
  return errors;
}

// ══════════════════════════════════════════════════════════════════
//  MIDDLEWARE
// ══════════════════════════════════════════════════════════════════

function checkRateLimit(ip, reqId) {
  var now = Date.now();
  if (!rateLimits[ip] || now > rateLimits[ip].resetAt) {
    rateLimits[ip] = { count: 0, resetAt: now + RATE_WINDOW };
  }
  rateLimits[ip].count++;
  var remaining = RATE_LIMIT - rateLimits[ip].count;
  if (remaining < 0) {
    return { limited: true, remaining: 0 };
  }
  return { limited: false, remaining: remaining };
}

function authenticate(request) {
  var auth   = request.headers.get('Authorization') || '';
  var apiKey = request.headers.get('X-API-Key')     || '';

  // API Key auth
  if (apiKey && DB.apiKeys[apiKey] && DB.apiKeys[apiKey].active) {
    return { ok: true, role: DB.apiKeys[apiKey].role, name: DB.apiKeys[apiKey].name };
  }
  // Bearer token (simple check — swap with JWT in production)
  if (auth.startsWith('Bearer ')) {
    var token = auth.slice(7);
    if (DB.apiKeys[token] && DB.apiKeys[token].active) {
      return { ok: true, role: DB.apiKeys[token].role, name: DB.apiKeys[token].name };
    }
  }
  return { ok: false };
}

function requireAuth(request) {
  var auth = authenticate(request);
  if (!auth.ok) {
    return { denied: true, response: err('Authentication required — provide X-API-Key or Bearer token', 'UNAUTHORIZED', 401) };
  }
  return { denied: false, auth: auth };
}

function requireAdmin(request) {
  var check = requireAuth(request);
  if (check.denied) return check;
  if (check.auth.role !== 'admin') {
    return { denied: true, response: err('Admin access required', 'FORBIDDEN', 403) };
  }
  return { denied: false, auth: check.auth };
}

// ══════════════════════════════════════════════════════════════════
//  ROUTER
// ══════════════════════════════════════════════════════════════════

addEventListener('fetch', function(event) {
  event.respondWith(handleRequest(event.request));
});

async function handleRequest(request) {
  var url    = new URL(request.url);
  var path   = url.pathname.replace(/\/$/, '') || '/';
  var method = request.method;
  var ip     = request.headers.get('CF-Connecting-IP') || 'unknown';
  var reqId  = uid();

  // Preflight
  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  // Rate limiting
  var rl = checkRateLimit(ip, reqId);
  if (rl.limited) {
    return err('Rate limit exceeded. Max ' + RATE_LIMIT + ' requests per minute.', 'RATE_LIMITED', 429, { retryAfter: 60 });
  }
  var rlHeaders = { 'X-Rate-Limit-Limit': String(RATE_LIMIT), 'X-Rate-Limit-Remaining': String(rl.remaining), 'X-Request-ID': reqId };

  try {
    var result = await route(request, method, path, url, reqId);
    // Inject rate limit headers
    var headers = Object.assign({}, CORS_HEADERS, rlHeaders);
    return new Response(result.body, { status: result.status, headers: Object.assign(JSON.parse(result.headersJson || '{}'), headers) });
  } catch(e) {
    console.error('[' + reqId + '] Error:', e.message);
    return res({ success: false, error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred', requestId: reqId }, ts: new Date().toISOString() }, 500, rlHeaders);
  }
}

// Wrap ok/err to carry headers
async function route(request, method, path, url, reqId) {
  var r = await dispatch(request, method, path, url, reqId);
  var text = await r.text();
  return { body: text, status: r.status, headersJson: JSON.stringify(Object.fromEntries(r.headers.entries())) };
}

async function dispatch(request, method, path, url, reqId) {
  var q = url.searchParams;

  // ── Root ────────────────────────────────────────────────────────
  if (path === '/' || path === '') {
    return ok({
      name:       'dnyftech API',
      version:    VERSION,
      runtime:    'Cloudflare Workers',
      base:       API_BASE,
      uptime:     Math.floor((Date.now() - STARTED) / 1000) + 's',
      endpoints: {
        root:     'GET  /',
        health:   'GET  /api/health',
        status:   'GET  /api/status',
        auth:     'POST /api/auth/login',
        users:    'GET  /api/users',
        products: 'GET  /api/products',
        posts:    'GET  /api/posts',
        orders:   'GET  /api/orders',
        search:   'GET  /api/search?q=',
        stats:    'GET  /api/stats',
        echo:     'POST /api/echo',
      },
    });
  }

  // ── Health ──────────────────────────────────────────────────────
  if (path === '/api/health') {
    return ok({
      status:   'ok',
      version:  VERSION,
      uptime:   Math.floor((Date.now() - STARTED) / 1000) + 's',
      region:   request.cf ? request.cf.colo : 'edge',
      ts:       new Date().toISOString(),
    });
  }

  // ── Status ──────────────────────────────────────────────────────
  if (path === '/api/status') {
    return ok({
      api:      { status: 'operational', latency: '<10ms' },
      database: { status: 'operational', type: 'in-memory' },
      cache:    { status: 'operational', type: 'edge' },
      cdn:      { status: 'operational', provider: 'Cloudflare' },
      services: [
        { name: 'API',      status: 'operational' },
        { name: 'Auth',     status: 'operational' },
        { name: 'Storage',  status: 'operational' },
        { name: 'CDN',      status: 'operational' },
      ],
      incidentUrl: API_BASE + '/api/status/incidents',
    });
  }

  // ── Auth: Login ─────────────────────────────────────────────────
  if (path === '/api/auth/login' && method === 'POST') {
    var body;
    try { body = await request.json(); } catch(e) { return err('Invalid JSON body', 'BAD_REQUEST', 400); }
    var errs = validate(body, {
      email:    { required: true, type: 'string', match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      password: { required: true, type: 'string', min: 6 },
    });
    if (errs.length) return err('Validation failed', 'VALIDATION_ERROR', 422, errs);
    // Demo: any valid email + password >= 6 chars logs in
    var user = DB.users.find(function(u) { return u.email === body.email; });
    if (!user) return err('Invalid credentials', 'INVALID_CREDENTIALS', 401);
    return ok({
      token:  'dnyftech-key-public-001',
      type:   'Bearer',
      user:   { id: user.id, name: user.name, email: user.email, role: user.role },
      expiresIn: 3600,
      note: 'Use this token as: Authorization: Bearer <token>',
    });
  }

  // ── Auth: Me ────────────────────────────────────────────────────
  if (path === '/api/auth/me') {
    var ac = requireAuth(request); if (ac.denied) return ac.response;
    return ok({ authenticated: true, name: ac.auth.name, role: ac.auth.role });
  }

  // ── Search ──────────────────────────────────────────────────────
  if (path === '/api/search') {
    var q2 = (q.get('q') || '').toLowerCase().trim();
    if (!q2) return err('Query parameter "q" is required', 'BAD_REQUEST', 400);
    var results = {
      users:    DB.users.filter(function(u)    { return u.name.toLowerCase().includes(q2) || u.email.toLowerCase().includes(q2); }),
      products: DB.products.filter(function(p) { return p.name.toLowerCase().includes(q2) || p.description.toLowerCase().includes(q2); }),
      posts:    DB.posts.filter(function(p)    { return p.title.toLowerCase().includes(q2) || p.body.toLowerCase().includes(q2); }),
    };
    var total = results.users.length + results.products.length + results.posts.length;
    return ok(results, { query: q2, total: total });
  }

  // ── Stats ───────────────────────────────────────────────────────
  if (path === '/api/stats') {
    var ac2 = requireAuth(request); if (ac2.denied) return ac2.response;
    var revenue = DB.orders.reduce(function(s, o) { return s + o.total; }, 0);
    return ok({
      users:    { total: DB.users.length, active: DB.users.filter(function(u) { return u.status === 'active'; }).length },
      products: { total: DB.products.length, active: DB.products.filter(function(p) { return p.status === 'active'; }).length },
      posts:    { total: DB.posts.length, published: DB.posts.filter(function(p) { return p.published; }).length, totalViews: DB.posts.reduce(function(s, p) { return s + p.views; }, 0) },
      orders:   { total: DB.orders.length, revenue: Math.round(revenue * 100) / 100, pending: DB.orders.filter(function(o) { return o.status === 'pending'; }).length },
    });
  }

  // ── Echo ────────────────────────────────────────────────────────
  if (path === '/api/echo') {
    if (method !== 'POST') return err('Method not allowed', 'METHOD_NOT_ALLOWED', 405);
    var body2; try { body2 = await request.json(); } catch(e) { return err('Invalid JSON body', 'BAD_REQUEST', 400); }
    return ok({ received: body2, method: method, headers: Object.fromEntries(request.headers.entries()), ts: new Date().toISOString() });
  }

  // ════════════════════════════════════════════════════════════════
  //  USERS  /api/users
  // ════════════════════════════════════════════════════════════════

  if (path === '/api/users' && method === 'GET') {
    var page  = q.get('page');
    var limit = q.get('limit');
    var role  = q.get('role');
    var status2 = q.get('status');
    var items = DB.users.slice();
    if (role)    items = items.filter(function(u) { return u.role    === role;    });
    if (status2) items = items.filter(function(u) { return u.status  === status2; });
    var paged = paginate(items, page, limit);
    return ok(paged.data, paged.meta);
  }

  if (path === '/api/users' && method === 'POST') {
    var ac3 = requireAdmin(request); if (ac3.denied) return ac3.response;
    var body3; try { body3 = await request.json(); } catch(e) { return err('Invalid JSON body', 'BAD_REQUEST', 400); }
    var errs3 = validate(body3, {
      name:  { required: true,  type: 'string', min: 2, max: 60 },
      email: { required: true,  type: 'string', match: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ },
      role:  { required: false, enum: ['admin','editor','viewer'] },
    });
    if (errs3.length) return err('Validation failed', 'VALIDATION_ERROR', 422, errs3);
    if (DB.users.find(function(u) { return u.email === body3.email; })) {
      return err('Email already exists', 'CONFLICT', 409);
    }
    var newUser = { id: nextId.users++, name: body3.name, email: body3.email, role: body3.role || 'viewer', status: 'active', createdAt: new Date().toISOString() };
    DB.users.push(newUser);
    return ok(newUser, null, 201);
  }

  var userMatch = path.match(/^\/api\/users\/(\d+)$/);
  if (userMatch) {
    var uid2 = Number(userMatch[1]);
    var user2 = DB.users.find(function(u) { return u.id === uid2; });

    if (method === 'GET') {
      if (!user2) return notFound('User');
      var userWithOrders = Object.assign({}, user2, { orders: DB.orders.filter(function(o) { return o.userId === uid2; }) });
      return ok(userWithOrders);
    }

    if (method === 'PUT' || method === 'PATCH') {
      var ac4 = requireAdmin(request); if (ac4.denied) return ac4.response;
      if (!user2) return notFound('User');
      var body4; try { body4 = await request.json(); } catch(e) { return err('Invalid JSON body', 'BAD_REQUEST', 400); }
      if (body4.name)   user2.name   = body4.name;
      if (body4.role)   user2.role   = body4.role;
      if (body4.status) user2.status = body4.status;
      user2.updatedAt = new Date().toISOString();
      return ok(user2);
    }

    if (method === 'DELETE') {
      var ac5 = requireAdmin(request); if (ac5.denied) return ac5.response;
      if (!user2) return notFound('User');
      DB.users = DB.users.filter(function(u) { return u.id !== uid2; });
      return ok({ deleted: true, id: uid2 });
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  PRODUCTS  /api/products
  // ════════════════════════════════════════════════════════════════

  if (path === '/api/products' && method === 'GET') {
    var items2  = DB.products.slice();
    var cat     = q.get('category');
    var maxPrice = q.get('maxPrice');
    var minPrice = q.get('minPrice');
    var sortBy   = q.get('sortBy') || 'id';
    if (cat)      items2 = items2.filter(function(p) { return p.category === cat; });
    if (minPrice) items2 = items2.filter(function(p) { return p.price >= parseFloat(minPrice); });
    if (maxPrice) items2 = items2.filter(function(p) { return p.price <= parseFloat(maxPrice); });
    items2.sort(function(a, b) {
      if (sortBy === 'price') return a.price - b.price;
      if (sortBy === '-price') return b.price - a.price;
      if (sortBy === 'name') return a.name.localeCompare(b.name);
      return a.id - b.id;
    });
    var paged2 = paginate(items2, q.get('page'), q.get('limit'));
    return ok(paged2.data, paged2.meta);
  }

  if (path === '/api/products' && method === 'POST') {
    var ac6 = requireAdmin(request); if (ac6.denied) return ac6.response;
    var body5; try { body5 = await request.json(); } catch(e) { return err('Invalid JSON body', 'BAD_REQUEST', 400); }
    var errs5 = validate(body5, {
      name:     { required: true,  type: 'string', min: 2 },
      price:    { required: true,  type: 'number' },
      category: { required: true,  type: 'string' },
    });
    if (errs5.length) return err('Validation failed', 'VALIDATION_ERROR', 422, errs5);
    var newProd = { id: nextId.products++, name: body5.name, price: body5.price, category: body5.category, stock: body5.stock || 0, status: 'active', description: body5.description || '' };
    DB.products.push(newProd);
    return ok(newProd, null, 201);
  }

  var prodMatch = path.match(/^\/api\/products\/(\d+)$/);
  if (prodMatch) {
    var pid  = Number(prodMatch[1]);
    var prod = DB.products.find(function(p) { return p.id === pid; });

    if (method === 'GET') {
      if (!prod) return notFound('Product');
      return ok(prod);
    }

    if (method === 'PUT' || method === 'PATCH') {
      var ac7 = requireAdmin(request); if (ac7.denied) return ac7.response;
      if (!prod) return notFound('Product');
      var body6; try { body6 = await request.json(); } catch(e) { return err('Invalid JSON body', 'BAD_REQUEST', 400); }
      if (body6.name        !== undefined) prod.name        = body6.name;
      if (body6.price       !== undefined) prod.price       = body6.price;
      if (body6.category    !== undefined) prod.category    = body6.category;
      if (body6.stock       !== undefined) prod.stock       = body6.stock;
      if (body6.status      !== undefined) prod.status      = body6.status;
      if (body6.description !== undefined) prod.description = body6.description;
      prod.updatedAt = new Date().toISOString();
      return ok(prod);
    }

    if (method === 'DELETE') {
      var ac8 = requireAdmin(request); if (ac8.denied) return ac8.response;
      if (!prod) return notFound('Product');
      DB.products = DB.products.filter(function(p) { return p.id !== pid; });
      return ok({ deleted: true, id: pid });
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  POSTS  /api/posts
  // ════════════════════════════════════════════════════════════════

  if (path === '/api/posts' && method === 'GET') {
    var items3  = DB.posts.slice();
    var pub     = q.get('published');
    var tag     = q.get('tag');
    var author  = q.get('author');
    if (pub    !== null && pub    !== undefined) items3 = items3.filter(function(p) { return String(p.published) === pub; });
    if (tag)   items3 = items3.filter(function(p) { return p.tags.includes(tag); });
    if (author) items3 = items3.filter(function(p) { return String(p.author) === author; });
    // Attach author info
    items3 = items3.map(function(p) {
      var auth2 = DB.users.find(function(u) { return u.id === p.author; });
      return Object.assign({}, p, { authorName: auth2 ? auth2.name : 'Unknown' });
    });
    var paged3 = paginate(items3, q.get('page'), q.get('limit'));
    return ok(paged3.data, paged3.meta);
  }

  if (path === '/api/posts' && method === 'POST') {
    var ac9 = requireAuth(request); if (ac9.denied) return ac9.response;
    var body7; try { body7 = await request.json(); } catch(e) { return err('Invalid JSON body', 'BAD_REQUEST', 400); }
    var errs7 = validate(body7, {
      title: { required: true, type: 'string', min: 3, max: 200 },
      body:  { required: true, type: 'string', min: 10 },
    });
    if (errs7.length) return err('Validation failed', 'VALIDATION_ERROR', 422, errs7);
    var newPost = { id: nextId.posts++, title: body7.title, slug: body7.title.toLowerCase().replace(/\s+/g, '-').replace(/[^\w-]/g, ''), body: body7.body, author: 1, tags: body7.tags || [], published: body7.published || false, views: 0, createdAt: new Date().toISOString() };
    DB.posts.push(newPost);
    return ok(newPost, null, 201);
  }

  var postMatch = path.match(/^\/api\/posts\/(\d+)$/);
  if (postMatch) {
    var postId  = Number(postMatch[1]);
    var post    = DB.posts.find(function(p) { return p.id === postId; });

    if (method === 'GET') {
      if (!post) return notFound('Post');
      post.views++;
      var auth3 = DB.users.find(function(u) { return u.id === post.author; });
      return ok(Object.assign({}, post, { authorName: auth3 ? auth3.name : 'Unknown' }));
    }

    if (method === 'PUT' || method === 'PATCH') {
      var ac10 = requireAuth(request); if (ac10.denied) return ac10.response;
      if (!post) return notFound('Post');
      var body8; try { body8 = await request.json(); } catch(e) { return err('Invalid JSON body', 'BAD_REQUEST', 400); }
      if (body8.title     !== undefined) { post.title = body8.title; post.slug = body8.title.toLowerCase().replace(/\s+/g,'-'); }
      if (body8.body      !== undefined) post.body      = body8.body;
      if (body8.tags      !== undefined) post.tags      = body8.tags;
      if (body8.published !== undefined) post.published = body8.published;
      post.updatedAt = new Date().toISOString();
      return ok(post);
    }

    if (method === 'DELETE') {
      var ac11 = requireAdmin(request); if (ac11.denied) return ac11.response;
      if (!post) return notFound('Post');
      DB.posts = DB.posts.filter(function(p) { return p.id !== postId; });
      return ok({ deleted: true, id: postId });
    }
  }

  // ════════════════════════════════════════════════════════════════
  //  ORDERS  /api/orders
  // ════════════════════════════════════════════════════════════════

  if (path === '/api/orders' && method === 'GET') {
    var ac12 = requireAuth(request); if (ac12.denied) return ac12.response;
    var items4  = DB.orders.slice();
    var uFilter = q.get('userId');
    var sFilter = q.get('status');
    if (uFilter) items4 = items4.filter(function(o) { return String(o.userId) === uFilter; });
    if (sFilter) items4 = items4.filter(function(o) { return o.status === sFilter; });
    // Enrich with user + product
    items4 = items4.map(function(o) {
      var u = DB.users.find(function(u2) { return u2.id === o.userId; });
      var p = DB.products.find(function(p2) { return p2.id === o.productId; });
      return Object.assign({}, o, { userName: u ? u.name : 'Unknown', productName: p ? p.name : 'Unknown' });
    });
    var paged4 = paginate(items4, q.get('page'), q.get('limit'));
    return ok(paged4.data, paged4.meta);
  }

  if (path === '/api/orders' && method === 'POST') {
    var ac13 = requireAuth(request); if (ac13.denied) return ac13.response;
    var body9; try { body9 = await request.json(); } catch(e) { return err('Invalid JSON body', 'BAD_REQUEST', 400); }
    var errs9 = validate(body9, {
      userId:    { required: true, type: 'number' },
      productId: { required: true, type: 'number' },
      quantity:  { required: true, type: 'number' },
    });
    if (errs9.length) return err('Validation failed', 'VALIDATION_ERROR', 422, errs9);
    var prod2 = DB.products.find(function(p) { return p.id === body9.productId; });
    if (!prod2) return notFound('Product');
    if (prod2.stock < body9.quantity) return err('Insufficient stock', 'OUT_OF_STOCK', 400);
    prod2.stock -= body9.quantity;
    var newOrder = { id: nextId.orders++, userId: body9.userId, productId: body9.productId, quantity: body9.quantity, total: Math.round(prod2.price * body9.quantity * 100) / 100, status: 'pending', createdAt: new Date().toISOString() };
    DB.orders.push(newOrder);
    return ok(newOrder, null, 201);
  }

  var orderMatch = path.match(/^\/api\/orders\/(\d+)$/);
  if (orderMatch) {
    var oid   = Number(orderMatch[1]);
    var order = DB.orders.find(function(o) { return o.id === oid; });

    if (method === 'GET') {
      var ac14 = requireAuth(request); if (ac14.denied) return ac14.response;
      if (!order) return notFound('Order');
      var u2 = DB.users.find(function(u3) { return u3.id === order.userId; });
      var p2 = DB.products.find(function(p3) { return p3.id === order.productId; });
      return ok(Object.assign({}, order, { user: u2 || null, product: p2 || null }));
    }

    if (method === 'PATCH') {
      var ac15 = requireAdmin(request); if (ac15.denied) return ac15.response;
      if (!order) return notFound('Order');
      var body10; try { body10 = await request.json(); } catch(e) { return err('Invalid JSON', 'BAD_REQUEST', 400); }
      var allowed = ['pending','processing','completed','cancelled'];
      if (body10.status && !allowed.includes(body10.status)) return err('Invalid status. Use: ' + allowed.join(', '), 'BAD_REQUEST', 400);
      if (body10.status) order.status = body10.status;
      order.updatedAt = new Date().toISOString();
      return ok(order);
    }
  }

  // ── 404 ─────────────────────────────────────────────────────────
  return err('Route not found: ' + method + ' ' + path, 'NOT_FOUND', 404, {
    hint: 'See GET / for available endpoints',
  });
}
