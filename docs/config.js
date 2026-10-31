export const RELAY_URL = location.hostname === 'localhost'
  ? 'http://localhost:8787'
  : 'https://note-reader-relay.yabon3.workers.dev';
