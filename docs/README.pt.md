# Stellar Goal Vault

[English](../README.md) | [Español](README.es.md) | [Português](README.pt.md)

> Esta tradução pode ficar desatualizada até uma versão após a edição mais recente em inglês.

## Visão geral

Stellar Goal Vault é uma aplicação leve de financiamento coletivo para o ecossistema Stellar. Ela permite que criadores publiquem campanhas e que apoiadores contribuam até uma data limite.

- O painel em React permite criar e gerenciar campanhas.
- A API em Node.js e Express usa SQLite para armazenar campanhas, contribuições e histórico de eventos.
- O contrato Soroban inclui operações para criar campanhas, contribuir, resgatar fundos e reembolsar contribuições.
- As campanhas podem aceitar vários ativos Stellar.

Se uma campanha atingir sua meta, o criador poderá resgatar os fundos. Se não atingir a meta até a data limite, os apoiadores poderão solicitar o reembolso de suas contribuições.

## Início rápido

### Pré-requisitos

- Node.js 18 ou posterior
- npm 9 ou posterior
- Opcional para trabalhar com contratos: Rust e as ferramentas Soroban

Na raiz do repositório, instale as dependências e inicie a API e o painel em terminais separados:

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
```

Abra o painel em `http://localhost:3000`. A API local está disponível em `http://localhost:3001`.

Para iniciar os serviços com Docker e recarga automática:

```bash
docker compose up --build
```

## Referência da API

A URL base da API local é `http://localhost:3001`; o painel usa o proxy `/api`.

### `GET /api/health`

Verifica o estado do serviço e a conexão com o banco de dados.

```json
{
  "service": "stellar-goal-vault-backend",
  "status": "ok",
  "timestamp": "2026-03-27T21:30:00.000Z",
  "uptimeSeconds": 12.345,
  "database": { "status": "up", "reachable": true }
}
```

`status` é `ok` quando a API e o banco de dados respondem; caso contrário, é `degraded`. `database.status` pode ser `up` ou `down`.

### `GET /api/stats`

Retorna métricas agregadas de campanhas e contribuições. A resposta fica em cache por 60 segundos; o cabeçalho `X-Cache` indica `HIT` ou `MISS`. Não exige autenticação.

### `GET /api/campaigns`

Retorna todas as campanhas com o progresso calculado. Parâmetros de consulta opcionais:

- `q`: busca por título, criador ou ID da campanha, sem diferenciar maiúsculas de minúsculas.
- `asset`: filtra pelo código do ativo, como `USDC` ou `XLM`.
- `status`: filtra pelo estado: `open`, `funded`, `claimed` ou `failed`.

### `GET /api/campaigns/:id`

Retorna uma campanha com suas contribuições e o histórico de eventos.

### `GET /api/campaigns/:id/pledges`

Retorna as contribuições com metadados de paginação. Os parâmetros opcionais `page` e `limit` controlam o número da página e os resultados por página.

### `POST /api/campaigns`

Cria uma campanha. O corpo inclui `creator`, `title`, `description`, `assetCode`, `targetAmount` e `deadline`. `maxPerContributor` é opcional e limita o total que uma pessoa pode contribuir; também pode ser configurado globalmente com `DEFAULT_MAX_PER_CONTRIBUTOR`.

### `POST /api/campaigns/:id/pledges`

Registra uma contribuição para uma campanha ativa. O corpo inclui `contributor`, `amount` e `assetCode`. O cabeçalho opcional `Idempotency-Key` evita contribuições duplicadas; respostas em cache incluem `X-Idempotency-Cache` com `HIT` ou `MISS`.

### `POST /api/campaigns/:id/pledges/reconcile`

Registra localmente uma contribuição confirmada na blockchain. O corpo inclui `contributor`, `amount`, `transactionHash` e, opcionalmente, `confirmedAt`.

### `POST /api/campaigns/:id/claim`

Resgata uma campanha financiada após a data limite. O corpo inclui `creator`.

### `POST /api/campaigns/:id/refund`

Reembolsa as contribuições ativas de uma pessoa em uma campanha malsucedida. O corpo inclui `contributor`.

### `GET /api/campaigns/:id/history`

Busca o histórico local de eventos da campanha.

### `GET /api/campaigns/:id/contributors`

Retorna um resumo por apoiador, com o total contribuído, o valor reembolsado e se o reembolso foi concluído. Campanhas sem contribuições retornam `{"data": []}`; IDs inválidos retornam 404.

### `GET /api/open-issues`

Retorna ideias de issues para contribuir com o projeto de código aberto.

A referência completa está em [docs/API.md](./API.md) e a especificação está em [docs/openapi.yaml](./openapi.yaml).

## Contribuir

1. Faça um fork do repositório e clone-o.
2. Instale as dependências com `npm run install:all`.
3. Crie uma branch para suas alterações, por exemplo `feature/minha-melhoria`.
4. Faça as alterações e execute as verificações adequadas.
5. Crie um commit no formato Conventional Commits, por exemplo `feat: add new endpoint`.
6. Envie a branch e abra um pull request para `main`.

Leia o [guia de contribuição](../CONTRIBUTING.md) antes de começar. Ele contém as instruções de desenvolvimento, testes e estilo do projeto. Consulte também [SECURITY.md](../SECURITY.md) para relatar vulnerabilidades.