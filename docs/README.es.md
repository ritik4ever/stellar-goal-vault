# Stellar Goal Vault

[English](../README.md) | [Español](README.es.md) | [Português](README.pt.md)

> Esta traducción puede quedar desactualizada hasta una versión después de la edición en inglés más reciente.

## Descripción general

Stellar Goal Vault es una aplicación ligera de financiación colectiva para el ecosistema Stellar. Permite que los creadores publiquen campañas y que los colaboradores aporten fondos hasta una fecha límite.

- El panel de React permite crear y administrar campañas.
- La API de Node.js y Express usa SQLite para guardar campañas, aportes e historial de eventos.
- El contrato de Soroban incluye operaciones para crear campañas, aportar, reclamar fondos y reembolsar aportes.
- Las campañas pueden aceptar varios activos de Stellar.

Si una campaña alcanza su objetivo, el creador puede reclamar los fondos. Si no lo alcanza antes de la fecha límite, los colaboradores pueden solicitar el reembolso de sus aportes.

## Inicio rápido

### Requisitos

- Node.js 18 o posterior
- npm 9 o posterior
- Opcional para trabajar con contratos: Rust y las herramientas de Soroban

Desde la raíz del repositorio, instala las dependencias e inicia la API y el panel en terminales separadas:

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
```

Abre el panel en `http://localhost:3000`. La API local está disponible en `http://localhost:3001`.

Para iniciar los servicios con Docker y recarga en caliente:

```bash
docker compose up --build
```

## Referencia de la API

La URL base de la API local es `http://localhost:3001`; el panel usa el proxy `/api`.

### `GET /api/health`

Comprueba el estado del servicio y la conexión con la base de datos.

```json
{
  "service": "stellar-goal-vault-backend",
  "status": "ok",
  "timestamp": "2026-03-27T21:30:00.000Z",
  "uptimeSeconds": 12.345,
  "database": { "status": "up", "reachable": true }
}
```

`status` es `ok` si la API y la base de datos responden; de lo contrario, es `degraded`. `database.status` puede ser `up` o `down`.

### `GET /api/stats`

Devuelve métricas agregadas de campañas y aportes. La respuesta se almacena en caché durante 60 segundos; el encabezado `X-Cache` indica `HIT` o `MISS`. No requiere autenticación.

### `GET /api/campaigns`

Devuelve todas las campañas con el progreso calculado. Parámetros de consulta opcionales:

- `q`: busca por título, creador o ID de campaña, sin distinguir mayúsculas.
- `asset`: filtra por código de activo, como `USDC` o `XLM`.
- `status`: filtra por estado: `open`, `funded`, `claimed` o `failed`.

### `GET /api/campaigns/:id`

Devuelve una campaña con sus aportes y el historial de eventos.

### `GET /api/campaigns/:id/pledges`

Devuelve los aportes con metadatos de paginación. Los parámetros opcionales `page` y `limit` controlan el número de página y los resultados por página.

### `POST /api/campaigns`

Crea una campaña. El cuerpo incluye `creator`, `title`, `description`, `assetCode`, `targetAmount` y `deadline`. `maxPerContributor` es opcional y limita el total que puede aportar una persona; también se puede configurar globalmente con `DEFAULT_MAX_PER_CONTRIBUTOR`.

### `POST /api/campaigns/:id/pledges`

Registra un aporte a una campaña activa. El cuerpo incluye `contributor`, `amount` y `assetCode`. El encabezado opcional `Idempotency-Key` evita crear aportes duplicados; las respuestas en caché incluyen `X-Idempotency-Cache` con `HIT` o `MISS`.

### `POST /api/campaigns/:id/pledges/reconcile`

Registra localmente un aporte confirmado en la cadena. El cuerpo incluye `contributor`, `amount`, `transactionHash` y, opcionalmente, `confirmedAt`.

### `POST /api/campaigns/:id/claim`

Reclama una campaña financiada después de la fecha límite. El cuerpo incluye `creator`.

### `POST /api/campaigns/:id/refund`

Reembolsa los aportes activos de una persona en una campaña fallida. El cuerpo incluye `contributor`.

### `GET /api/campaigns/:id/history`

Obtiene el historial local de eventos de la campaña.

### `GET /api/campaigns/:id/contributors`

Devuelve un resumen por colaborador, con el total aportado, el importe reembolsado y si el reembolso se completó. Las campañas sin aportes devuelven `{"data": []}`; los IDs no válidos devuelven 404.

### `GET /api/open-issues`

Devuelve ideas de issues para contribuir al proyecto de código abierto.

La referencia completa está en [docs/API.md](./API.md) y la especificación en [docs/openapi.yaml](./openapi.yaml).

## Contribuir

1. Haz un fork del repositorio y clónalo.
2. Instala las dependencias con `npm run install:all`.
3. Crea una rama para tus cambios, por ejemplo `feature/mi-mejora`.
4. Realiza los cambios y ejecuta las comprobaciones adecuadas para ellos.
5. Crea un commit con el formato Conventional Commits, por ejemplo `feat: add new endpoint`.
6. Sube la rama y abre un pull request dirigido a `main`.

Lee la [guía de contribución](../CONTRIBUTING.md) antes de empezar. Allí encontrarás las instrucciones de desarrollo, pruebas y estilo del proyecto. Consulta también [SECURITY.md](../SECURITY.md) para informar de vulnerabilidades.