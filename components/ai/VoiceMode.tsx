"use client"

import React, { useState, useEffect, useRef } from 'react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Mic, MicOff, Phone, Volume2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { getAuthHeader } from '@/lib/auth/getAuthHeader'
import { usePersonalFeatureGate } from '@/hooks/use-feature-gate'

interface VoiceModeProps {
  onClose: () => void
  onTranscript?: (text: string, role: 'user' | 'assistant') => void
}

type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'
type ConversationState = 'idle' | 'listening' | 'thinking' | 'speaking'

export function VoiceMode({ onClose, onTranscript }: VoiceModeProps) {
  const aiGate = usePersonalFeatureGate('aiAgents')

  const [connectionState, setConnectionState] = useState<ConnectionState>('disconnected')
  const [conversationState, setConversationState] = useState<ConversationState>('idle')
  const [isMuted, setIsMuted] = useState(false)
  const [transcript, setTranscript] = useState<Array<{ role: 'user' | 'assistant', text: string }>>([])
  const [error, setError] = useState<string | null>(null)

  const wsRef = useRef<WebSocket | null>(null)
  const audioContextRef = useRef<AudioContext | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const audioQueueRef = useRef<AudioBuffer[]>([])
  const isPlayingRef = useRef(false)

  // Initialize voice session
  useEffect(() => {
    connectToVoiceSession()

    return () => {
      disconnect()
    }
  }, [])

  const connectToVoiceSession = async () => {
    try {
      setConnectionState('connecting')
      setError(null)

      // PR-AUTH-5: cached auth header.
      const response = await fetch('/api/ai/voice-session', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeader()),
        },
        body: JSON.stringify({
          model: 'gpt-4o-realtime-preview-2024-12-17',
          voice: 'alloy',
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to create voice session')
      }

      const data = await response.json()
      const { client_secret } = data.session

      // Connect to OpenAI Realtime API via WebSocket
      // Note: Browser WebSocket doesn't support custom headers, so we use query params
      const ws = new WebSocket(
        `wss://api.openai.com/v1/realtime?model=gpt-4o-realtime-preview-2024-12-17&api_key=${client_secret}`
      )

      wsRef.current = ws

      ws.onopen = () => {
        logger.info('Voice session connected')
        setConnectionState('connected')
        setConversationState('idle')

        // Send initial session configuration
        ws.send(JSON.stringify({
          type: 'session.update',
          session: {
            modalities: ['text', 'audio'],
            instructions: 'You are a helpful AI assistant for ChainReact, a workflow automation platform. Help users with their questions about integrations, workflows, and automation.',
            voice: 'alloy',
            input_audio_format: 'pcm16',
            output_audio_format: 'pcm16',
            input_audio_transcription: {
              model: 'whisper-1',
            },
            turn_detection: {
              type: 'server_vad',
              threshold: 0.5,
              prefix_padding_ms: 300,
              silence_duration_ms: 500,
            },
          },
        }))

        // Start capturing microphone audio
        startAudioCapture()
      }

      ws.onmessage = (event) => {
        handleWebSocketMessage(JSON.parse(event.data))
      }

      ws.onerror = (error) => {
        logger.error('WebSocket error:', error)
        setError('Connection error occurred')
        setConnectionState('error')
      }

      ws.onclose = () => {
        logger.info('Voice session closed')
        setConnectionState('disconnected')
        setConversationState('idle')
      }
    } catch (error: any) {
      logger.error('Failed to connect to voice session:', error)
      setError(error.message || 'Failed to connect')
      setConnectionState('error')
    }
  }

  const handleWebSocketMessage = (message: any) => {
    switch (message.type) {
      case 'session.created':
      case 'session.updated':
        logger.info('Session updated:', message)
        break

      case 'input_audio_buffer.speech_started':
        setConversationState('listening')
        break

      case 'input_audio_buffer.speech_stopped':
        setConversationState('thinking')
        break

      case 'conversation.item.input_audio_transcription.completed':
        // User speech transcribed
        const userText = message.transcript
        setTranscript(prev => [...prev, { role: 'user', text: userText }])
        if (onTranscript) {
          onTranscript(userText, 'user')
        }
        break

      case 'response.audio_transcript.delta':
        // AI speech transcription (streaming)
        setConversationState('speaking')
        break

      case 'response.audio_transcript.done':
        // AI speech completed
        const assistantText = message.transcript
        setTranscript(prev => [...prev, { role: 'assistant', text: assistantText }])
        if (onTranscript) {
          onTranscript(assistantText, 'assistant')
        }
        setConversationState('idle')
        break

      case 'response.audio.delta':
        // Receive audio chunk from AI
        if (message.delta) {
          const audioData = base64ToArrayBuffer(message.delta)
          queueAudioChunk(audioData)
        }
        break

      case 'response.done':
        setConversationState('idle')
        break

      case 'error':
        logger.error('Realtime API error:', message.error)
        setError(message.error.message || 'An error occurred')
        break

      default:
        logger.info('Unhandled message type:', message.type)
    }
  }

  const startAudioCapture = async () => {
    try {
      // Request microphone access
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      mediaStreamRef.current = stream

      // Create audio context
      const audioContext = new AudioContext({ sampleRate: 24000 })
      audioContextRef.current = audioContext

      // Create media stream source
      const source = audioContext.createMediaStreamSource(stream)

      // Create script processor for audio processing
      const processor = audioContext.createScriptProcessor(4096, 1, 1)

      processor.onaudioprocess = (event) => {
        if (isMuted || !wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
          return
        }

        // Get audio data
        const inputData = event.inputBuffer.getChannelData(0)

        // Convert to PCM16
        const pcm16 = new Int16Array(inputData.length)
        for (let i = 0; i < inputData.length; i++) {
          const s = Math.max(-1, Math.min(1, inputData[i]))
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF
        }

        // Send to WebSocket as base64
        const base64Audio = arrayBufferToBase64(pcm16.buffer)
        wsRef.current.send(JSON.stringify({
          type: 'input_audio_buffer.append',
          audio: base64Audio,
        }))
      }

      source.connect(processor)
      processor.connect(audioContext.destination)

      logger.info('Audio capture started')
    } catch (error: any) {
      logger.error('Failed to start audio capture:', error)
      setError('Microphone access denied')
    }
  }

  const queueAudioChunk = async (audioData: ArrayBuffer) => {
    if (!audioContextRef.current) return

    try {
      // Convert PCM16 to AudioBuffer
      const pcm16 = new Int16Array(audioData)
      const audioBuffer = audioContextRef.current.createBuffer(1, pcm16.length, 24000)
      const channelData = audioBuffer.getChannelData(0)

      for (let i = 0; i < pcm16.length; i++) {
        channelData[i] = pcm16[i] / (pcm16[i] < 0 ? 0x8000 : 0x7FFF)
      }

      audioQueueRef.current.push(audioBuffer)

      // Start playing if not already playing
      if (!isPlayingRef.current) {
        playNextAudioChunk()
      }
    } catch (error) {
      logger.error('Failed to process audio chunk:', error)
    }
  }

  const playNextAudioChunk = async () => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false
      return
    }

    isPlayingRef.current = true
    const audioBuffer = audioQueueRef.current.shift()!

    if (!audioContextRef.current) return

    const source = audioContextRef.current.createBufferSource()
    source.buffer = audioBuffer
    source.connect(audioContextRef.current.destination)

    source.onended = () => {
      playNextAudioChunk()
    }

    source.start()
  }

  const toggleMute = () => {
    setIsMuted(!isMuted)
  }

  const disconnect = () => {
    // Close WebSocket
    if (wsRef.current) {
      wsRef.current.close()
      wsRef.current = null
    }

    // Stop media stream
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop())
      mediaStreamRef.current = null
    }

    // Close audio context
    if (audioContextRef.current) {
      audioContextRef.current.close()
      audioContextRef.current = null
    }

    audioQueueRef.current = []
    isPlayingRef.current = false
  }

  // Utility functions
  const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
    const bytes = new Uint8Array(buffer)
    let binary = ''
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i])
    }
    return btoa(binary)
  }

  const base64ToArrayBuffer = (base64: string): ArrayBuffer => {
    const binary = atob(base64)
    const bytes = new Uint8Array(binary.length)
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i)
    }
    return bytes.buffer
  }

  const getStateColor = () => {
    switch (conversationState) {
      case 'listening': return 'text-orange-500'
      case 'thinking': return 'text-yellow-500'
      case 'speaking': return 'text-green-500'
      default: return 'text-muted-foreground'
    }
  }

  const getStateText = () => {
    if (connectionState === 'connecting') return 'Connecting...'
    if (connectionState === 'error') return error || 'Error occurred'

    switch (conversationState) {
      case 'listening': return 'Listening...'
      case 'thinking': return 'Thinking...'
      case 'speaking': return 'Speaking...'
      default: return 'Ready to talk'
    }
  }

  if (!aiGate.allowed) {
    return (
      <div className="p-4 text-center text-sm text-muted-foreground">
        <p>AI features require a Pro plan or higher.</p>
        <Link href="/subscription" className="text-primary underline mt-2 inline-block">Upgrade your plan</Link>
      </div>
    )
  }

  return (
    <div className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 flex items-center justify-center">
      <Card className="w-full max-w-lg mx-4">
        <CardContent className="p-8">
          {/* Status */}
          <div className="text-center mb-8">
            <div className={cn("text-6xl mb-4 transition-colors", getStateColor())}>
              {conversationState === 'listening' && <Mic className="w-16 h-16 mx-auto animate-pulse" />}
              {conversationState === 'thinking' && <Loader2 className="w-16 h-16 mx-auto animate-spin" />}
              {conversationState === 'speaking' && <Volume2 className="w-16 h-16 mx-auto animate-pulse" />}
              {conversationState === 'idle' && <Mic className="w-16 h-16 mx-auto" />}
            </div>

            <h2 className="text-2xl font-semibold mb-2">Voice Assistant</h2>
            <p className={cn("text-sm", getStateColor())}>
              {getStateText()}
            </p>
          </div>

          {/* Waveform visualization placeholder */}
          <div className="h-24 bg-muted/50 rounded-lg mb-8 flex items-center justify-center">
            <div className="flex gap-1 items-center h-full">
              {[...Array(20)].map((_, i) => (
                <div
                  key={i}
                  className={cn(
                    "w-1 bg-primary rounded-full transition-all",
                    conversationState === 'listening' || conversationState === 'speaking'
                      ? "animate-pulse"
                      : ""
                  )}
                  style={{
                    height: conversationState === 'listening' || conversationState === 'speaking'
                      ? `${Math.random() * 60 + 20}%`
                      : '20%',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Recent transcript */}
          {transcript.length > 0 && (
            <div className="mb-6 max-h-32 overflow-y-auto space-y-2 text-sm">
              {transcript.slice(-3).map((item, index) => (
                <div
                  key={index}
                  className={cn(
                    "p-2 rounded",
                    item.role === 'user' ? 'bg-primary/10 text-right' : 'bg-muted'
                  )}
                >
                  <span className="font-medium text-xs opacity-70">
                    {item.role === 'user' ? 'You: ' : 'AI: '}
                  </span>
                  {item.text}
                </div>
              ))}
            </div>
          )}

          {/* Controls */}
          <div className="flex gap-4 justify-center">
            <Button
              size="lg"
              variant="outline"
              onClick={toggleMute}
              disabled={connectionState !== 'connected'}
            >
              {isMuted ? <MicOff className="w-5 h-5" /> : <Mic className="w-5 h-5" />}
            </Button>

            <Button
              size="lg"
              variant="destructive"
              onClick={() => {
                disconnect()
                onClose()
              }}
            >
              <Phone className="w-5 h-5 mr-2" />
              End Call
            </Button>
          </div>

          {/* Error message */}
          {error && connectionState === 'error' && (
            <div className="mt-4 text-center">
              <p className="text-sm text-destructive mb-2">{error}</p>
              <Button
                size="sm"
                variant="outline"
                onClick={connectToVoiceSession}
              >
                Retry Connection
              </Button>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
