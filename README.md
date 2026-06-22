# Mundial 2026 · Centro de Pronósticos y Estadísticas en Vivo

Dashboard de una sola página para el Mundial 2026 con **datos en vivo de API-Football** sobre **Vercel**. Resultados, posiciones con lógica de clasificación, goleadores, detalle por partido y un bracket que se llena solo, más un motor de pronósticos que se recalcula con la forma real y las estadísticas de cada equipo.

> Si nunca conectas la API, la página igual funciona: usa un respaldo embebido (datos al 19 de junio de 2026) en "modo sin conexión". La conexión en vivo añade la actualización automática y todas las estadísticas.

---

## Qué incluye

- **Tabla de pronósticos** 1-X-2 por partido, marcador estimado y nivel de confianza. Se recalcula en vivo.
- **Posiciones de los 12 grupos** con clasificación automática: 1.º, 2.º y los **8 mejores terceros** (badges por equipo).
- **Goleadores**: artilleros del torneo con goles, asistencias, tiros, penales y partidos (`/players/topscorers`).
- **Detalle por partido** (modal): estadísticas (posesión, tiros, tiros al arco, córners, fueras de lugar, faltas, tarjetas, atajadas), eventos (goles/tarjetas con minuto y asistencia) y alineaciones (titulares, formación, DT, suplentes).
- **Camino al título**: bracket que muestra los **clasificados proyectados** durante la fase de grupos y se completa con los **resultados reales** de eliminación cuando empiezan.
- **Motor de pronósticos avanzado**: mezcla valoración de experto + forma (puntos y diferencia de gol) + **estadísticas de partido** (tiros al arco, córners, tarjetas, posesión). Las stats que cargas al abrir un partido alimentan el modelo y afinan las siguientes predicciones.

---

## Arquitectura

```
mundial-2026-dashboard-vercel/
├── index.html        ← dashboard completo (frontend + motor + respaldo)
├── api/
│   ├── data.js       ← serverless: fixtures + standings + goleadores (oculta tu API key)
│   └── match.js      ← serverless: detalle de UN partido bajo demanda (eventos, alineaciones, stats)
├── package.json      ← marca el proyecto como ESM ("type":"module")
├── vercel.json       ← caché del HTML
├── .gitignore
├── .env.example
└── README.md
```

- El navegador **nunca** ve tu API key. Pide datos a `/api/data` y `/api/match`; esas funciones son las únicas que hablan con API-Football usando la clave guardada como variable de entorno en Vercel.
- Caché en la CDN de Vercel (`s-maxage`) para no agotar la cuota del plan gratuito.
- El detalle por partido se pide **solo al abrir** una tarjeta, y se cachea en el navegador (localStorage) — así se gasta poca cuota.
- Vercel detecta todo solo: sirve `index.html` en `/` y convierte `api/*.js` en rutas `/api/...`. **Sin paso de build.**

---

## Variables de entorno (en Vercel → Settings → Environment Variables)

| Nombre          | Valor              | Obligatoria |
|-----------------|--------------------|-------------|
| `APISPORTS_KEY` | tu clave real      | **Sí**      |
| `WC_LEAGUE`     | `1`                | opcional    |
| `WC_SEASON`     | `2026`             | opcional    |
| `CACHE_TTL`     | `600`              | opcional    |

> ¿RapidAPI en vez de api-sports.io directo? Agrega `APISPORTS_HOST = api-football-v1.p.rapidapi.com` y `APISPORTS_RAPIDAPI = 1`.

Tras agregar o cambiar variables, **vuelve a desplegar** (Redeploy) para que tomen efecto.

---

## Publicar (este repo ya está conectado a Vercel)

El repositivo `mundial2026` ya está conectado a Vercel, así que **cada push a `main` redespliega solo**. Para publicar esta versión:

```bash
git add .
git commit -m "Dashboard en vivo: stats, goleadores, detalle por partido, clasificación"
git push
```

O con GitHub Desktop: **Commit to main → Push origin**. En ~1 minuto Vercel publica la nueva versión.

---

## Cuota del plan gratuito

El plan Free de API-Football da **100 peticiones/día**. `/api/data` usa 3 llamadas por refresco (cacheadas `CACHE_TTL` seg en la CDN). El detalle por partido usa 3 llamadas más, solo cuando alguien abre un partido, y se cachea. Con tráfico moderado te mantienes dentro del límite. ¿Mucho tráfico? Sube `CACHE_TTL` o el plan de API-Football.

---

## Verificar tu plan (1 minuto)

```bash
curl -s "https://v3.football.api-sports.io/fixtures?league=1&season=2026" \
  -H "x-apisports-key: TU_CLAVE" | head -c 400
```

Si ves partidos → la liga del Mundial es la **1** y la temporada **2026**. Si ves `"results":0`, busca el ID con `/leagues?search=World Cup` y ajusta `WC_LEAGUE`/`WC_SEASON`. Algunos planes gratuitos limitan ciertos datos.

---

Hecho para seguir el Mundial 2026 · datos en vivo vía API-Football sobre Vercel · los pronósticos son estimaciones del modelo y no garantizan resultados.
