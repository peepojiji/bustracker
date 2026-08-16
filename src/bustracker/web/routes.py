from flask import Blueprint, render_template

web_bp = Blueprint("web", __name__)


@web_bp.get("/")
def map_page():
    return render_template("map.html")
