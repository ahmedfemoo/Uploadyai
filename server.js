const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const PI_SERVER_API_KEY = process.env.PI_SERVER_API_KEY || "";
const PI_API_BASE = process.env.PI_API_BASE || "https://api.minepi.com/v2";

function sendJson(res, statusCode, obj) {
  const payload = JSON.stringify(obj);
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "Content-Length": Buffer.byteLength(payload) });
  res.end(payload);
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", chunk => body += chunk);
    req.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } 
      catch (e) { reject(new Error("Invalid JSON")); }
    });
    req.on("error", reject);
  });
}

function piRequest(method, apiPath, bodyObj) {
  if (!PI_SERVER_API_KEY) throw new Error("PI_SERVER_API_KEY is not set");
  const url = new URL(PI_API_BASE + apiPath);
  const body = bodyObj ? JSON.stringify(bodyObj) : "";
  const options = {
    method,
    hostname: url.hostname,
    path: url.pathname + url.search,
    headers: {
      Authorization: `Key ${PI_SERVER_API_KEY}`,
      Accept: "application/json",
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body)
    }
  };
  return new Promise((resolve, reject) => {
    const r = https.request(options, resp => {
      let data = "";
      resp.on("data", chunk => data += chunk);
      resp.on("end", () => {
        let parsed;
        try { parsed = data ? JSON.parse(data) : null; } catch { parsed = data; }
        if (resp.statusCode >= 200 && resp.statusCode < 300) resolve(parsed);
        else reject({ statusCode: resp.statusCode, response: parsed });
      });
    });
    r.on("error", reject);
    if (body) r.write(body);
    r.end();
  });
}

async function handlePayment(req, res, action) {
  try {
    const body = await readJsonBody(req);
    const paymentId = body?.paymentId;
    const txid = body?.txid;
    if (!paymentId) return sendJson(res, 400, { error: "paymentId is required" });

    let result;
    if (action === "approve") result = await piRequest("POST", `/payments/${encodeURIComponent(paymentId)}/approve`);
    else if (action === "complete") {
      if (!txid) return sendJson(res, 400, { error: "txid is required" });
      result = await piRequest("POST", `/payments/${encodeURIComponent(paymentId)}/complete`, { txid });
    }
    else if (action === "cancel") result = await piRequest("POST", `/payments/${encodeURIComponent(paymentId)}/cancel`);
    
    sendJson(res, 200, result);
  } catch (err) {
    sendJson(res, 502, { error: `Pi API ${action} failed`, message: err?.message || "Unknown", response: err?.response || null });
  }
}

function serveIndex(res) {
  const filePath = path.join(__dirname, "index.html");
  fs.readFile(filePath, (err, content) => {
    if (err) { res.writeHead(500, {"Content-Type":"text/plain"}); res.end("Failed to read index.html"); return; }
    res.writeHead(200, {"Content-Type":"text/html; charset=utf-8"});
    res.end(content);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${req.headers.host}`);
  if (req.method === "GET" && (url.pathname === "/" || url.pathname === "/index.html")) { serveIndex(res); return; }
  if (req.method === "POST" && url.pathname === "/payment/approve") await handlePayment(req, res, "approve");
  else if (req.method === "POST" && url.pathname === "/payment/complete") await handlePayment(req, res, "complete");
  else if (req.method === "POST" && url.pathname === "/payment/cancel") await handlePayment(req, res, "cancel");
  else sendJson(res, 404, { error: "Not found" });
});

server.listen(PORT, () => console.log(`Pi Payment server running on port ${PORT}`));
