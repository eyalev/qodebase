import { createServer } from 'node:http';

const port = Number(process.env.PORT) || 3000;
createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end('<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><title>Forno da Vila</title><h1>Forno da Vila</h1><p>Coming soon.</p>');
}).listen(port, () => console.log(`listening on ${port}`));
