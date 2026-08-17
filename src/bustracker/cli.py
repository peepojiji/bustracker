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
    app.run(host="127.0.0.1", port=5000, debug=os.getenv("FLASK_DEBUG", "0") == "1")


@cli.command()
def fetch_data() -> None:
    from .fetch_gtfs import fetch_data as do_fetch

    do_fetch()
