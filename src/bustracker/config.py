import os
from pathlib import Path

from dotenv import load_dotenv

load_dotenv(Path(__file__).resolve().parent / ".env")


class Config:
    NTA_API_KEY = os.getenv("NTA_API_KEY")
