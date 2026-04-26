const http = require('http');

setTimeout(() => {
  http.get('http://localhost:3001/api/health', (res) => {
    console.log('Health check status:', res.statusCode);
  });
}, 2000);
