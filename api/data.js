/**
 * Vercel Serverless Function — /api/data
 * --------------------------------------
 * Proxy a API-Football (api-sports.io). La API key vive como variable de
 * entorno en Vercel (Project Settings → Environment Variables); el navegador
 * NUNCA la ve. La respuesta se cachea en la CDN de Vercel (s-maxage) para no
 * agotar la cuota del plan gratuito.
 *
 * Devuelve en UNA sola respuesta: fixtures + standings + goleadores.
 * El detalle por partido (alineaciones, eventos, estadísticas) se pide aparte
 * a /api/match?id=... bajo demanda, para no gastar cuota sin necesidad.
 *
 * Variables de entorno (configúralas en Vercel):
 *   APISPORTS_KEY      (OBLIGATORIA, secreta)  tu clave de API-Football
 *   WC_LEAGUE          (opcional, def "1")      ID de liga del Mundial
 *   WC_SEASON          (opcional, def "2026")   temporada
 *   APISPORTS_HOST     (opcional, def "v3.football.api-sports.io")
 *   APISPORTS_RAPIDAPI (opcional, "1" si usas la variante RapidAPI)
 *   CACHE_TTL          (opcional, def "600")    segundos de caché en la CDN
 */

export default async function handler(req, res) {
  const KEY = process.env.APISPORTS_KEY;
  const LEAGUE = process.env.WC_LEAGUE || "1";
  const SEASON = process.env.WC_SEASON || "2026";
  const HOST = process.env.APISPORTS_HOST || "v3.football.api-sports.io";
  const TTL = parseInt(process.env.CACHE_TTL || "600", 10);

  res.setHeader("content-type", "application/json; charset=utf-8");

  // Sin clave: el dashboard usará su respaldo embebido (modo sin conexión).
  if (!KEY) {
    res.setHeader("cache-control", "public, max-age=30");
    return res.status(200).send(JSON.stringify({ ok: false, error: "missing_key", fixtures: [], standings: [], scorers: [] }));
  }

  const headers = {};
  if (process.env.APISPORTS_RAPIDAPI === "1") {
    headers["x-rapidapi-key"] = KEY;
    headers["x-rapidapi-host"] = HOST;
  } else {
    headers["x-apisports-key"] = KEY;
  }

  try {
    const base = `https://${HOST}`;
    // 3 llamadas en paralelo. topscorers puede no existir en algunos planes;
    // se maneja de forma tolerante (si falla, se devuelve [] sin romper nada).
    const [fxRes, stRes, scRes] = await Promise.all([
      fetch(`${base}/fixtures?league=${LEAGUE}&season=${SEASON}`, { headers }),
      fetch(`${base}/standings?league=${LEAGUE}&season=${SEASON}`, { headers }),
      fetch(`${base}/players/topscorers?league=${LEAGUE}&season=${SEASON}`, { headers }).catch(() => null),
    ]);

    const fxJson = await safeJson(fxRes);
    const stJson = await safeJson(stRes);
    const scJson = scRes ? await safeJson(scRes) : {};

    const fixtures = Array.isArray(fxJson.response) ? fxJson.response.map(simplifyFixture) : [];
    const standings = extractStandings(stJson);
    const scorers = extractScorers(scJson);
    const errors = collectErrors(fxJson, stJson, scJson);

    const payload = {
      ok: fixtures.length > 0,
      ts: Date.now(),
      league: LEAGUE,
      season: SEASON,
      counts: { fixtures: fixtures.length, standings: standings.length, scorers: scorers.length },
      errors,
      fixtures,
      standings,
      scorers,
    };

    // Si hay algún partido en vivo, cachea muy poco en el CDN para que el marcador
    // se actualice casi en tiempo real (el CDN sigue agrupando peticiones, así que
    // la cuota de la API se mantiene protegida). Sin partidos en vivo, caché normal.
    const LIVE_TTL = parseInt(process.env.CACHE_TTL_LIVE || "25", 10);
    const LIVE_CODES = ["1H", "HT", "2H", "ET", "BT", "P", "LIVE", "INT", "SUSP"];
    const hasLive = fixtures.some(f => LIVE_CODES.includes(String(f.status || "").toUpperCase()));
    const effTTL = hasLive ? Math.min(LIVE_TTL, TTL) : TTL;
    const cc = fixtures.length > 0
      ? `public, max-age=0, s-maxage=${effTTL}, stale-while-revalidate=${effTTL * 2}`
      : "public, max-age=30";
    res.setHeader("cache-control", cc);
    return res.status(200).send(JSON.stringify(payload));
  } catch (e) {
    res.setHeader("cache-control", "public, max-age=30");
    return res.status(200).send(JSON.stringify({ ok: false, error: "upstream_error", detail: String(e), fixtures: [], standings: [], scorers: [] }));
  }
}

/* ---------- helpers ---------- */

function simplifyFixture(f) {
  return {
    id: f?.fixture?.id ?? null,
    date: f?.fixture?.date ?? null,
    status: f?.fixture?.status?.short ?? "NS",
    elapsed: f?.fixture?.status?.elapsed ?? null,
    round: f?.league?.round ?? "",
    venueCity: f?.fixture?.venue?.city ?? null,
    venueName: f?.fixture?.venue?.name ?? null,
    home: f?.teams?.home?.name ?? null,
    homeId: f?.teams?.home?.id ?? null,
    away: f?.teams?.away?.name ?? null,
    awayId: f?.teams?.away?.id ?? null,
    hg: f?.goals?.home ?? null,
    ag: f?.goals?.away ?? null,
  };
}

function extractStandings(stJson) {
  const out = [];
  const leagues = stJson?.response;
  if (!Array.isArray(leagues)) return out;
  for (const lg of leagues) {
    const groups = lg?.league?.standings;
    if (!Array.isArray(groups)) continue;
    for (const grp of groups) {
      if (!Array.isArray(grp)) continue;
      for (const row of grp) {
        out.push({
          group: row?.group ?? "",
          team: row?.team?.name ?? null,
          teamId: row?.team?.id ?? null,
          rank: row?.rank ?? null,
          played: row?.all?.played ?? 0,
          win: row?.all?.win ?? 0,
          draw: row?.all?.draw ?? 0,
          lose: row?.all?.lose ?? 0,
          gf: row?.all?.goals?.for ?? 0,
          ga: row?.all?.goals?.against ?? 0,
          points: row?.points ?? 0,
        });
      }
    }
  }
  return out;
}

function extractScorers(scJson) {
  const out = [];
  const arr = scJson?.response;
  if (!Array.isArray(arr)) return out;
  for (const p of arr) {
    const player = p?.player || {};
    const stat = (Array.isArray(p?.statistics) && p.statistics[0]) || {};
    out.push({
      name: player?.name ?? null,
      playerId: player?.id ?? null,
      photo: player?.photo ?? null,
      age: player?.age ?? null,
      nationality: player?.nationality ?? null,
      team: stat?.team?.name ?? null,
      teamId: stat?.team?.id ?? null,
      goals: stat?.goals?.total ?? 0,
      assists: stat?.goals?.assists ?? 0,
      shots: stat?.shots?.total ?? null,
      shotsOn: stat?.shots?.on ?? null,
      minutes: stat?.games?.minutes ?? null,
      appearances: stat?.games?.appearences ?? null,
      penalties: stat?.penalty?.scored ?? null,
      yellow: stat?.cards?.yellow ?? null,
      red: stat?.cards?.red ?? null,
    });
  }
  return out;
}

function collectErrors(...jsons) {
  const errs = [];
  for (const j of jsons) {
    if (!j) continue;
    if (Array.isArray(j.errors) && j.errors.length) errs.push(...j.errors);
    else if (j.errors && typeof j.errors === "object" && Object.keys(j.errors).length) {
      for (const k in j.errors) errs.push(`${k}: ${j.errors[k]}`);
    }
  }
  return errs;
}

async function safeJson(r) {
  try { return await r.json(); } catch { return {}; }
}
