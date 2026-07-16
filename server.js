const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT) || 5173;
const ROOT = path.resolve(__dirname);
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml"
};

http.createServer((request, response) => {
  if (!["GET", "HEAD"].includes(request.method)) {
    send(response, 405, "Method not allowed");
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(new URL(request.url, `http://localhost:${PORT}`).pathname);
  } catch {
    send(response, 400, "Bad request");
    return;
  }

  const relativePath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
  const filePath = path.resolve(ROOT, relativePath);
  if (filePath !== ROOT && !filePath.startsWith(`${ROOT}${path.sep}`)) {
    send(response, 403, "Forbidden");
    return;
  }

  fs.readFile(filePath, (error, data) => {
    if (error || !fs.statSync(filePath).isFile()) {
      send(response, 404, "Not found");
      return;
    }
    response.writeHead(200, {
      "Content-Type": MIME[path.extname(filePath)] || "application/octet-stream",
      "Cache-Control": "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin"
    });
    response.end(request.method === "HEAD" ? undefined : data);
  });
}).listen(PORT, () => {
  console.log(`Live Flight Tracker running at http://localhost:${PORT}`);
});

function send(response, status, message) {
  response.writeHead(status, { "Content-Type": "text/plain; charset=utf-8", "X-Content-Type-Options": "nosniff" });
  response.end(message);
}
