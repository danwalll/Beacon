#!/usr/bin/env node
const http = require("http");

const state = process.argv[2] || "done";
const source = process.argv[3] || "cursor";
const port = Number(process.env.AGENT_BEACON_PORT || 17373);
const body = JSON.stringify({ state, source });

const req = http.request(
  {
    hostname: "127.0.0.1",
    port,
    path: "/status",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
    },
    timeout: 2000,
  },
  (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      console.log(data || `HTTP ${res.statusCode}`);
      if (res.statusCode >= 400) process.exit(1);
    });
  }
);

req.on("error", (err) => {
  console.error(
    `Could not reach Beacon on port ${port}. Is it running? (${err.message})`
  );
  process.exit(1);
});

req.end(body);
