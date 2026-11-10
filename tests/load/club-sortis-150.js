import http from 'k6/http';
import { check, sleep } from 'k6';

const FRONTEND_URL = __ENV.FRONTEND_URL || 'https://club-sortis.vercel.app';
const API_URL = __ENV.API_URL || 'https://clubsortis-1.onrender.com';

export const options = {
  discardResponseBodies: true,
  scenarios: {
    viewers: {
      executor: 'ramping-vus',
      exec: 'viewer',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 50 },
        { duration: '30s', target: 150 },
        { duration: '2m', target: 150 },
        { duration: '20s', target: 0 },
      ],
      gracefulRampDown: '0s',
    },
    health_probe: {
      executor: 'constant-vus',
      exec: 'healthProbe',
      vus: 1,
      duration: '3m20s',
    },
  },
  thresholds: {
    checks: ['rate>0.99'],
    'http_req_failed{kind:page}': ['rate<0.01'],
    'http_req_duration{kind:page}': ['p(95)<3000'],
    'http_req_failed{kind:health}': ['rate<0.01'],
    'http_req_duration{kind:health}': ['p(95)<2000'],
  },
  userAgent: 'ClubSortis-k6-capacity-test/1.0',
};

export function viewer() {
  const responses = http.batch([
    ['GET', `${FRONTEND_URL}/`, null, { tags: { kind: 'page' } }],
    ['GET', `${FRONTEND_URL}/style.css`, null, { tags: { kind: 'page' } }],
    ['GET', `${FRONTEND_URL}/app.js`, null, { tags: { kind: 'page' } }],
    ['GET', `${FRONTEND_URL}/config.js`, null, { tags: { kind: 'page' } }],
    ['GET', `${FRONTEND_URL}/gran-sorteo.png`, null, { tags: { kind: 'page' } }],
  ]);

  check(responses[0], {
    'la pagina publica responde 200': (response) => response.status === 200,
  });

  // Esta solicitud queda abierta, igual que EventSource en los navegadores reales.
  http.get(`${API_URL}/events`, {
    headers: { Origin: FRONTEND_URL },
    timeout: '4m',
    tags: { kind: 'sse' },
  });
}

export function healthProbe() {
  const response = http.get(`${API_URL}/healthz`, {
    timeout: '10s',
    tags: { kind: 'health' },
  });

  check(response, {
    'backend saludable durante la carga': (res) => res.status === 200,
  });
  sleep(2);
}
