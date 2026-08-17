# Bustracker

Tracks buses in Ireland live.

## Prerequisites

- [uv](https://docs.astral.sh/uv/getting-started/installation/) (Python package manager)
- A free NTA API key from https://developer.nationaltransport.ie/ (for live vehicle positions)

## Setup

```sh
uv sync
uv run bustracker fetch-data   # downloads GTFS feed + builds sqlite cache
cp .env.example .env           # add your NTA_API_KEY
```

## Running

```sh
uv run bustracker                  # http://127.0.0.1:5000
uv run bustracker serve            # same thing
```

For development with debug mode:

```sh
FLASK_DEBUG=1 uv run bustracker
```

## How it works

`bustracker fetch-data` downloads the static GTFS schedule from
https://www.transportforireland.ie/transitData/Data/GTFS_Realtime.zip into
`data/gtfs_realtime.zip`, then compiles it into `data/gtfs_cache.sqlite`.
Both files are gitignored — they must be generated locally.
