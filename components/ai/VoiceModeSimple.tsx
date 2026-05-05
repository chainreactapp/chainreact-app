"use client"

import React, { useState, useEffect, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Mic, MicOff, Phone, Volume2, Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { logger } from '@/lib/utils/logger'
import { getAuthHeader } from '@/lib/auth/getAuthHeader'

interface VoiceModeProps {
  onClose: () => void
  onTranscript?: (text: string, role: 'user' | 'assistant') => void
}

type ConversationState = 'idle' | 'listening' | 'thinking' | 'speaking'

// Module-level flag to prevent double initialization in React Strict Mode
let globalInitialized = false
let globalCleanupTimeout: NodeJS.Timeout | null = null

export function VoiceModeSimple({ onClose, onTranscript }: VoiceModeProps) {
  const [conversationState, setConversationState] = useState<ConversationState>('idle')
  const [transcript, setTranscript] = useState<Array<{ role: 'user' | 'assistant', text: string }>>([])
  const [error, setError] = useState<string | null>(null)
  const [isListening, setIsListening] = useState(true)
  const [audioLevels, setAudioLevels] = useState<number[]>(Array(20).fill(0))
  const [currentTranscript, setCurrentTranscript] = useState<string>('')
  const [isInitializing, setIsInitializing] = useState(true)
  const [initStatus, setInitStatus] = useState<string>('Requesting microphone access...')
  const [pushToTalkMode, setPushToTalkMode] = useState(false)
  const [isPushingToTalk, setIsPushingToTalk] = useState(false)

  const recognitionRef = useRef<any>(null)
  const synthesisRef = useRef<SpeechSynthesisUtterance | null>(null)
  const conversationHistory = useRef<Array<{ role: string, content: string }>>([])
  const audioContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const conversationStateRef = useRef<ConversationState>('idle')
  const isListeningRef = useRef(true)
  const voicesLoadedRef = useRef(false)
  const isInitializedRef = useRef(false)
  const isMountedRef = useRef(true)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const audioChunksRef = useRef<Blob[]>([])
  const useWhisperRef = useRef(false) // Use Whisper for Brave compatibility
  const recordingIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const isSpeakingRef = useRef(false)
  const speechStartTimeRef = useRef<number | null>(null)
  const silenceStartTimeRef = useRef<number | null>(null)
  const vadCheckIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const visualizationDataRef = useRef<Uint8Array | null>(null)

  const stopVisualization = () => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current)
      animationFrameRef.current = null
    }
    setAudioLevels(Array(20).fill(0))
  }

  const startVisualization = () => {
    if (!analyserRef.current || !isMountedRef.current) return

    const analyser = analyserRef.current
    if (!visualizationDataRef.current || visualizationDataRef.current.length !== analyser.frequencyBinCount) {
      visualizationDataRef.current = new Uint8Array(analyser.frequencyBinCount)
    }

    const updateVisualization = () => {
      if (!analyserRef.current || !isMountedRef.current) return
      const dataArray = visualizationDataRef.current!
      analyser.getByteFrequencyData(dataArray)

      const voiceRange = dataArray.slice(3, 30)
      const average = voiceRange.reduce((sum, value) => sum + value, 0) / voiceRange.length || 0
      const normalizedAverage = Math.min(1, (average / 255) * 2.5)

      const newLevels = Array(20).fill(0).map(() => {
        const randomFactor = 0.7 + Math.random() * 0.6
        return Math.min(1, normalizedAverage * randomFactor)
      })

      setAudioLevels(newLevels)
      animationFrameRef.current = requestAnimationFrame(updateVisualization)
    }

    updateVisualization()
  }

  const releaseMicrophone = () => {
    logger.info('🔻 Releasing microphone resources')

    stopVisualization()

    if (recordingIntervalRef.current) {
      clearInterval(recordingIntervalRef.current)
      recordingIntervalRef.current = null
    }

    if (vadCheckIntervalRef.current) {
      clearInterval(vadCheckIntervalRef.current)
      vadCheckIntervalRef.current = null
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      try {
        mediaRecorderRef.current.stop()
      } catch (e) {
        logger.error('Error stopping MediaRecorder during release:', e)
      }
    }
    mediaRecorderRef.current = null

    if (audioContextRef.current) {
      try {
        if (audioContextRef.current.state !== 'closed') {
          audioContextRef.current.close()
        }
      } catch (e) {
        logger.error('Error closing AudioContext during release:', e)
      }
      audioContextRef.current = null
      analyserRef.current = null
    }

    if (mediaStreamRef.current) {
      try {
        const tracks = mediaStreamRef.current.getTracks()
        tracks.forEach(track => {
          track.stop()
        })
      } catch (e) {
        logger.error('Error stopping media stream tracks during release:', e)
      }
      mediaStreamRef.current = null
    }

    audioChunksRef.current = []
    isSpeakingRef.current = false
    speechStartTimeRef.current = null
    silenceStartTimeRef.current = null
  }

  const acquireMicrophone = async () => {
    logger.info('🎙️ Acquiring microphone stream...')

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    mediaStreamRef.current = stream

    const audioContext = new AudioContext()
    const analyser = audioContext.createAnalyser()
    analyser.fftSize = 512
    analyser.smoothingTimeConstant = 0.8

    const microphone = audioContext.createMediaStreamSource(stream)
    microphone.connect(analyser)

    audioContextRef.current = audioContext
    analyserRef.current = analyser

    startVisualization()

    logger.info('✅ Microphone ready')
    return stream
  }

  // Keep refs in sync with state
  useEffect(() => {
    conversationStateRef.current = conversationState
  }, [conversationState])

  useEffect(() => {
    isListeningRef.current = isListening
  }, [isListening])

  // Check browser compatibility and initialize
  useEffect(() => {
    const initialize = async () => {
      // Clear any pending cleanup timeout
      if (globalCleanupTimeout) {
        clearTimeout(globalCleanupTimeout)
        globalCleanupTimeout = null
      }

      // Prevent double initialization (React Strict Mode mounts twice)
      if (globalInitialized) {
        logger.info('⚠️ Already initialized globally, skipping')
        isMountedRef.current = true // Still mark this instance as mounted
        return
      }
      globalInitialized = true
      isInitializedRef.current = true
      isMountedRef.current = true // Mark as mounted

      logger.info('🚀 Voice Mode Initialization Started')
      logger.info('Browser:', navigator.userAgent)

      // Detect Brave browser - ONLY Brave uses Whisper due to privacy restrictions
      const isBrave = (navigator as any).brave !== undefined

      if (isBrave) {
        // Brave blocks Web Speech API, must use Whisper
        logger.info('🦁 Brave browser detected - using Whisper API (Brave blocks Web Speech API)')
        useWhisperRef.current = true
      } else {
        // Chrome, Edge, Safari - use Web Speech API for instant recognition
        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        if (!SpeechRecognition) {
          logger.warn('⚠️ Web Speech API not supported, falling back to Whisper')
          useWhisperRef.current = true
        } else {
          logger.info('✅ Web Speech API detected - using for instant recognition (Chrome/Edge/Safari)')
          useWhisperRef.current = false
        }
      }

      // Check for getUserMedia support
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        logger.error('❌ getUserMedia not supported')
        setError('Microphone access is not supported in this browser.')
        setIsInitializing(false)
        return
      }
      logger.info('✅ getUserMedia API detected')

      // Step 1: Request microphone access
      try {
        setInitStatus('Requesting microphone permission...')
        logger.info('🎤 Requesting microphone access...')

        setInitStatus('Setting up audio visualization...')
        const stream = await acquireMicrophone()
        mediaStreamRef.current = stream
        logger.info('✅ Microphone access granted & visualization started')

      } catch (err: any) {
        logger.error('❌ Failed to access microphone:', err)

        if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
          setError('Microphone permission denied. Please allow microphone access in your browser settings and try again.\n\nIn Brave: Click the 🦁 icon in the address bar → Site Settings → Allow Microphone')
        } else if (err.name === 'NotFoundError') {
          setError('No microphone found. Please connect a microphone and try again.')
        } else {
          setError(`Failed to access microphone: ${err.message}`)
        }
        setIsInitializing(false)
        return
      }

      // Step 3: Initialize speech recognition
      setInitStatus('Initializing speech recognition...')
      logger.info('🎙️ Initializing speech recognition...')

      try {
        // Use Whisper API for Brave or if Web Speech API isn't available
        if (useWhisperRef.current) {
          if (!mediaStreamRef.current) {
            throw new Error('Media stream not available')
          }
          await initializeWhisperRecording(mediaStreamRef.current)
          setIsInitializing(false)
          return
        }

        // Don't create if we already have one
        if (recognitionRef.current) {
          logger.info('✅ Recognition already exists, reusing')
          setIsInitializing(false)
          return
        }

        const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition
        const recognition = new SpeechRecognition()
        recognition.continuous = true
        recognition.interimResults = true
        recognition.lang = 'en-US'
        recognition.maxAlternatives = 1

        recognition.onstart = () => {
          logger.info('✅ Speech recognition started')
          setConversationState('listening')
          setError(null)
          setCurrentTranscript('')
          setIsInitializing(false)
        }

        recognition.onresult = async (event: any) => {
          let interimTranscript = ''
          let finalTranscript = ''

          for (let i = event.resultIndex; i < event.results.length; i++) {
            const transcript = event.results[i][0].transcript
            if (event.results[i].isFinal) {
              finalTranscript += transcript
            } else {
              interimTranscript += transcript
            }
          }

          // Show interim transcript
          if (interimTranscript) {
            setCurrentTranscript(interimTranscript)
            logger.info('🎤 Interim:', interimTranscript)
          }

          // Process final transcript
          if (finalTranscript) {
            const userText = finalTranscript.trim()
            logger.info('✅ Final transcript:', userText)

            setCurrentTranscript('')
            setTranscript(prev => [...prev, { role: 'user', text: userText }])
            if (onTranscript) {
              onTranscript(userText, 'user')
            }

            // Stop listening while AI responds
            recognition.stop()
            setConversationState('thinking')

            // Get AI response
            await getAIResponse(userText)
          }
        }

        recognition.onspeechstart = () => {
          logger.info('🎤 Speech detected')
          setConversationState('listening')
        }

        recognition.onspeechend = () => {
          logger.info('🔇 Speech ended')
        }

        recognition.onaudiostart = () => {
          logger.info('🎙️ Audio capture started')
        }

        recognition.onaudioend = () => {
          logger.info('🔇 Audio capture ended')
        }

        recognition.onerror = (event: any) => {
          // Don't log or handle 'aborted' errors - they're expected when we manually stop
          if (event.error === 'aborted') {
            return
          }

          logger.error('❌ Speech recognition error:', event.error)

          if (event.error === 'no-speech') {
            // User didn't speak, just restart
            logger.info('No speech detected, restarting...')
            setTimeout(() => {
              if (isListeningRef.current && recognitionRef.current) {
                try {
                  recognition.start()
                } catch (e) {
                  logger.error('Error restarting after no-speech:', e)
                }
              }
            }, 100)
          } else if (event.error === 'not-allowed') {
            setError('Speech recognition permission denied. Please check your browser settings.')
            setConversationState('idle')
          } else if (event.error === 'network') {
            setError('Network error. Please check your internet connection and try again.')
            setConversationState('idle')
          } else {
            setError(`Speech recognition error: ${event.error}. Try refreshing the page.`)
            setConversationState('idle')
          }
        }

        recognition.onend = () => {
          const currentState = conversationStateRef.current
          const currentListening = isListeningRef.current
          logger.info('🔚 Recognition ended, state:', currentState, 'listening:', currentListening, 'mounted:', isMountedRef.current)

          // Don't restart if component is unmounting
          if (!isMountedRef.current) {
            logger.info('🛑 Component unmounted, not restarting')
            return
          }

          // Only restart if we're listening and not thinking/speaking
          if (currentListening && currentState !== 'thinking' && currentState !== 'speaking') {
            setTimeout(() => {
              // Double check we're still mounted
              if (!isMountedRef.current) return

              try {
                recognition.start()
                logger.info('♻️ Restarting recognition')
              } catch (e) {
                logger.error('Failed to restart recognition:', e)
              }
            }, 100)
          }
        }

        recognitionRef.current = recognition

        // Load voices for speech synthesis
        const loadVoices = () => {
          const voices = window.speechSynthesis.getVoices()
          if (voices.length > 0) {
            voicesLoadedRef.current = true
            logger.info('✅ Loaded', voices.length, 'voices')
          }
        }

        // Load voices immediately if available
        loadVoices()

        // Also listen for voices changed event (needed for some browsers)
        window.speechSynthesis.onvoiceschanged = loadVoices

        // Start listening
        logger.info('🎙️ Starting speech recognition...')
        recognition.start()

      } catch (e: any) {
        logger.error('❌ Failed to initialize speech recognition:', {
          message: e?.message,
          name: e?.name,
          stack: e?.stack,
          error: e
        })
        setError(`Failed to start speech recognition: ${e?.message || 'Unknown error'}. Please try again.`)
        setIsInitializing(false)
      }
    }

    initialize()

    return () => {
      logger.info('🧹 Cleaning up voice mode')
      isMountedRef.current = false

      // Reset global flag after a delay to allow React Strict Mode remount
      // but still reset when user actually closes the modal
      globalCleanupTimeout = setTimeout(() => {
        logger.info('🔄 Resetting global initialized flag')
        globalInitialized = false
      }, 100)

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
          recognitionRef.current = null
        } catch (e) {
          logger.error('Error stopping recognition during cleanup:', e)
        }
      }

      // Stop recording interval (old approach)
      if (recordingIntervalRef.current) {
        clearInterval(recordingIntervalRef.current)
        recordingIntervalRef.current = null
      }

      releaseMicrophone()
      window.speechSynthesis.cancel()
      logger.info('✅ Cleanup complete')
    }
  }, [])

  const initializeWhisperRecording = async (stream: MediaStream) => {
    logger.info('🎤 Initializing Whisper-based recording')

    try {
      // Check if MediaRecorder is supported
      if (typeof MediaRecorder === 'undefined') {
        throw new Error('MediaRecorder is not supported in this browser')
      }

      // Find supported mime type
      const mimeTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/ogg;codecs=opus',
        'audio/mp4',
        'audio/mpeg',
      ]

      let selectedMimeType = ''
      for (const mimeType of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType
          logger.info('✅ Using mime type:', mimeType)
          break
        }
      }

      if (!selectedMimeType) {
        logger.warn('⚠️ No preferred mime type supported, using default')
      }

      // Create MediaRecorder to capture audio
      const mediaRecorder = selectedMimeType
        ? new MediaRecorder(stream, { mimeType: selectedMimeType })
        : new MediaRecorder(stream)

      mediaRecorderRef.current = mediaRecorder

      mediaRecorder.ondataavailable = async (event) => {
        if (event.data.size > 0 && isMountedRef.current) {
          logger.info('📼 Audio data available, size:', event.data.size)
          audioChunksRef.current.push(event.data)
        } else {
          logger.warn('⚠️ Audio data available but empty or unmounted', {
            size: event.data.size,
            mounted: isMountedRef.current
          })
        }
      }

      mediaRecorder.onstop = async () => {
        logger.info('🛑 MediaRecorder stopped, chunks:', audioChunksRef.current.length)

        if (!isMountedRef.current) {
          logger.info('⏭️ Skipping transcription - component unmounted')
          return
        }

        if (audioChunksRef.current.length === 0) {
          logger.info('⏭️ Skipping transcription - no audio chunks')
          return
        }

        logger.info('🎤 Processing audio chunks:', audioChunksRef.current.length)

        // Create audio blob
        const audioBlob = new Blob(audioChunksRef.current, { type: selectedMimeType || 'audio/webm' })
        audioChunksRef.current = []

        logger.info('📦 Audio blob created, size:', audioBlob.size, 'type:', audioBlob.type)

        // Send to Whisper API
        await transcribeWithWhisper(audioBlob)
      }

      mediaRecorder.onerror = (event: any) => {
        logger.error('❌ MediaRecorder error:', event.error)
      }

      mediaRecorder.onstart = () => {
        logger.info('▶️ MediaRecorder started')
      }

      // Start recording - will be controlled by VAD
      mediaRecorder.start()
      logger.info('✅ Whisper recording started with Voice Activity Detection')

      // Set up Voice Activity Detection (VAD)
      // This monitors audio levels and only processes when user is actually speaking
      const SPEECH_THRESHOLD = 0.02 // Audio level to consider as speech (adjust 0-1)
      const SILENCE_DURATION = 800 // How long to wait after speech stops (ms)
      const MIN_SPEECH_DURATION = 300 // Minimum speech length to process (ms)

      vadCheckIntervalRef.current = setInterval(() => {
        if (!isMountedRef.current || !analyserRef.current || !mediaRecorderRef.current || !isListeningRef.current) {
          if (vadCheckIntervalRef.current) {
            clearInterval(vadCheckIntervalRef.current)
            vadCheckIntervalRef.current = null
          }
          return
        }

        // Get current audio level
        const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(dataArray)

        // Focus on voice frequency range (85Hz - 255Hz)
        const voiceRange = dataArray.slice(3, 30)
        const average = voiceRange.reduce((sum, value) => sum + value, 0) / voiceRange.length
        const normalizedLevel = average / 255

        const now = Date.now()

        if (normalizedLevel > SPEECH_THRESHOLD) {
          // Speech detected!
          if (!isSpeakingRef.current) {
            // Speech just started
            isSpeakingRef.current = true
            speechStartTimeRef.current = now
            silenceStartTimeRef.current = null
            logger.info('🎤 Speech detected, level:', normalizedLevel.toFixed(3))
          } else {
            // Still speaking, reset silence timer
            silenceStartTimeRef.current = null
          }
        } else {
          // Below threshold (silence or background noise)
          if (isSpeakingRef.current) {
            // Was speaking, now silence
            if (!silenceStartTimeRef.current) {
              silenceStartTimeRef.current = now
              logger.info('🤫 Silence detected, waiting...')
            } else if (now - silenceStartTimeRef.current > SILENCE_DURATION) {
              // Silence long enough, stop recording and process
              const speechDuration = now - (speechStartTimeRef.current || now)

              if (speechDuration >= MIN_SPEECH_DURATION) {
                logger.info('✅ Speech ended, duration:', speechDuration + 'ms', '- processing...')
                isSpeakingRef.current = false
                speechStartTimeRef.current = null
                silenceStartTimeRef.current = null

                // Stop recording to process this chunk
                if (mediaRecorderRef.current.state === 'recording') {
                  mediaRecorderRef.current.stop()

                  // Restart recording after processing
                  setTimeout(() => {
                    if (isMountedRef.current && isListeningRef.current && mediaRecorderRef.current) {
                      try {
                        mediaRecorderRef.current.start()
                      } catch (e) {
                        logger.error('Error restarting MediaRecorder after VAD:', e)
                      }
                    }
                  }, 100)
                }
              } else {
                // Too short, ignore (likely a click or brief noise)
                logger.info('⏭️ Speech too short (', speechDuration, 'ms), ignoring')
                isSpeakingRef.current = false
                speechStartTimeRef.current = null
                silenceStartTimeRef.current = null
                audioChunksRef.current = [] // Clear the chunks
              }
            }
          }
        }
      }, 100) // Check every 100ms for responsive detection

      setConversationState('listening')
      setIsInitializing(false)
      logger.info('✅ Whisper recording initialized')

    } catch (error: any) {
      logger.error('❌ Failed to initialize Whisper recording:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack
      })
      setError(`Failed to initialize voice recording: ${error?.message || 'Unknown error'}. Please try again.`)
      setIsInitializing(false)
    }
  }

  const transcribeWithWhisper = async (audioBlob: Blob) => {
    try {
      setConversationState('thinking')
      logger.info('📝 Sending audio to Whisper API...', {
        blobSize: audioBlob.size,
        blobType: audioBlob.type
      })

      // Skip if blob is too small (less than 1KB is likely silence)
      if (audioBlob.size < 1000) {
        logger.info('⏭️ Skipping transcription - audio too small (likely silence)')
        setConversationState('listening')
        return
      }

      // PR-AUTH-5: cached auth header.
      logger.info('📤 Sending request to /api/ai/transcribe')

      const formData = new FormData()
      formData.append('audio', audioBlob, 'recording.webm')

      const response = await fetch('/api/ai/transcribe', {
        method: 'POST',
        headers: {
          ...(await getAuthHeader()),
        },
        body: formData,
      })

      logger.info('📥 Received response, status:', response.status)

      if (!response.ok) {
        const errorText = await response.text()
        logger.error('❌ Transcription API error:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        })
        throw new Error(`Failed to transcribe audio: ${response.status} ${response.statusText}`)
      }

      const data = await response.json()
      logger.info('📄 Response data:', data)

      const transcribedText = data.text?.trim()

      if (transcribedText && transcribedText.length > 0) {
        logger.info('✅ Transcription:', transcribedText)

        setTranscript(prev => [...prev, { role: 'user', text: transcribedText }])
        if (onTranscript) {
          onTranscript(transcribedText, 'user')
        }

        // Get AI response
        await getAIResponse(transcribedText)
      } else {
        // No speech detected, go back to listening
        logger.info('⏭️ No speech detected in audio')
        setConversationState('listening')
      }

    } catch (error: any) {
      logger.error('❌ Whisper transcription error:', {
        message: error?.message,
        name: error?.name,
        stack: error?.stack
      })
      setConversationState('listening')
    }
  }

  const getAIResponse = async (userMessage: string) => {
    try {
      setConversationState('thinking')

      // Pause recording while we get AI response (avoid picking up background noise)
      const wasRecording = useWhisperRef.current && mediaRecorderRef.current?.state === 'recording'
      if (wasRecording) {
        logger.info('⏸️ Pausing recording while AI responds')
        mediaRecorderRef.current?.stop()
      }

      // Add to conversation history
      conversationHistory.current.push({
        role: 'user',
        content: userMessage
      })

      // PR-AUTH-5: cached auth header.
      const response = await fetch('/api/ai/assistant', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getAuthHeader()),
        },
        body: JSON.stringify({
          message: userMessage,
          conversationHistory: conversationHistory.current.slice(-10), // Last 10 messages for context
        }),
      })

      if (!response.ok) {
        throw new Error('Failed to get AI response')
      }

      const data = await response.json()
      const aiText = data.content || 'I apologize, I didn\'t understand that.'

      // Add AI response to conversation history
      conversationHistory.current.push({
        role: 'assistant',
        content: aiText
      })

      setTranscript(prev => [...prev, { role: 'assistant', text: aiText }])
      if (onTranscript) {
        onTranscript(aiText, 'assistant')
      }

      // Speak the response
      await speakText(aiText)

      // Resume recording after speaking (if was recording before)
      if (wasRecording && isMountedRef.current && isListeningRef.current) {
        logger.info('▶️ Resuming recording after AI response')
        setTimeout(() => {
          if (mediaRecorderRef.current && isMountedRef.current && isListeningRef.current) {
            mediaRecorderRef.current.start()
            setConversationState('listening')
          }
        }, 500) // Small delay to avoid picking up the tail end of TTS
      }

    } catch (error: any) {
      logger.error('Error getting AI response:', error)
      const errorMessage = 'Sorry, I encountered an error. Please try again.'
      await speakText(errorMessage)
      setTranscript(prev => [...prev, { role: 'assistant', text: errorMessage }])
      setConversationState('listening')
    }
  }

  const speakText = async (text: string): Promise<void> => {
    return new Promise(async (resolve, reject) => {
      try {
        setConversationState('speaking')
        logger.info('🔊 Starting to speak:', text.substring(0, 50) + '...')

        // Cancel any ongoing speech ONLY if something is already speaking
        if (window.speechSynthesis.speaking) {
          logger.info('🛑 Canceling previous speech')
          window.speechSynthesis.cancel()
          // Wait a bit for cancellation to complete
          await new Promise(r => setTimeout(r, 50))
        }

        // Wait for voices to load if they haven't yet
        if (!voicesLoadedRef.current) {
          logger.info('⏳ Waiting for voices to load...')
          await new Promise<void>((resolveVoices) => {
            const checkVoices = () => {
              const voices = window.speechSynthesis.getVoices()
              if (voices.length > 0) {
                voicesLoadedRef.current = true
                logger.info('✅ Voices loaded')
                resolveVoices()
              } else {
                setTimeout(checkVoices, 100)
              }
            }
            checkVoices()
          })
        }

        const utterance = new SpeechSynthesisUtterance(text)

      // Try to use the most natural-sounding voice available
      const voices = window.speechSynthesis.getVoices()
      logger.info('🎤 Available voices:', voices.length)

      // Prioritize high-quality voices (order matters - best first)
      const voicePriority = [
        // Mac voices (highest quality)
        'Samantha',
        'Alex',
        'Ava',
        'Allison',
        'Susan',
        // Google voices (good quality)
        'Google US English',
        'Google UK English Female',
        'Google UK English Male',
        // Microsoft voices
        'Microsoft Zira',
        'Microsoft David',
        'Microsoft Mark',
        // Any English voice as fallback
      ]

      let selectedVoice = null
      for (const voiceName of voicePriority) {
        selectedVoice = voices.find(v => v.name.includes(voiceName))
        if (selectedVoice) break
      }

      // Fallback to any en-US voice
      if (!selectedVoice) {
        selectedVoice = voices.find(v => v.lang === 'en-US')
      }

      if (selectedVoice) {
        utterance.voice = selectedVoice
        logger.info('🎤 Using voice:', selectedVoice.name)

        // Adjust parameters based on voice type for more natural speech
        if (selectedVoice.name.includes('Google')) {
          utterance.rate = 1.1    // Slightly faster for Google voices
          utterance.pitch = 0.95  // Slightly lower pitch
        } else if (selectedVoice.name.includes('Samantha') || selectedVoice.name.includes('Alex')) {
          utterance.rate = 1.0    // Natural speed for Mac voices
          utterance.pitch = 1.0   // Natural pitch
        } else {
          utterance.rate = 1.05   // Slightly faster for other voices
          utterance.pitch = 0.98  // Slightly lower pitch
        }
      } else {
        logger.info('🎤 Using default voice')
        utterance.rate = 1.05
        utterance.pitch = 0.98
      }

      utterance.volume = 1.0

        utterance.onstart = () => {
          logger.info('🔊 Speech started')
        }

        utterance.onend = () => {
          logger.info('✅ Speech ended')
          setConversationState('idle')

          // Resume Web Speech API listening if not using Whisper
          if (!useWhisperRef.current) {
            setTimeout(() => {
              if (isListeningRef.current && recognitionRef.current) {
                try {
                  recognitionRef.current.start()
                  logger.info('♻️ Resuming listening after speech')
                } catch (e) {
                  logger.error('Failed to resume listening:', e)
                }
              }
            }, 300)
          }

          resolve()
        }

        utterance.onerror = (event) => {
          // Ignore "canceled" and "interrupted" errors - these are normal when we cancel speech
          if (event.error === 'canceled' || event.error === 'interrupted') {
            logger.info('ℹ️ Speech canceled/interrupted (normal)')
            resolve()
            return
          }

          logger.error('❌ Speech synthesis error:', event.error)
          setConversationState('idle')

          // Resume Web Speech API listening if not using Whisper
          if (!useWhisperRef.current) {
            setTimeout(() => {
              if (isListeningRef.current && recognitionRef.current) {
                try {
                  recognitionRef.current.start()
                  logger.info('♻️ Resuming listening after error')
                } catch (e) {
                  logger.error('Failed to resume listening:', e)
                }
              }
            }, 300)
          }

          reject(new Error(event.error))
        }

        synthesisRef.current = utterance
        window.speechSynthesis.speak(utterance)
        logger.info('🔊 Speech queued')
      } catch (error) {
        logger.error('❌ Failed to speak:', error)
        setConversationState('idle')
        reject(error)
      }
    })
  }

  const toggleListening = async () => {
    if (isListening) {
      logger.info('🔇 Muting microphone')
      setIsListening(false)
      setConversationState('idle')

      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop()
        } catch (e) {
          logger.error('Error stopping recognition:', e)
        }
      }

      releaseMicrophone()
    } else {
      logger.info('🎤 Unmuting microphone')
      setIsListening(true)

      try {
        const stream = await acquireMicrophone()

        if (useWhisperRef.current) {
          await initializeWhisperRecording(stream)
        } else if (recognitionRef.current) {
          setTimeout(() => {
            try {
              recognitionRef.current.start()
              logger.info('✅ Recognition restarted after unmute')
            } catch (e) {
              logger.error('Error restarting recognition after unmute:', e)
            }
          }, 100)
        }
      } catch (error: any) {
        logger.error('Error re-acquiring microphone:', error)
        setError('Failed to access the microphone again. Please check your browser permissions and try reloading.')
        setIsListening(false)
      }
    }
  }

  const endCall = () => {
    logger.info('📞 Ending call')
    setIsListening(false)
    isMountedRef.current = false // Mark as unmounted to stop all async operations

    // Stop speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop()
        recognitionRef.current = null
      } catch (e) {
        logger.error('Error stopping recognition:', e)
      }
    }

    releaseMicrophone()

    // Cancel any ongoing speech
    window.speechSynthesis.cancel()

    logger.info('✅ End call cleanup complete')

    // Close the modal
    onClose()
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
    if (error) return error

    if (isInitializing) return initStatus

    if (!isListening) return 'Microphone muted'

    switch (conversationState) {
      case 'listening': return 'Listening...'
      case 'thinking': return 'Thinking...'
      case 'speaking': return 'Speaking...'
      default: return 'Ready to talk'
    }
  }

  return (
    <div className="fixed inset-0 bg-background/95 backdrop-blur-sm z-50 flex items-center justify-center">
      <Card className="w-full max-w-lg mx-4">
        <CardContent className="p-8">
          {/* Status */}
          <div className="text-center mb-8">
            <div className={cn("text-6xl mb-4 transition-colors", getStateColor())}>
              {isInitializing && <Loader2 className="w-16 h-16 mx-auto animate-spin" />}
              {!isInitializing && conversationState === 'listening' && <Mic className="w-16 h-16 mx-auto animate-pulse" />}
              {!isInitializing && conversationState === 'thinking' && <Loader2 className="w-16 h-16 mx-auto animate-spin" />}
              {!isInitializing && conversationState === 'speaking' && <Volume2 className="w-16 h-16 mx-auto animate-pulse" />}
              {!isInitializing && conversationState === 'idle' && !isListening && <MicOff className="w-16 h-16 mx-auto" />}
              {!isInitializing && conversationState === 'idle' && isListening && <Mic className="w-16 h-16 mx-auto" />}
            </div>

            <h2 className="text-2xl font-semibold mb-2">Voice Assistant</h2>
            <p className={cn("text-sm whitespace-pre-line", error ? 'text-destructive' : getStateColor())}>
              {getStateText()}
            </p>
          </div>

          {/* Waveform visualization - REAL audio levels */}
          <div className="h-24 bg-muted/50 rounded-lg mb-4 flex items-center justify-center">
            <div className="flex gap-1 items-center h-full px-4">
              {audioLevels.map((level, i) => (
                <div
                  key={i}
                  className="w-1 bg-primary rounded-full transition-all duration-75"
                  style={{
                    height: `${Math.max(20, level * 80)}%`,
                  }}
                />
              ))}
            </div>
          </div>

          {/* Current transcript being spoken */}
          {currentTranscript && (
            <div className="mb-4 p-3 bg-orange-500/10 rounded-lg border border-orange-500/20">
              <div className="text-xs text-orange-600 dark:text-orange-400 mb-1">You're saying:</div>
              <div className="text-sm italic">{currentTranscript}</div>
            </div>
          )}

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
              onClick={toggleListening}
              disabled={!!error || isInitializing}
            >
              {isListening ? <Mic className="w-5 h-5" /> : <MicOff className="w-5 h-5" />}
            </Button>

            <Button
              size="lg"
              variant="destructive"
              onClick={endCall}
            >
              <Phone className="w-5 h-5 mr-2" />
              End Call
            </Button>
          </div>

          {/* Error message with detailed instructions */}
          {error && (
            <div className="mt-4 p-4 bg-destructive/10 rounded-lg border border-destructive/20">
              <p className="text-sm text-destructive whitespace-pre-line">{error}</p>
            </div>
          )}

          {/* Browser compatibility note */}
          <div className="mt-4 text-center text-xs text-muted-foreground space-y-1">
            {useWhisperRef.current ? (
              <>
                <div className="text-green-600 dark:text-green-400">🦁 Brave Mode: OpenAI Whisper + Smart VAD</div>
                <div className="opacity-75">Voice activity detection • Processes only when you speak</div>
                <div className="text-amber-600 dark:text-amber-400 opacity-90 mt-2">💡 Pause briefly after speaking for instant AI response</div>
              </>
            ) : (
              <>
                <div className="text-green-600 dark:text-green-400">⚡ Chrome Mode: Instant Voice Recognition</div>
                <div className="opacity-75">Real-time speech-to-text with voice activity detection</div>
                <div className="text-amber-600 dark:text-amber-400 opacity-90 mt-2">💡 Tip: Speak clearly and pause briefly between questions</div>
              </>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
