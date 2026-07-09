import os
import json
import logging
import random
import hashlib
from datetime import datetime, timezone
from google.cloud import spanner

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load config
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), "config.json")
with open(CONFIG_PATH, "r") as f:
    CONFIG = json.load(f)

PROJECT_ID = CONFIG.get("gcp", {}).get("project_id")
SPANNER_CONFIG = CONFIG.get("databases", {}).get("spanner", {})
INSTANCE_ID = SPANNER_CONFIG.get("instance_id", "spanner-demo-inst")
DATABASE_ID = SPANNER_CONFIG.get("database_id", "memoria-spanner-db")

def generate_vector(text: str) -> list:
    """Generates a stable 768-dimensional mock vector using the text hash as seed."""
    hasher = hashlib.sha256(text.encode("utf-8"))
    seed_int = int(hasher.hexdigest()[:8], 16)
    rng = random.Random(seed_int)
    vec = [rng.uniform(-1.0, 1.0) for _ in range(768)]
    norm = sum(x*x for x in vec) ** 0.5
    return [x / norm for x in vec]

def create_schema(database):
    logger.info("Deploying DDL schema to Spanner database...")
    
    # We drop property graph first if it exists, then tables, then recreate.
    # To do this cleanly, we check if they already exist or just drop them.
    # Note: Spanner Graph DDL needs to drop property graph first before dropping node/edge tables.
    ddl_statements = [
        # 1. Node Table: Players
        """
        CREATE TABLE Players (
          player_id INT64 NOT NULL,
          name STRING(100) NOT NULL,
          level INT64 NOT NULL,
          active_quest STRING(200),
          joined_at TIMESTAMP NOT NULL
        ) PRIMARY KEY (player_id)
        """,
        # 2. Node Table: AI_Companions
        """
        CREATE TABLE AI_Companions (
          companion_id STRING(50) NOT NULL,
          name STRING(50) NOT NULL,
          voice_id STRING(50),
          personality STRING(200) NOT NULL,
          description STRING(500)
        ) PRIMARY KEY (companion_id)
        """,
        # 3. Edge Table: Player_Companion_Relations
        """
        CREATE TABLE Player_Companion_Relations (
          player_id INT64 NOT NULL,
          companion_id STRING(50) NOT NULL,
          relationship_level INT64 NOT NULL,
          bond_points INT64 NOT NULL,
          companion_status STRING(50) NOT NULL
        ) PRIMARY KEY (player_id, companion_id)
        """,
        # 4. Edge Table: Dialogue_Edges
        """
        CREATE TABLE Dialogue_Edges (
          dialogue_id STRING(100) NOT NULL,
          player_id INT64 NOT NULL,
          companion_id STRING(50) NOT NULL,
          speaker STRING(50) NOT NULL,
          text_content STRING(1000) NOT NULL,
          audio_tag STRING(50),
          embedding ARRAY<FLOAT64>(vector_length=>768),
          timestamp TIMESTAMP NOT NULL
        ) PRIMARY KEY (dialogue_id)
        """,
        # 5. Property Graph definition
        """
        CREATE PROPERTY GRAPH GameMemoryGraph
          NODE TABLES (
            Players KEY (player_id),
            AI_Companions KEY (companion_id)
          )
          EDGE TABLES (
            Player_Companion_Relations
              KEY (player_id, companion_id)
              SOURCE KEY (player_id) REFERENCES Players (player_id)
              DESTINATION KEY (companion_id) REFERENCES AI_Companions (companion_id),
            Dialogue_Edges
              KEY (dialogue_id)
              SOURCE KEY (player_id) REFERENCES Players (player_id)
              DESTINATION KEY (companion_id) REFERENCES AI_Companions (companion_id)
          )
        """
    ]
    
    # Try dropping the graph and tables first for clean rebuild
    try:
        op = database.update_ddl(["DROP PROPERTY GRAPH GameMemoryGraph"])
        op.result()
        logger.info("Dropped existing property graph GameMemoryGraph.")
    except Exception:
        pass

    for table in ["Dialogue_Edges", "Player_Companion_Relations", "Players", "AI_Companions"]:
        try:
            op = database.update_ddl([f"DROP TABLE {table}"])
            op.result()
            logger.info(f"Dropped existing table {table}.")
        except Exception:
            pass

    # Execute creation
    operation = database.update_ddl(ddl_statements)
    logger.info("Waiting for DDL schema deployment to finish...")
    operation.result()
    logger.info("Spanner schema successfully deployed.")

def seed_data(database):
    logger.info("Seeding data to Spanner...")
    
    now = datetime.now(timezone.utc)
    
    # Node: Players
    players_data = [
        (1, "Hiro", 15, "Defeat the Dragon of Mount Pyro", now),
        (2, "Sofia", 32, "Retrieve the stolen Crown of Light", now)
    ]
    
    # Node: AI_Companions
    companions_data = [
        ("slamy", "Slamy", "slamy_voice_id", "Cheerful and optimistic, but gets easily startled by loud noises. Always uses natural-language emotion tags when expressing themselves.", "A small friendly blue slime companion.")
    ]
    
    # Edge: Relations
    relations_data = [
        (1, "slamy", 5, 450, "Active Companion"),
        (2, "slamy", 12, 1250, "Resting at Camp")
    ]
    
    # Edge: Dialogues
    dialogues_raw = [
        # Hiro & Slamy
        ("d_h1", 1, "slamy", "Hiro", "Hey Slamy, do you think we can defeat the dragon today?", None, now),
        ("d_s1", 1, "slamy", "Slamy", "Of course we can, Hiro! We have trained so hard! [excited] Just please do not let it sneeze on me...", "[excited]", now),
        ("d_h2", 1, "slamy", "Hiro", "Thanks Slamy, that makes me feel better.", None, now),
        ("d_s2", 1, "slamy", "Slamy", "Anytime! [happy] I am always by your side!", "[happy]", now),
        # Sofia & Slamy
        ("d_so1", 2, "slamy", "Sofia", "Slamy, do you remember where the key to the tomb is?", None, now),
        ("d_s3", 2, "slamy", "Slamy", "I think I saw it near the old well! [scared] But there are a lot of bats over there...", "[scared]", now)
    ]
    
    dialogues_data = []
    for diag_id, p_id, comp_id, speaker, text, tag, t in dialogues_raw:
        vector = generate_vector(text)
        dialogues_data.append((diag_id, p_id, comp_id, speaker, text, tag, vector, t))

    with database.batch() as batch:
        batch.insert(
            table="Players",
            columns=["player_id", "name", "level", "active_quest", "joined_at"],
            values=players_data
        )
        batch.insert(
            table="AI_Companions",
            columns=["companion_id", "name", "voice_id", "personality", "description"],
            values=companions_data
        )
        batch.insert(
            table="Player_Companion_Relations",
            columns=["player_id", "companion_id", "relationship_level", "bond_points", "companion_status"],
            values=relations_data
        )
        batch.insert(
            table="Dialogue_Edges",
            columns=["dialogue_id", "player_id", "companion_id", "speaker", "text_content", "audio_tag", "embedding", "timestamp"],
            values=dialogues_data
        )
        
    logger.info("Data seeding completed successfully.")

def main():
    spanner_client = spanner.Client(project=PROJECT_ID)
    instance = spanner_client.instance(INSTANCE_ID)
    database = instance.database(DATABASE_ID)
    
    create_schema(database)
    seed_data(database)
    logger.info("Spanner setup finished successfully!")

if __name__ == "__main__":
    main()
