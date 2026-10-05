import os

import click

from .paths import DB_PATH, GTFS_PATH


@click.group()
def cli() -> None:
    pass


@cli.command()
def serve() -> None:
    from .app import create_app
    from .fetch_gtfs import fetch_data

    if not os.path.exists(GTFS_PATH) or not os.path.exists(DB_PATH):
        fetch_data()

    app = create_app()
    host = os.getenv("BUSTRACKER_HOST", "127.0.0.1")
    port = int(os.getenv("BUSTRACKER_PORT", "5000"))

    if os.getenv("FLASK_DEBUG", "0") == "1":
        app.run(host=host, port=port, debug=True)
        return

    from waitress import serve as wsgi_serve

    wsgi_serve(app, host=host, port=port)


@cli.command()
def fetch_data() -> None:
    from .fetch_gtfs import fetch_data as do_fetch

    do_fetch()
