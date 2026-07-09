import { useState, useEffect, useRef } from 'react'
import { Send, RefreshCw, BarChart2, Code } from 'lucide-react'
import './App.css'

function App() {
  const [presets, setPresets] = useState([])
  const [selectedPlayerId, setSelectedPlayerId] = useState(null)
  
  // Game session states
  const [playerInfo, setPlayerInfo] = useState(null)
  const [relationship, setRelationship] = useState(null)
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

  const messagesEndRef = useRef(null)

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
        
        // Load initial dialogs
        const dialogList = data.dialogues.map(d => ({
          sender: d.speaker === 'Slamy' ? 'companion' : 'user',
          text: d.text,
          tag: d.tag,
          timestamp: d.timestamp
        }))
        setMessages(dialogList)
        
        // Log GQL queries for this action
        setGqlLog(prev => ({
          ...prev,
          sessionGql: `GRAPH GameMemoryGraph\nMATCH (p:Players {player_id: ${playerId}})-[r:Player_Companion_Relations]->(c:AI_Companions)\nRETURN r.relationship_level, r.bond_points, r.companion_status, c.name`
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
      
      // Display Slamy's reply
      setMessages(prev => [...prev, {
        sender: 'companion',
        text: data.reply,
        tag: data.audio_tag
      }])

      // Display spanner vector memories retrieved
      setSemanticMemories(data.semantic_memories_retrieved || [])

      // Log Chat GQL write
      setGqlLog(prev => ({
        ...prev,
        chatGql: `INSERT INTO Dialogue_Edges (dialogue_id, player_id, companion_id, speaker, text_content, audio_tag, embedding, timestamp)\nVALUES (uuid(), ${selectedPlayerId}, 'slamy', '${playerInfo.name}', '${userMsg}', null, [array], now());`
      }))

      // Update analytics
      fetchAnalytics(selectedPlayerId)

    } catch (err) {
      console.error("Failed to send message:", err)
      setMessages(prev => [...prev, {
        sender: 'companion',
        text: "My slime memory core is acting up... [sad] Could you say that again?",
        tag: "[sad]"
      }])
    } finally {
      setIsTyping(false)
    }
  }

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

        {/* Middle Column: Slamy Chat RPG Portal */}
        <main className="game-panel">
          <div className="game-panel-header">
            <div className="flex items-center gap-2">
              <div className="companion-avatar-slime"></div>
              <span>Talk with Slamy</span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--text-gray)' }}>RPG Game client (Simulated via Gemini TTS text format)</span>
          </div>

          <div className="chat-window">
            <div className="chat-messages-area">
              {messages.map((m, idx) => (
                <div key={idx} className={`chat-bubble-wrapper ${m.sender}`}>
                  {m.sender === 'companion' && (
                    <div className="companion-avatar-slime" style={{ animationDelay: `${idx * 0.1}s` }}>
                      Sm
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
                  <div className="companion-avatar-slime">Sm</div>
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
              <input 
                type="text" 
                className="chat-text-input" 
                placeholder={`Type here to speak to Slamy...`}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                disabled={isTyping || !selectedPlayerId}
              />
              <button 
                type="submit" 
                className="btn-send flex items-center justify-center"
                disabled={!inputText.trim() || isTyping || !selectedPlayerId}
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

          <div className="game-panel-body" style={{ overflowY: 'auto', maxHeight: '500px' }}>
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
                      No vector lookup executed yet. Speak to Slamy to trigger long-term semantic memory retrieval.
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
                      No companion sentiment logged yet. Speak with Slamy to build analytics dataset.
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
