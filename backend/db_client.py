import os
import json
import logging
import uuid
import random
import hashlib
from datetime import datetime, timezone
from google.cloud import spanner

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Load config
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")
with open(CONFIG_PATH, "r") as f:
    CONFIG = json.load(f)

PROJECT_ID = CONFIG.get("gcp", {}).get("project_id")
SPANNER_CONFIG = CONFIG.get("databases", {}).get("spanner", {})
INSTANCE_ID = SPANNER_CONFIG.get("instance_id", "spanner-demo-inst")
DATABASE_ID = SPANNER_CONFIG.get("database_id", "memoria-spanner-db")

class SpannerClient:
    _spanner_client = None
    _instance = None
    _database = None

    @classmethod
    def get_db(cls):
        if cls._database is None:
            cls._spanner_client = spanner.Client(project=PROJECT_ID)
            cls._instance = cls._spanner_client.instance(INSTANCE_ID)
            cls._database = cls._instance.database(DATABASE_ID)
        return cls._database

    @staticmethod
    def generate_vector(text: str) -> list:
        """Generates a stable 768-dimensional mock vector using the text hash as seed."""
        hasher = hashlib.sha256(text.encode("utf-8"))
        seed_int = int(hasher.hexdigest()[:8], 16)
        rng = random.Random(seed_int)
        vec = [rng.uniform(-1.0, 1.0) for _ in range(768)]
        norm = sum(x*x for x in vec) ** 0.5
        return [x / norm for x in vec]

    @classmethod
    def get_presets(cls):
        db = cls.get_db()
        query = "SELECT player_id, name, level, active_quest FROM Players ORDER BY player_id ASC;"
        
        try:
            with db.snapshot() as snapshot:
                results = snapshot.execute_sql(query)
                presets = []
                for row in results:
                    presets.append({
                        "id": str(row[0]),
                        "name": row[1],
                        "level": row[2],
                        "active_quest": row[3]
                    })
                return presets
        except Exception as e:
            logger.error(f"Error fetching presets from Spanner: {e}", exc_info=True)
            return []

    @classmethod
    def get_session_context(cls, player_id: int):
        db = cls.get_db()
        
        player_query = "SELECT name, level, active_quest FROM Players WHERE player_id = @player_id LIMIT 1;"
        
        # Spanner Graph GQL query to find relationship details
        relations_gql = """
        GRAPH GameMemoryGraph
        MATCH (p:Players {player_id: @player_id})-[r:Player_Companion_Relations]->(c:AI_Companions)
        RETURN r.relationship_level AS rel_level, r.bond_points AS bond, r.companion_status AS status, c.name AS companion_name, c.companion_id AS companion_id
        """

        # Spanner Graph GQL query to find recent 10 dialogues
        dialogue_gql = """
        GRAPH GameMemoryGraph
        MATCH (p:Players {player_id: @player_id})-[d:Dialogue_Edges]->(c:AI_Companions)
        RETURN d.speaker AS speaker, d.text_content AS text, d.audio_tag AS tag, d.timestamp AS time
        ORDER BY d.timestamp DESC
        LIMIT 10
        """

        try:
            with db.snapshot(multi_use=True) as snapshot:
                # 1. Fetch Player
                player_result = snapshot.execute_sql(
                    player_query, 
                    params={"player_id": player_id},
                    param_types={"player_id": spanner.param_types.INT64}
                )
                player_row = list(player_result)
                if not player_row:
                    return None
                
                player_info = {
                    "name": player_row[0][0],
                    "level": player_row[0][1],
                    "active_quest": player_row[0][2]
                }

                # 2. Fetch Relationship (GQL)
                rel_result = snapshot.execute_sql(
                    relations_gql,
                    params={"player_id": player_id},
                    param_types={"player_id": spanner.param_types.INT64}
                )
                rel_row = list(rel_result)
                relationship = {
                    "relationship_level": 1,
                    "bond_points": 0,
                    "companion_status": "Inactive",
                    "companion_name": "Slamy",
                    "companion_id": "slamy"
                }
                all_relationships = []
                for row in rel_row:
                    all_relationships.append({
                        "relationship_level": row[0],
                        "bond_points": row[1],
                        "companion_status": row[2],
                        "companion_name": row[3],
                        "companion_id": row[4]
                    })
                if all_relationships:
                    # Keep active relationship as the first one matching 'Active Companion' or first element
                    active_rel = next((r for r in all_relationships if r["companion_status"] == "Active Companion"), all_relationships[0])
                    relationship = active_rel

                # 3. Fetch Dialogue logs (GQL)
                diag_result = snapshot.execute_sql(
                    dialogue_gql,
                    params={"player_id": player_id},
                    param_types={"player_id": spanner.param_types.INT64}
                )
                dialogues = []
                # GQL results return rows. We reverse them so they display chronologically
                for row in diag_result:
                    dialogues.append({
                        "speaker": row[0],
                        "text": row[1],
                        "tag": row[2],
                        "timestamp": row[3].isoformat() if hasattr(row[3], "isoformat") else str(row[3])
                    })
                dialogues.reverse()

                return {
                    "player": player_info,
                    "relationship": relationship,
                    "all_relationships": all_relationships,
                    "dialogues": dialogues
                }
        except Exception as e:
            logger.error(f"Error fetching session context: {e}", exc_info=True)
            return None

    @classmethod
    def find_semantic_memories(cls, player_id: int, query_text: str):
        db = cls.get_db()
        query_vector = cls.generate_vector(query_text)
        
        # Spanner vector distance query
        vector_query = """
        SELECT speaker, text_content, audio_tag, COSINE_DISTANCE(embedding, @query_vector) AS distance
        FROM Dialogue_Edges
        WHERE player_id = @player_id AND COSINE_DISTANCE(embedding, @query_vector) < 0.6
        ORDER BY distance ASC
        LIMIT 3;
        """
        
        try:
            with db.snapshot() as snapshot:
                results = snapshot.execute_sql(
                    vector_query,
                    params={"player_id": player_id, "query_vector": query_vector},
                    param_types={"player_id": spanner.param_types.INT64, "query_vector": spanner.param_types.Array(spanner.param_types.FLOAT64)}
                )
                memories = []
                for row in results:
                    memories.append({
                        "speaker": row[0],
                        "text": row[1],
                        "tag": row[2],
                        "distance": round(row[3], 3)
                    })
                return memories
        except Exception as e:
            logger.error(f"Error querying semantic memories: {e}", exc_info=True)
            return []

    @classmethod
    def record_dialogue(cls, player_id: int, companion_id: str, speaker: str, text_content: str, audio_tag: str = None):
        db = cls.get_db()
        dialogue_id = f"d_{int(datetime.now(timezone.utc).timestamp())}_{uuid.uuid4().hex[:4]}"
        embedding = cls.generate_vector(text_content)
        timestamp = datetime.now(timezone.utc)
        
        try:
            # Increment bond points and level if speaker is player
            # We do this inside a read-write transaction
            def transact_insert(transaction):
                # Insert the dialogue log
                transaction.execute_update(
                    """
                    INSERT INTO Dialogue_Edges (dialogue_id, player_id, companion_id, speaker, text_content, audio_tag, embedding, timestamp)
                    VALUES (@dialogue_id, @player_id, @companion_id, @speaker, @text_content, @audio_tag, @embedding, @timestamp)
                    """,
                    params={
                        "dialogue_id": dialogue_id,
                        "player_id": player_id,
                        "companion_id": companion_id,
                        "speaker": speaker,
                        "text_content": text_content,
                        "audio_tag": audio_tag,
                        "embedding": embedding,
                        "timestamp": timestamp
                    },
                    param_types={
                        "dialogue_id": spanner.param_types.STRING,
                        "player_id": spanner.param_types.INT64,
                        "companion_id": spanner.param_types.STRING,
                        "speaker": spanner.param_types.STRING,
                        "text_content": spanner.param_types.STRING,
                        "audio_tag": spanner.param_types.STRING,
                        "embedding": spanner.param_types.Array(spanner.param_types.FLOAT64),
                        "timestamp": spanner.param_types.TIMESTAMP
                    }
                )

                if speaker != "Slamy":
                    # Update relationship stats on Player_Companion_Relations
                    rel_result = transaction.execute_sql(
                        "SELECT relationship_level, bond_points FROM Player_Companion_Relations WHERE player_id = @player_id AND companion_id = @companion_id LIMIT 1",
                        params={"player_id": player_id, "companion_id": companion_id},
                        param_types={"player_id": spanner.param_types.INT64, "companion_id": spanner.param_types.STRING}
                    )
                    rel_row = list(rel_result)
                    if rel_row:
                        curr_level, curr_points = rel_row[0][0], rel_row[0][1]
                        new_points = curr_points + 25
                        new_level = curr_level
                        if new_points >= (curr_level * 100):
                            new_level = curr_level + 1
                        
                        transaction.execute_update(
                            """
                            UPDATE Player_Companion_Relations
                            SET relationship_level = @new_level, bond_points = @new_points
                            WHERE player_id = @player_id AND companion_id = @companion_id
                            """,
                            params={"new_level": new_level, "new_points": new_points, "player_id": player_id, "companion_id": companion_id},
                            param_types={"new_level": spanner.param_types.INT64, "new_points": spanner.param_types.INT64, "player_id": spanner.param_types.INT64, "companion_id": spanner.param_types.STRING}
                        )

            db.run_in_transaction(transact_insert)
            logger.info(f"Successfully recorded dialogue edge: {dialogue_id}")
            return True
        except Exception as e:
            logger.error(f"Failed to record dialogue edge: {e}", exc_info=True)
            return False

    @classmethod
    def get_analytics(cls, player_id: int):
        db = cls.get_db()
        
        # Fetch emotion count metrics using Spanner SQL
        emotion_query = """
        SELECT audio_tag, COUNT(*) as count
        FROM Dialogue_Edges
        WHERE player_id = @player_id AND speaker = 'Slamy' AND audio_tag IS NOT NULL
        GROUP BY audio_tag
        ORDER BY count DESC;
        """
        
        # Fetch sentiment timeline
        # We can map some emotion tags to a numeric sentiment value:
        # excited = 2, happy/giggles = 1, thoughtful/neutral = 0, scared = -1, sad = -2
        timeline_query = """
        SELECT text_content, audio_tag, timestamp
        FROM Dialogue_Edges
        WHERE player_id = @player_id AND speaker = 'Slamy'
        ORDER BY timestamp ASC;
        """
        
        try:
            with db.snapshot(multi_use=True) as snapshot:
                # 1. Emotions pie chart query
                emotion_result = snapshot.execute_sql(
                    emotion_query,
                    params={"player_id": player_id},
                    param_types={"player_id": spanner.param_types.INT64}
                )
                emotions = []
                for row in emotion_result:
                    emotions.append({
                        "tag": row[0],
                        "count": row[1]
                    })
                
                # 2. Timeline query
                timeline_result = snapshot.execute_sql(
                    timeline_query,
                    params={"player_id": player_id},
                    param_types={"player_id": spanner.param_types.INT64}
                )
                sentiment_map = {
                    "[excited]": 2.0,
                    "[happy]": 1.0,
                    "[giggles]": 1.0,
                    "[thoughtful]": 0.0,
                    "[neutral]": 0.0,
                    "[scared]": -1.0,
                    "[sad]": -2.0
                }
                timeline = []
                for row in timeline_result:
                    tag = row[1]
                    val = sentiment_map.get(tag, 1.0) if tag else 0.5  # default baseline
                    timeline.append({
                        "text": row[0][:40] + "..." if len(row[0]) > 40 else row[0],
                        "tag": tag or "[neutral]",
                        "value": val,
                        "time": row[2].isoformat() if hasattr(row[2], "isoformat") else str(row[2])
                    })

                return {
                    "emotions": emotions,
                    "sentiment_timeline": timeline
                }
        except Exception as e:
            logger.error(f"Error fetching analytics: {e}", exc_info=True)
            return {"emotions": [], "sentiment_timeline": []}
