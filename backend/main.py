import os
import sys
import logging
import subprocess
from fastapi import FastAPI, HTTPException, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse
from pydantic import BaseModel
from typing import Optional, List, Literal

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Add current directory to path so relative imports work
sys.path.append(os.path.dirname(__file__))

import json
CONFIG_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "config.json")
with open(CONFIG_PATH, "r") as f:
    CONFIG = json.load(f)

PROJECT_ID = CONFIG.get("gcp", {}).get("project_id")

from db_client import SpannerClient

app = FastAPI(title="Memoria Spanner AI Companion API")

# Enable CORS for local development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class ChatRequest(BaseModel):
    player_id: int
    companion_id: str = "lumi"
    message: str

class RegenerateRequest(BaseModel):
    confirm: bool

@app.get("/api/presets")
def get_presets():
    presets = SpannerClient.get_presets()
    return presets

@app.get("/api/session/{player_id}")
def get_session(player_id: int):
    context = SpannerClient.get_session_context(player_id)
    if not context:
        raise HTTPException(status_code=404, detail="Player session not found.")
    return context

@app.post("/api/companion/chat")
def companion_chat(request: ChatRequest):
    player_id = request.player_id
    companion_id = request.companion_id
    message = request.message
    
    # 1. Fetch current player context and relations via Spanner Graph
    context = SpannerClient.get_session_context(player_id)
    if not context:
        raise HTTPException(status_code=404, detail="Player context not found.")
    
    player_info = context["player"]
    relationship = context["relationship"]
    
    # 2. Fetch contextually relevant past dialogue using Spanner Vector Distance
    semantic_memories = SpannerClient.find_semantic_memories(player_id, message)
    
    # Format semantic memories for prompt context
    memory_context = ""
    if semantic_memories:
        memory_context = "\n".join([
            f"- {m['speaker']}: {m['text']} {m['tag'] if m['tag'] else ''}" 
            for m in semantic_memories
        ])
    else:
        memory_context = "No relevant previous memories found."

    # 3. Create instruction for Gemini
    system_instruction = f"""
You are 'Lumi', a cheerful, optimistic blue slime companion in a fantasy RPG game.
Your personality: You are energetic and cheerful, but you get easily startled by loud noises or scary things.
The player you are speaking with: {player_info['name']} (Level {player_info['level']}).
The player's active quest: {player_info['active_quest']}.
Your relationship level with this player: {relationship['relationship_level']}/20.

Your responses MUST be in-character, brief (1-3 sentences), matching a game companion.
CRITICAL: You MUST include natural-language audio/emotion tags inside square brackets at appropriate places in your speech, such as [excited], [laughs], [giggles], [happy], [scared], [thoughtful], [gasp], [shivers]. Choose one that reflects how you say the words.

Here are long-term semantic memories of past interactions you retrieved from your Spanner memory database relating to this query:
{memory_context}
"""

    logger.info(f"System instruction prepared for Gemini: {system_instruction}")

    # 4. Invoke Gemini API
    # We use Application Default Credentials to call GenAI
    lumi_response = "Lumi is thinking..."
    try:
        from google import genai
        from google.genai import types
        
        # Initialize the GenAI Client in Vertex AI mode pointing to us-central1 (Gemini availability)
        client = genai.Client(vertexai=True, project=PROJECT_ID, location="us-central1")
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=message,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7,
                max_output_tokens=1024
            )
        )
        logger.info(f"Gemini response: {response}")
        lumi_response = response.text.strip()
    except Exception as e:
        logger.error(f"Failed to generate response from Gemini: {e}", exc_info=True)
        # Fallback response if Gemini fails/quota exceeded
        lumi_response = "Hi there! [excited] I am super happy to talk to you, even though my cloud connection is acting up!"

    # 5. Parse audio tag from Lumi's response (match any tag in brackets)
    import re
    match = re.search(r'\[(.*?)\]', lumi_response)
    audio_tag = f"[{match.group(1)}]" if match else None



    # 6. Record Dialogue Edges (Player message and Lumi response) in Spanner
    # This automatically increases relationship level and bond points in the transaction
    SpannerClient.record_dialogue(player_id, companion_id, player_info["name"], message)
    SpannerClient.record_dialogue(player_id, companion_id, "Lumi", lumi_response, audio_tag)

    # 7. Re-fetch updated relationship metrics
    updated_context = SpannerClient.get_session_context(player_id)
    new_relationship = updated_context["relationship"] if updated_context else relationship

    return {
        "reply": lumi_response,
        "audio_tag": audio_tag,
        "relationship": new_relationship,
        "semantic_memories_retrieved": semantic_memories,
        "updated_dialogues": updated_context["dialogues"] if updated_context else []
    }

class VoiceChatRequest(BaseModel):
    player_id: int
    companion_id: str = "lumi"
    audio_base64: str
    mime_type: str = "audio/webm"

@app.post("/api/companion/chat-voice")
def companion_chat_voice(request: VoiceChatRequest):
    player_id = request.player_id
    companion_id = request.companion_id
    
    # 1. Decode audio
    import base64
    try:
        audio_bytes = base64.b64decode(request.audio_base64)
    except Exception as e:
        logger.error(f"Failed to decode base64 audio: {e}")
        raise HTTPException(status_code=400, detail="Invalid base64 audio data.")

    # 2. Fetch context
    context = SpannerClient.get_session_context(player_id)
    if not context:
        raise HTTPException(status_code=404, detail="Player context not found.")
    
    player_info = context["player"]
    relationship = context["relationship"]

    # 3. Initialize GenAI client
    from google import genai
    from google.genai import types

    client = genai.Client(vertexai=True, project=PROJECT_ID, location="us-central1")

    # Define Structured Output Schema
    class AudioAnalysis(BaseModel):
        transcription: str
        sentiment: Literal["excited", "happy", "neutral", "scared", "thoughtful", "sad", "angry"]

    # 4. First Call: Transcribe & Sentimental Analysis
    try:
        transcribe_prompt = (
            "Transcribe this audio exactly. Also identify the overall emotion/sentiment of the speaker's voice. "
            "It must be one of: excited, happy, neutral, scared, thoughtful, sad, angry."
        )
        
        response = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=[
                types.Part.from_bytes(data=audio_bytes, mime_type=request.mime_type),
                transcribe_prompt
            ],
            config=types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=AudioAnalysis,
            ),
        )
        logger.info(f"Gemini transcription & voice sentiment response: {response.text}")
        analysis = AudioAnalysis.model_validate_json(response.text.strip())
    except Exception as e:
        logger.error(f"Failed transcription and sentiment analysis: {e}", exc_info=True)
        # Fallback if Gemini fails or structured output fails
        analysis = AudioAnalysis(transcription="[unintelligible voice input]", sentiment="neutral")

    # 5. Fetch semantic memories based on transcription
    semantic_memories = SpannerClient.find_semantic_memories(player_id, analysis.transcription)
    memory_context = ""
    if semantic_memories:
        memory_context = "\n".join([
            f"- {m['speaker']}: {m['text']} {m['tag'] if m['tag'] else ''}" 
            for m in semantic_memories
        ])
    else:
        memory_context = "No relevant previous memories found."

    # 6. Create instructions for companion reply
    system_instruction = f"""
You are 'Lumi', a cheerful, optimistic blue slime companion in a fantasy RPG game.
Your personality: You are energetic and cheerful, but you get easily startled by loud noises or scary things.
The player you are speaking with: {player_info['name']} (Level {player_info['level']}).
The player's active quest: {player_info['active_quest']}.
Your relationship level with this player: {relationship['relationship_level']}/20.

Your responses MUST be in-character, brief (1-3 sentences), matching a game companion.
CRITICAL: You MUST include natural-language audio/emotion tags inside square brackets at appropriate places in your speech, such as [excited], [laughs], [giggles], [happy], [scared], [thoughtful], [gasp], [shivers]. Choose one that reflects how you say the words.

Here are long-term semantic memories of past interactions you retrieved from your Spanner memory database relating to this query:
{memory_context}
"""

    # 7. Second Call: Generate Lumi's response
    lumi_response = "Lumi is thinking..."
    try:
        response2 = client.models.generate_content(
            model='gemini-2.5-flash',
            contents=analysis.transcription,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=0.7,
                max_output_tokens=1024
            )
        )
        lumi_response = response2.text.strip()
    except Exception as e:
        logger.error(f"Failed to generate companion response from Gemini: {e}", exc_info=True)
        lumi_response = "Hi there! [excited] I am super happy to talk to you, even though my cloud connection is acting up!"

    # 8. Parse audio/emotion tag from Lumi's response
    import re
    match = re.search(r'\[(.*?)\]', lumi_response)
    companion_tag = f"[{match.group(1)}]" if match else None

    # 9. Save dialogue edges (Player message with sentiment & companion reply with sentiment)
    player_tag = f"[{analysis.sentiment}]" if analysis.sentiment else None
    
    SpannerClient.record_dialogue(player_id, companion_id, player_info["name"], analysis.transcription, player_tag)
    SpannerClient.record_dialogue(player_id, companion_id, "Lumi", lumi_response, companion_tag)

    # 10. Re-fetch updated relationship metrics
    updated_context = SpannerClient.get_session_context(player_id)
    new_relationship = updated_context["relationship"] if updated_context else relationship

    return {
        "transcription": analysis.transcription,
        "player_sentiment": analysis.sentiment,
        "reply": lumi_response,
        "audio_tag": companion_tag,
        "relationship": new_relationship,
        "semantic_memories_retrieved": semantic_memories,
        "updated_dialogues": updated_context["dialogues"] if updated_context else []
    }


@app.get("/api/analytics/{player_id}")
def get_analytics(player_id: int):
    analytics = SpannerClient.get_analytics(player_id)
    return analytics

@app.post("/api/regenerate-data")
def regenerate_data(request: RegenerateRequest):
    if not request.confirm:
        return {"status": "error", "message": "Confirmation required."}
    
    logger.info("Regenerating Spanner data...")
    try:
        # Run setup_spanner.py as a subprocess to reload DDL and seed data
        setup_script = os.path.join(os.path.dirname(__file__), "db", "setup_spanner.py")
        venv_python = sys.executable
        
        # Enforce cert bundle env for subprocess ssl
        env = os.environ.copy()
        try:
            import certifi
            env["SSL_CERT_FILE"] = certifi.where()
        except ImportError:
            pass

        result = subprocess.run([venv_python, setup_script], capture_output=True, text=True, env=env)
        if result.returncode != 0:
            logger.error(f"Error executing setup_spanner.py: {result.stderr}")
            raise Exception(result.stderr)
            
        logger.info("Spanner data regenerated successfully.")
        return {"status": "success", "message": "Database successfully re-seeded and regenerated."}
    except Exception as e:
        logger.error(f"Failed to regenerate data: {e}")
        raise HTTPException(status_code=500, detail=str(e))

# Serve static files from React build directory
DIST_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "frontend", "dist")
if os.path.exists(DIST_DIR):
    app.mount("/", StaticFiles(directory=DIST_DIR, html=True), name="static")

    # Fallback to index.html for SPA support
    @app.exception_handler(404)
    async def not_found_handler(request, exc):
        return FileResponse(os.path.join(DIST_DIR, "index.html"))
else:
    logger.warning(f"Frontend dist directory not found at {DIST_DIR}. Static files will not be served.")
