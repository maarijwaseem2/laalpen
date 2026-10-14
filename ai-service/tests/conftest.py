import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
os.environ["AI_MODE"] = "mock"
os.environ["SERVICE_TOKEN"] = "test-token"
