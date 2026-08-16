from flask import Flask, jsonify

from .api.routes import api_bp
from .config import Config
from .web.routes import web_bp


def _json_error(status, message):
    return jsonify({"error": message}), status


def create_app() -> Flask:
    app = Flask(__name__)
    app.config.from_object(Config)
    app.register_blueprint(web_bp)
    app.register_blueprint(api_bp, url_prefix="/api")

    @app.errorhandler(404)
    def not_found(e):
        return _json_error(404, "Not found")

    @app.errorhandler(405)
    def method_not_allowed(e):
        return _json_error(405, "Method not allowed")

    @app.errorhandler(500)
    def internal_error(e):
        return _json_error(500, "Internal server error")

    @app.errorhandler(502)
    def bad_gateway(e):
        return _json_error(502, "Bad gateway")

    return app
