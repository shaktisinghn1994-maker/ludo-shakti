/* Cloudflare Worker entry: serves the static game and routes /room/<code> to
   one Durable Object per room. Keeping the game files static means the page
   loads exactly as before — only room traffic touches the Worker. */

import { Room } from './room.js';

const BUILD = 'online-3';
const CODE_RE = /^[A-Z0-9]{4,8}$/;

export { Room };

export default {
  async fetch (request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    if (path === '/build') {
      return new Response(JSON.stringify({ v: BUILD, rooms: true }), {
        headers: { 'content-type': 'application/json', 'cache-control': 'no-store' }
      });
    }

    if (path.indexOf('/room/') === 0) {
      const code = path.slice(6).split('?')[0].split('/')[0].toUpperCase();
      if (!CODE_RE.test(code)) return new Response('Bad room code', { status: 400 });
      if (!env.ROOM) return new Response('Rooms are unavailable', { status: 503 });
      return env.ROOM.get(env.ROOM.idFromName(code)).fetch(request);
    }

    if (env.ASSETS) return env.ASSETS.fetch(request);
    return new Response('Not found', { status: 404 });
  }
};
