// Proxy da Google Agenda para o app Estúdio (Cloudflare Worker gratuito).
// O Google não deixa o app ler o endereço iCal direto; este script busca a agenda
// e entrega ao app. O endereço secreto da agenda fica guardado no Cloudflare,
// nunca dentro do app.
//
// Variáveis a configurar no Cloudflare (Settings > Variables and Secrets):
//   ICAL_URL  (obrigatória) endereço secreto no formato iCal da agenda
//   TOKEN     (recomendada) uma senha qualquer; o app envia como ?t=SENHA

export default {
  async fetch(request, env) {
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': '*'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });

    const url = new URL(request.url);
    if (env.TOKEN && url.searchParams.get('t') !== env.TOKEN) {
      return new Response('Senha incorreta', { status: 403, headers: cors });
    }
    if (!env.ICAL_URL) {
      return new Response('Variável ICAL_URL não configurada', { status: 500, headers: cors });
    }

    const upstream = await fetch(env.ICAL_URL, { cf: { cacheTtl: 300, cacheEverything: true } });
    if (!upstream.ok) {
      return new Response('Erro ao buscar a agenda: ' + upstream.status, { status: 502, headers: cors });
    }
    return new Response(await upstream.text(), {
      headers: { ...cors, 'Content-Type': 'text/calendar; charset=utf-8', 'Cache-Control': 'no-store' }
    });
  }
};
