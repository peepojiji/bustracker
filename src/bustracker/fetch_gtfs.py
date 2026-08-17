import os
import urllib.request

from rich.console import Console
from rich.progress import (
    BarColumn,
    DownloadColumn,
    Progress,
    TextColumn,
    TransferSpeedColumn,
)
from rich.status import Status

from .build_gtfs_cache import build
from .paths import DATA_DIR, GTFS_PATH

GTFS_URL = "https://www.transportforireland.ie/transitData/Data/GTFS_Realtime.zip"
console = Console()


def fetch_data() -> None:
    os.makedirs(DATA_DIR, exist_ok=True)

    _download(GTFS_URL, GTFS_PATH)
    _build_cache()


def _download(url: str, dest: str) -> None:
    console.print(f"Downloading [cyan]{url}[/] ...")

    req = urllib.request.Request(url)
    with urllib.request.urlopen(req, timeout=30) as resp:
        total = int(resp.headers.get("Content-Length", 0)) or None

        with Progress(
            TextColumn("[bold blue]{task.fields[filename]}[/]"),
            BarColumn(),
            DownloadColumn(),
            TransferSpeedColumn(),
            TextColumn("[progress.percentage]{task.percentage:>3.0f}%"),
            console=console,
        ) as progress:
            task = progress.add_task("download", filename=dest.split("/")[-1], total=total)
            with open(dest, "wb") as f:
                while True:
                    chunk = resp.read(65536)
                    if not chunk:
                        break
                    f.write(chunk)
                    progress.advance(task, len(chunk))

    console.print(f"[green]Downloaded[/] to {dest}")


def _build_cache() -> None:
    console.print("Building route cache ...")
    with Status("Processing GTFS files", spinner="dots", console=console):
        build()
    console.print("[green]Done.[/]")
