import { useState, useEffect, useRef } from 'react'
import { Send, RefreshCw, BarChart2, Code, Mic, Square, Volume2, VolumeX } from 'lucide-react'
import './App.css'

const getVoiceGender = (voice) => {
  const name = voice.name.toLowerCase();
  const femaleNames = [
    'samantha', 'victoria', 'fiona', 'karen', 'moira', 'tessa', 'veena', 'zira', 
    'susan', 'hazel', 'kyoko', 'yumi', 'zuzana', 'amelie', 'anna', 'alice', 
    'ellen', 'joana', 'katya', 'milena', 'mónica', 'paulina', 'sara', 'satomi', 
    'sin-ji', 'ting-ting', 'yelena', 'siri female', 'google us english', 
    'microsoft zira', 'microsoft haruka', 'microsoft heami'
  ];
  const maleNames = [
    'alex', 'daniel', 'fred', 'rishi', 'oliver', 'george', 'thomas', 'alan', 
    'ravi', 'siri male', 'microsoft david', 'microsoft ichiro', 'google uk english male'
  ];
  
  if (name.includes('female') || femaleNames.some(f => name.includes(f))) {
    return 'female';
  }
  if (name.includes('male') || maleNames.some(m => name.includes(m))) {
    return 'male';
  }
  return 'neutral';
};

function App() {
  const [presets, setPresets] = useState([])
  const [selectedPlayerId, setSelectedPlayerId] = useState(null)
  
  // Game session states
  const [playerInfo, setPlayerInfo] = useState(null)
  const [relationship, setRelationship] = useState(null)
  const [allRelationships, setAllRelationships] = useState([])
  const [friends, setFriends] = useState([])
  const [messages, setMessages] = useState([])
  const [inputText, setInputText] = useState('')
  const [isTyping, setIsTyping] = useState(false)
  const [activeTab, setActiveTab] = useState('technical') // 'technical' or 'analytics'

  // Spanner debug insights
  const [gqlLog, setGqlLog] = useState({
    sessionGql: '',
    chatGql: ''
  })
  const [semanticMemories, setSemanticMemories] = useState([])
  const [analytics, setAnalytics] = useState({
    emotions: [],
    sentiment_timeline: []
  })

  // Graph interaction states
  const [graphZoom, setGraphZoom] = useState(1.0)
  const [selectedGraphNodeId, setSelectedGraphNodeId] = useState(null)
  
  // Voice Recording states
  const [isRecording, setIsRecording] = useState(false)
  const [mediaRecorder, setMediaRecorder] = useState(null)

  // Voice Synthesis (TTS) states
  const [isVoiceEnabled, setIsVoiceEnabled] = useState(true)
  const [voices, setVoices] = useState([])
  const [selectedVoice, setSelectedVoice] = useState(null)
  const [voiceGenderFilter, setVoiceGenderFilter] = useState('all')

  const messagesEndRef = useRef(null)

  // Load speechSynthesis voices
  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return;

    const loadVoices = () => {
      const allVoices = window.speechSynthesis.getVoices();
      // Filter to English voices for companion context
      const englishVoices = allVoices.filter(v => v.lang.startsWith('en'));
      const listToUse = englishVoices.length > 0 ? englishVoices : allVoices;

      setVoices(listToUse);

      // Select default female voice if none selected yet
      if (listToUse.length > 0 && !selectedVoice) {
        const femaleDefault = listToUse.find(v => getVoiceGender(v) === 'female') || listToUse[0];
        setSelectedVoice(femaleDefault.name);
      }
    };

    loadVoices();
    if (window.speechSynthesis.onvoiceschanged !== undefined) {
      window.speechSynthesis.onvoiceschanged = loadVoices;
    }
  }, [selectedVoice]);

  // Handle auto-updating voice selection when filter changes
  useEffect(() => {
    if (voices.length === 0) return;

    const filtered = voices.filter(v => {
      if (voiceGenderFilter === 'all') return true;
      return getVoiceGender(v) === voiceGenderFilter;
    });

    if (filtered.length > 0 && !filtered.some(v => v.name === selectedVoice)) {
      setSelectedVoice(filtered[0].name);
    }
  }, [voiceGenderFilter, voices, selectedVoice]);

  // Fetch initial player presets
  useEffect(() => {
    fetchPresets()
  }, [])

  // Auto-scroll chat to bottom
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isTyping])

  // Fetch session details whenever player changes
  useEffect(() => {
    if (selectedPlayerId) {
      fetchSessionContext(selectedPlayerId)
      fetchAnalytics(selectedPlayerId)
    }
  }, [selectedPlayerId])

  const fetchPresets = async () => {
    try {
      const res = await fetch('/api/presets')
      if (res.ok) {
        const data = await res.json()
        setPresets(data)
        if (data.length > 0) {
          setSelectedPlayerId(data[0].id)
        }
      }
    } catch (err) {
      console.error("Error fetching presets:", err)
    }
  }

  const fetchSessionContext = async (playerId) => {
    try {
      const res = await fetch(`/api/session/${playerId}`)
      if (res.ok) {
        const data = await res.json()
        setPlayerInfo(data.player)
        setRelationship(data.relationship)
        setAllRelationships(data.all_relationships || [data.relationship])
        setFriends(data.friends || [])
        
        // Load initial dialogs
        const dialogList = data.dialogues.map(d => ({
          sender: d.speaker === 'Lumi' ? 'companion' : 'user',
          text: d.text,
          tag: d.tag,
          timestamp: d.timestamp
        }))
        setMessages(dialogList)
        
        // Log GQL queries for this action
        setGqlLog(prev => ({
          ...prev,
          sessionGql: `/* 1. Fetch Player & Active Companions */\nGRAPH GameMemoryGraph\nMATCH (p:Players {player_id: ${playerId}})-[r:Player_Companion_Relations]->(c:AI_Companions)\nRETURN r.relationship_level, r.bond_points, r.companion_status, c.name\n\n/* 2. Fetch Friends & Their Respective Companions (Multi-hop) */\nGRAPH GameMemoryGraph\nMATCH (p1:Players {player_id: ${playerId}})-[f:Player_Friend_Relations]-(p2:Players)-[r:Player_Companion_Relations]->(c:AI_Companions)\nRETURN p2.name, r.relationship_level, c.name`
        }))
      }
    } catch (err) {
      console.error("Error fetching session context:", err)
    }
  }

  const fetchAnalytics = async (playerId) => {
    try {
      const res = await fetch(`/api/analytics/${playerId}`)
      if (res.ok) {
        const data = await res.json()
        setAnalytics(data)
      }
    } catch (err) {
      console.error("Error fetching analytics:", err)
    }
  }

  const speakText = (text) => {
    if (!isVoiceEnabled || typeof window === 'undefined' || !window.speechSynthesis) return;

    // Cancel any active/queued speech first
    window.speechSynthesis.cancel();

    // Strip [tags] from text
    const cleanText = text.replace(/\[.*?\]/g, '').trim();
    if (!cleanText) return;

    const utterance = new SpeechSynthesisUtterance(cleanText);
    
    // Set selected voice
    if (selectedVoice) {
      const voiceObj = voices.find(v => v.name === selectedVoice);
      if (voiceObj) {
        utterance.voice = voiceObj;
      }
    }
    
    window.speechSynthesis.speak(utterance);
  };

  const handleSendMessage = async (e) => {
    e.preventDefault()
    if (!inputText.trim() || !selectedPlayerId) return

    const userMsg = inputText.trim()
    setInputText('')
    
    // Add user message locally
    setMessages(prev => [...prev, { sender: 'user', text: userMsg }])
    setIsTyping(true)
    
    try {
      const res = await fetch('/api/companion/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: parseInt(selectedPlayerId),
          message: userMsg
        })
      })

      if (!res.ok) {
        throw new Error("Chat request failed")
      }

      const data = await res.json()
      
      // Update relationship bar
      setRelationship(data.relationship)
      
      // Display Lumi's reply
      setMessages(prev => [...prev, {
        sender: 'companion',
        text: data.reply,
        tag: data.audio_tag
      }])

      // Speak the text
      speakText(data.reply)

      // Display spanner vector memories retrieved
      setSemanticMemories(data.semantic_memories_retrieved || [])

      // Log Chat GQL write
      setGqlLog(prev => ({
        ...prev,
        chatGql: `INSERT INTO Dialogue_Edges (dialogue_id, player_id, companion_id, speaker, text_content, audio_tag, embedding, timestamp)\nVALUES (uuid(), ${selectedPlayerId}, 'lumi', '${playerInfo.name}', '${userMsg}', null, [array], now());`
      }))

      // Update analytics
      fetchAnalytics(selectedPlayerId)

    } catch (err) {
      console.error("Failed to send message:", err)
      const errorMsg = "My slime memory core is acting up... [sad] Could you say that again?"
      setMessages(prev => [...prev, {
        sender: 'companion',
        text: errorMsg,
        tag: "[sad]"
      }])
      speakText(errorMsg)
    } finally {
      setIsTyping(false)
    }
  }

  const startRecording = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
      const chunks = [];
      
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunks.push(e.data);
        }
      };

      recorder.onstop = async () => {
        const audioBlob = new Blob(chunks, { type: 'audio/webm' });
        // Convert blob to base64
        const reader = new FileReader();
        reader.readAsDataURL(audioBlob);
        reader.onloadend = () => {
          const base64data = reader.result.split(',')[1];
          sendVoiceMessage(base64data);
        };
        // Stop all tracks on the stream to release the mic
        stream.getTracks().forEach(track => track.stop());
      };

      recorder.start();
      setMediaRecorder(recorder);
      setIsRecording(true);
    } catch (err) {
      console.error("Failed to access microphone:", err);
      alert("Microphone access is required to use voice chat.");
    }
  };

  const stopRecording = () => {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
      setIsRecording(false);
    }
  };

  const toggleRecording = () => {
    if (isRecording) {
      stopRecording();
    } else {
      startRecording();
    }
  };

  const sendVoiceMessage = async (base64data) => {
    if (!selectedPlayerId) return;
    setIsTyping(true);
    // Add dummy player message locally while processing
    setMessages(prev => [...prev, { sender: 'user', text: "🎤 [Processing voice input...]" }]);

    try {
      const res = await fetch('/api/companion/chat-voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          player_id: parseInt(selectedPlayerId),
          audio_base64: base64data,
          mime_type: 'audio/webm'
        })
      });

      if (!res.ok) {
        throw new Error("Voice chat request failed");
      }

      const data = await res.json();
      
      // Update relationship bar
      setRelationship(data.relationship);
      
      // Remove the last message (the "[Processing voice input...]") and replace it with actual transcription
      setMessages(prev => {
        const copy = [...prev];
        if (copy.length > 0 && copy[copy.length - 1].text.startsWith("🎤")) {
          copy.pop(); // Remove processing msg
        }
        return [...copy, { 
          sender: 'user', 
          text: data.transcription, 
          tag: data.player_sentiment ? `[${data.player_sentiment}]` : null 
        }];
      });

      // Display Lumi's reply
      setMessages(prev => [...prev, {
        sender: 'companion',
        text: data.reply,
        tag: data.audio_tag
      }]);

      // Speak the text
      speakText(data.reply);

      // Display spanner vector memories retrieved
      setSemanticMemories(data.semantic_memories_retrieved || []);

      // Log Chat GQL write
      setGqlLog(prev => ({
        ...prev,
        chatGql: `INSERT INTO Dialogue_Edges (dialogue_id, player_id, companion_id, speaker, text_content, audio_tag, embedding, timestamp)\nVALUES (uuid(), ${selectedPlayerId}, 'lumi', '${playerInfo.name}', '${data.transcription}', '${data.player_sentiment ? `[${data.player_sentiment}]` : 'null'}', [array], now());`
      }));

      // Update analytics
      fetchAnalytics(selectedPlayerId);

    } catch (err) {
      console.error("Failed to send voice message:", err);
      const errorMsg = "My voice recognition core is acting up... [sad] Could you speak again?";
      setMessages(prev => {
        const copy = [...prev];
        if (copy.length > 0 && copy[copy.length - 1].text.startsWith("🎤")) {
          copy.pop();
        }
        return [...copy, {
          sender: 'companion',
          text: errorMsg,
          tag: "[sad]"
        }];
      });
      speakText(errorMsg);
    } finally {
      setIsTyping(false);
    }
  };

  const handleRegenerateData = async () => {
    if (!window.confirm("Warning: This will reload the Spanner database schemas and re-seed the default dialogue presets. Proceed?")) {
      return
    }

    try {
      const res = await fetch('/api/regenerate-data', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true })
      })

      if (res.ok) {
        alert("Database successfully re-seeded!")
        // Reload presets and active session
        await fetchPresets()
        if (selectedPlayerId) {
          fetchSessionContext(selectedPlayerId)
          fetchAnalytics(selectedPlayerId)
        }
      } else {
        alert("Failed to regenerate database.")
      }
    } catch (err) {
      console.error("Failed to regenerate data:", err)
      alert("Error occurred while communicating with database setup script.")
    }
  }

  // Get emotion styles for tags
  const getEmotionClass = (tag) => {
    if (!tag) return '';
    const cleanTag = tag.replace('[', '').replace(']', '');
    return cleanTag;
  }

  // Visual SVG Graph representation of GQL matching output
  const renderVisualGraph = () => {
    if (!playerInfo) return null;

    const width = 450;
    const height = 280;

    // 1. Define Node Coordinates
    const playerNode = { id: 'player', x: 225, y: 140, name: playerInfo.name, type: 'player', level: playerInfo.level };

    // Unique list of friends
    const friendNodes = friends.reduce((acc, f) => {
      if (!acc.some(x => x.name === f.friend_name)) {
        acc.push({
          id: `friend_${f.friend_name}`,
          name: f.friend_name,
          x: 60,
          type: 'friend'
        });
      }
      return acc;
    }, []);

    friendNodes.forEach((f, i) => {
      const total = friendNodes.length;
      f.y = total === 1 ? 140 : 50 + i * (180 / (total - 1));
    });

    // Unique list of companions (both player's and friends')
    const companionNodes = [];
    allRelationships.forEach(rel => {
      if (!companionNodes.some(x => x.id === rel.companion_id)) {
        companionNodes.push({
          id: rel.companion_id,
          name: rel.companion_name,
          type: 'companion',
          status: rel.companion_status,
          level: rel.relationship_level
        });
      }
    });

    friends.forEach(f => {
      if (!companionNodes.some(x => x.id === f.companion_id)) {
        companionNodes.push({
          id: f.companion_id,
          name: f.companion_name,
          type: 'companion',
          status: 'Resting',
          level: f.relationship_level
        });
      }
    });

    companionNodes.forEach((c, i) => {
      const total = companionNodes.length;
      c.x = 390;
      c.y = total === 1 ? 140 : 50 + i * (180 / (total - 1));
    });

    // 2. Define Edge Connections
    const edges = [];

    // Player -> Companions (GQL 1-hop active path)
    allRelationships.forEach(c => {
      const cNode = companionNodes.find(x => x.id === c.companion_id);
      if (cNode) {
        edges.push({
          source: playerNode,
          target: cNode,
          label: `lvl ${c.relationship_level}`,
          color: 'var(--text-cyan)',
          dashed: false,
          markerId: 'arrow-cyan'
        });
      }
    });

    // Player -> Friends (dashed edge)
    friendNodes.forEach(f => {
      edges.push({
        source: playerNode,
        target: f,
        label: 'friend',
        color: 'rgba(255, 255, 255, 0.35)',
        dashed: true,
        markerId: 'arrow-gray'
      });
    });

    // Friends -> Companions (GQL multi-hop GQL recommendation match)
    friends.forEach(f => {
      const fNode = friendNodes.find(x => x.name === f.friend_name);
      const cNode = companionNodes.find(x => x.id === f.companion_id);
      if (fNode && cNode) {
        edges.push({
          source: fNode,
          target: cNode,
          label: `lvl ${f.relationship_level}`,
          color: 'var(--text-purple)',
          dashed: false,
          markerId: 'arrow-purple'
        });
      }
    });

    // Zoom calculations for centering
    const translateX = (1 - graphZoom) * 225;
    const translateY = (1 - graphZoom) * 140;

    // Helper functions for linkage selection highlight
    const isNodeSelected = (nodeId) => selectedGraphNodeId === nodeId;
    const isNodeConnected = (nodeId) => {
      if (!selectedGraphNodeId) return true;
      if (selectedGraphNodeId === nodeId) return true;
      return edges.some(e => 
        (e.source.id === selectedGraphNodeId && e.target.id === nodeId) ||
        (e.target.id === selectedGraphNodeId && e.source.id === nodeId)
      );
    };

    const isEdgeConnected = (e) => {
      if (!selectedGraphNodeId) return true;
      return e.source.id === selectedGraphNodeId || e.target.id === selectedGraphNodeId;
    };

    const handleNodeClick = (nodeId) => {
      if (selectedGraphNodeId === nodeId) {
        setSelectedGraphNodeId(null);
      } else {
        setSelectedGraphNodeId(nodeId);
      }
    };

    return (
      <div style={{ marginTop: '15px', position: 'relative' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
          <h5 style={{ fontSize: '0.7rem', color: 'var(--text-purple)', textTransform: 'uppercase', letterSpacing: '0.5px' }}>
            Interactive Database Property Graph
          </h5>
          {selectedGraphNodeId && (
            <span style={{ fontSize: '0.55rem', color: '#ffea00', background: 'rgba(255, 234, 0, 0.1)', padding: '2px 6px', borderRadius: '4px', border: '1px solid rgba(255, 234, 0, 0.2)' }}>
              Linkage filter active. Click node again to reset.
            </span>
          )}
        </div>

        {/* Zoom Controls */}
        <div style={{ position: 'absolute', top: '30px', right: '10px', display: 'flex', gap: '4px', zIndex: 10 }}>
          <button 
            onClick={() => setGraphZoom(z => Math.min(2.0, z + 0.15))} 
            className="btn-control-secondary" 
            style={{ padding: '2px 6px', fontSize: '9px', fontWeight: 'bold' }}
            title="Zoom In"
          >
            ＋
          </button>
          <button 
            onClick={() => setGraphZoom(z => Math.max(0.5, z - 0.15))} 
            className="btn-control-secondary" 
            style={{ padding: '2px 6px', fontSize: '9px', fontWeight: 'bold' }}
            title="Zoom Out"
          >
            －
          </button>
          <button 
            onClick={() => { setGraphZoom(1.0); setSelectedGraphNodeId(null); }} 
            className="btn-control-secondary" 
            style={{ padding: '2px 6px', fontSize: '9px', textTransform: 'none' }}
            title="Reset Graph"
          >
            Reset
          </button>
        </div>

        <svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`} style={{ background: '#070b13', borderRadius: '8px', border: '1px solid rgba(0, 240, 255, 0.12)', cursor: 'grab' }}>
          <defs>
            <marker id="arrow-cyan" markerWidth="6" markerHeight="6" refX="19" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="var(--text-cyan)" />
            </marker>
            <marker id="arrow-purple" markerWidth="6" markerHeight="6" refX="19" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="var(--text-purple)" />
            </marker>
            <marker id="arrow-gray" markerWidth="6" markerHeight="6" refX="19" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="rgba(255,255,255,0.35)" />
            </marker>
          </defs>

          {/* Group wrapping zoom transform */}
          <g transform={`translate(${translateX}, ${translateY}) scale(${graphZoom})`} style={{ transition: 'transform 0.25s ease-out' }}>
            
            {/* Render Connections (Edges) */}
            {edges.map((e, idx) => {
              const connected = isEdgeConnected(e);
              return (
                <g key={idx} style={{ opacity: connected ? 1 : 0.08, transition: 'opacity 0.25s ease' }}>
                  <line
                    x1={e.source.x}
                    y1={e.source.y}
                    x2={e.target.x}
                    y2={e.target.y}
                    stroke={e.color}
                    strokeWidth={connected && selectedGraphNodeId ? 2 : 1.5}
                    strokeDasharray={e.dashed ? '3,3' : 'none'}
                    markerEnd={`url(#${e.markerId})`}
                  />
                  <rect
                    x={(e.source.x + e.target.x) / 2 - 20}
                    y={(e.source.y + e.target.y) / 2 - 5}
                    width={40}
                    height={10}
                    fill="#070b13"
                    rx={2}
                  />
                  <text
                    x={(e.source.x + e.target.x) / 2}
                    y={(e.source.y + e.target.y) / 2 + 2}
                    fill={e.color}
                    fontSize="6px"
                    textAnchor="middle"
                    fontWeight="bold"
                  >
                    {e.label}
                  </text>
                </g>
              );
            })}

            {/* Render Circular Nodes */}
            {[playerNode, ...companionNodes, ...friendNodes].map((n, idx) => {
              const isPlayer = n.type === 'player';
              const isFriend = n.type === 'friend';
              const isSel = isNodeSelected(n.id);
              const connected = isNodeConnected(n.id);
              
              let strokeColor = 'var(--text-purple)';
              if (isPlayer) strokeColor = 'var(--text-cyan)';
              if (isFriend) strokeColor = '#94a3b8';

              return (
                <g 
                  key={idx} 
                  transform={`translate(${n.x}, ${n.y})`}
                  onClick={() => handleNodeClick(n.id)}
                  style={{ 
                    cursor: 'pointer',
                    opacity: connected ? 1 : 0.12, 
                    transition: 'opacity 0.25s ease, filter 0.25s ease' 
                  }}
                >
                  <circle
                    r={isPlayer ? 18 : 15}
                    fill={isSel ? '#1e293b' : '#0d1627'}
                    stroke={isSel ? '#ffea00' : strokeColor}
                    strokeWidth={isSel ? 3 : 2}
                    style={{ 
                      filter: isSel 
                        ? 'drop-shadow(0 0 6px #ffea00)' 
                        : isPlayer 
                          ? 'drop-shadow(0 0 4px rgba(0,240,255,0.35))' 
                          : 'none' 
                    }}
                  />
                  <text y={4} textAnchor="middle" fontSize={isPlayer ? '11px' : '9px'}>
                    {isPlayer ? '👤' : isFriend ? '👥' : n.id === 'lumi' ? '💧' : n.id === 'ignis' ? '🔥' : '🍃'}
                  </text>
                  <text y={24} fill="white" fontSize="8px" fontWeight="bold" textAnchor="middle">
                    {n.name}
                  </text>
                  <text y={32} fill="var(--text-gray)" fontSize="6px" textAnchor="middle">
                    {isPlayer ? `Lvl ${n.level}` : isFriend ? 'Friend' : n.status.split(' ')[0]}
                  </text>
                </g>
              );
            })}
          </g>
        </svg>
      </div>
    );
  }

  const filteredVoices = voices.filter(v => {
    if (voiceGenderFilter === 'all') return true;
    return getVoiceGender(v) === voiceGenderFilter;
  });

  return (
    <div className="game-layout">
      {/* Game Header Bar */}
      <header className="game-header">
        <div className="game-title-group">
          <h1>MEMORIA SPANNER</h1>
          <p>Real-Time Conversational AI NPC Companion Memory Core</p>
        </div>
        <div className="flex items-center gap-4">
          <button onClick={handleRegenerateData} className="btn-control-secondary flex items-center gap-1.5">
            <RefreshCw size={13} />
            Reset & Seeding Database
          </button>
          <div className="engine-status-badge">
            <div className="engine-dot"></div>
            Spanner Active
          </div>
        </div>
      </header>

      {/* Main Grid */}
      <div className="game-grid">
        
        {/* Left Column: Player Heroes Select & Profile Status */}
        <aside className="flex flex-col gap-5">
          {/* Hero Select Panel */}
          <div className="game-panel">
            <div className="game-panel-header">Select Player Hero</div>
            <div className="game-panel-body">
              {presets.map(p => (
                <div 
                  key={p.id} 
                  className={`hero-card ${selectedPlayerId === p.id ? 'active' : ''}`}
                  onClick={() => setSelectedPlayerId(p.id)}
                >
                  <div className="hero-avatar">
                    {p.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="hero-details">
                    <h3 className="hero-name">{p.name}</h3>
                    <div className="hero-level">Level {p.level} • RPG Player</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Spanner Graph Session Info Panel */}
          {playerInfo && relationship && (
            <div className="game-panel">
              <div className="game-panel-header">Active Quest State</div>
              <div className="game-panel-body">
                <div className="stats-row">
                  <span className="stats-label">Active Quest</span>
                  <span className="stats-val" style={{ color: 'var(--text-cyan)' }}>{playerInfo.active_quest}</span>
                </div>
                <div className="stats-row">
                  <span className="stats-label">Player Level</span>
                  <span className="stats-val">Lvl {playerInfo.level}</span>
                </div>
                <div className="stats-row">
                  <span className="stats-label">Companion NPC</span>
                  <span className="stats-val">{relationship.companion_name}</span>
                </div>
                <div className="stats-row">
                  <span className="stats-label">Bond Level</span>
                  <span className="stats-val">Lvl {relationship.relationship_level}</span>
                </div>
                <div className="stats-row">
                  <span className="stats-label">Bond Points</span>
                  <span className="stats-val">{relationship.bond_points} / {relationship.relationship_level * 100}</span>
                </div>
                <div className="bond-bar-container">
                  <div 
                    className="bond-bar" 
                    style={{ width: `${(relationship.bond_points / (relationship.relationship_level * 100)) * 100}%` }}
                  />
                </div>
                <div className="stats-row" style={{ marginTop: '10px' }}>
                  <span className="stats-label">Status</span>
                  <span className="stats-val" style={{ color: '#39ff14' }}>{relationship.companion_status}</span>
                </div>
              </div>
            </div>
          )}
        </aside>

        {/* Middle Column: Lumi Chat RPG Portal */}
        <main className="game-panel">
          <div className="game-panel-header">
            <div className="flex items-center gap-2">
              <div className="companion-avatar-slime"></div>
              <span>Talk with Lumi</span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-gray)' }}>RPG Game client</span>
          </div>

          <div className="chat-window">
            {/* Voice Settings Bar */}
            <div className="voice-settings-bar">
              <button
                type="button"
                className="btn-voice-toggle"
                onClick={() => setIsVoiceEnabled(!isVoiceEnabled)}
                title={isVoiceEnabled ? "Disable Voice Output (TTS)" : "Enable Voice Output (TTS)"}
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: isVoiceEnabled ? 'var(--text-cyan)' : 'var(--text-gray)',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '0.8rem',
                  fontWeight: 'bold',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  transition: 'all 0.2s'
                }}
              >
                {isVoiceEnabled ? <Volume2 size={14} /> : <VolumeX size={14} />}
                <span>Voice Output</span>
              </button>

              {isVoiceEnabled && (
                <div className="voice-selectors" style={{ display: 'flex', gap: '12px', alignItems: 'center' }}>
                  <div className="voice-filter-group" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span>Gender:</span>
                    <select
                      value={voiceGenderFilter}
                      onChange={(e) => setVoiceGenderFilter(e.target.value)}
                      className="voice-control-select"
                    >
                      <option value="all">All</option>
                      <option value="female">Female</option>
                      <option value="male">Male</option>
                    </select>
                  </div>

                  <div className="voice-select-group" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                    <span>Voice:</span>
                    <select
                      value={selectedVoice || ''}
                      onChange={(e) => setSelectedVoice(e.target.value)}
                      className="voice-control-select"
                      style={{ maxWidth: '140px' }}
                    >
                      {filteredVoices.length > 0 ? (
                        filteredVoices.map(v => (
                          <option key={v.name} value={v.name}>
                            {v.name.replace(/Google/i, '').replace(/Microsoft/i, '').trim()}
                          </option>
                        ))
                      ) : (
                        <option value="">No English voices</option>
                      )}
                    </select>
                  </div>
                </div>
              )}
            </div>

            <div className="chat-messages-area">
              {messages.map((m, idx) => (
                <div key={idx} className={`chat-bubble-wrapper ${m.sender}`}>
                  {m.sender === 'companion' && (
                    <div className="companion-avatar-slime" style={{ animationDelay: `${idx * 0.1}s` }}>
                      Lu
                    </div>
                  )}
                  <div className="chat-bubble">
                    {m.tag && (
                      <span className={`audio-tag-badge ${getEmotionClass(m.tag)}`}>
                        {m.tag.replace('[', '').replace(']', '')}
                      </span>
                    )}
                    {m.text}
                  </div>
                </div>
              ))}

              {isTyping && (
                <div className="chat-bubble-wrapper companion">
                  <div className="companion-avatar-slime">Lu</div>
                  <div className="chat-bubble" style={{ background: '#1c2638', border: '1px solid rgba(255,255,255,0.06)' }}>
                    <div className="slime-typing-bubble">
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                      <div className="typing-dot"></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={messagesEndRef} />
            </div>

            <form onSubmit={handleSendMessage} className="chat-input-bar">
              <button
                type="button"
                className={`btn-mic flex items-center justify-center ${isRecording ? 'recording' : ''}`}
                onClick={toggleRecording}
                disabled={isTyping || !selectedPlayerId}
                title={isRecording ? "Stop recording" : "Record voice input"}
                style={{
                  background: isRecording ? '#ef4444' : 'transparent',
                  border: 'none',
                  color: isRecording ? 'white' : 'var(--text-gray)',
                  padding: '8px',
                  borderRadius: '50%',
                  cursor: 'pointer',
                  marginRight: '8px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition: 'all 0.25s ease',
                  boxShadow: isRecording ? '0 0 10px #ef4444' : 'none'
                }}
              >
                {isRecording ? <Square size={13} fill="white" /> : <Mic size={15} />}
              </button>
              <input 
                type="text" 
                className="chat-text-input" 
                placeholder={isRecording ? "Recording voice... Click square button to stop and send." : `Type here to speak to Lumi...`}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isTyping || !selectedPlayerId || isRecording}
              />
              <button 
                type="submit" 
                className="btn-send flex items-center justify-center"
                disabled={!inputText.trim() || isTyping || !selectedPlayerId || isRecording}
              >
                <Send size={15} />
              </button>
            </form>
          </div>
        </main>

        {/* Right Column: Spanner Graph & Vector Insights / Analytics */}
        <aside className="game-panel">
          <div className="panel-tab-bar">
            <div 
              className={`panel-tab ${activeTab === 'technical' ? 'active' : ''}`}
              onClick={() => setActiveTab('technical')}
            >
              <Code size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
              Spanner Hooks
            </div>
            <div 
              className={`panel-tab ${activeTab === 'analytics' ? 'active' : ''}`}
              onClick={() => setActiveTab('analytics')}
            >
              <BarChart2 size={14} style={{ verticalAlign: 'middle', marginRight: '6px' }} />
              Companion Analytics
            </div>
          </div>

          <div className="game-panel-body">
            {activeTab === 'technical' ? (
              <>
                {/* 1. Spanner Vector Match Context */}
                <div>
                  <h4 style={{ fontSize: '0.8rem', color: 'var(--text-purple)', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Vector Memory Hooks (Cosine Distance)
                  </h4>
                  {semanticMemories.length > 0 ? (
                    semanticMemories.map((m, idx) => (
                      <div key={idx} className="memory-match-card">
                        <div className="memory-match-header">
                          <span>{m.speaker}</span>
                          <span>Cosine Dist: {m.distance}</span>
                        </div>
                        <div className="memory-match-text">
                          {m.tag && <span className={`audio-tag-badge ${getEmotionClass(m.tag)}`}>{m.tag}</span>}
                          {m.text}
                        </div>
                      </div>
                    ))
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                      No vector lookup executed yet. Speak to Lumi to trigger long-term semantic memory retrieval.
                    </div>
                  )}
                </div>

                {/* 2. Spanner Graph GQL Log */}
                <div style={{ marginTop: '10px' }}>
                  <h4 style={{ fontSize: '0.8rem', color: 'var(--text-cyan)', textTransform: 'uppercase', marginBottom: '8px' }}>
                    Graph Query (GQL) execution
                  </h4>
                  <pre className="insight-log">
                    {gqlLog.sessionGql || "-- GQL queries will log here --"}
                  </pre>

                   {/* Render Visual Property Graph GQL Output */}
                   {renderVisualGraph()}
                </div>
              </>
            ) : (
              <>
                {/* Sentiment breakdown chart */}
                <div>
                  <h4 style={{ fontSize: '0.8rem', color: 'var(--text-purple)', textTransform: 'uppercase', marginBottom: '10px' }}>
                    Companion Emotion Breakdown
                  </h4>
                  {analytics.emotions.length > 0 ? (
                    <div className="sentiment-bar-chart">
                      {analytics.emotions.map((e, idx) => {
                        const maxCount = Math.max(...analytics.emotions.map(x => x.count));
                        const pct = (e.count / maxCount) * 100;
                        return (
                          <div key={idx} className="sentiment-chart-row">
                            <span className="sentiment-row-lbl">{e.tag.replace('[','').replace(']','')}</span>
                            <div className="sentiment-bar-track">
                              <div className="sentiment-bar-fill" style={{ width: `${pct}%`, background: getEmotionClass(e.tag) === 'scared' ? 'var(--secondary)' : 'var(--primary)' }} />
                            </div>
                            <span className="sentiment-row-cnt">{e.count}</span>
                          </div>
                        )
                      })}
                    </div>
                  ) : (
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                      No companion sentiment logged yet. Speak with Lumi to build analytics dataset.
                    </div>
                  )}
                </div>

                {/* Sentiment timeline */}
                <div style={{ marginTop: '20px' }}>
                  <h4 style={{ fontSize: '0.8rem', color: 'var(--text-cyan)', textTransform: 'uppercase', marginBottom: '10px' }}>
                    Conversational Sentiment Timeline
                  </h4>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {analytics.sentiment_timeline.map((t, idx) => (
                      <div key={idx} style={{ display: 'flex', justifycontent: 'space-between', fontSize: '0.75rem', borderBottom: '1px solid var(--border-dim)', paddingBottom: '4px' }}>
                        <span style={{ color: '#e2e8f0' }}>&quot;{t.text}&quot;</span>
                        <span style={{ color: t.value > 0 ? '#39ff14' : t.value < 0 ? '#ff4500' : 'var(--text-gray)', fontWeight: 'bold' }}>
                          {t.tag}
                        </span>
                      </div>
                    ))}
                    {analytics.sentiment_timeline.length === 0 && (
                      <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', fontStyle: 'italic' }}>
                        No history timeline generated yet.
                      </div>
                    )}
                  </div>
                </div>
              </>
            )}
          </div>
        </aside>

      </div>
    </div>
  )
}

export default App
