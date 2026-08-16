import os

from .app import create_app


def main() -> None:
    app = create_app()
    app.run(host="127.0.0.1", port=5000, debug=os.getenv("FLASK_DEBUG", "0") == "1")
