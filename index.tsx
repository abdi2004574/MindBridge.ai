
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { createRoot } from 'react-dom/client';
import { GoogleGenAI, Modality, LiveServerMessage, Type, FunctionDeclaration } from '@google/genai';

// --- Types & Interfaces ---
interface Slot {
  id: string;
  date: string;
  time: string;
}

interface SpecialistProfile {
  name: string;
  title: string;
  specialty: string;
  bio: string;
  avatar: string;
  rating: number;
}

// --- BACKEND SERVICE ---
class MindBridgeBackend {
  private sessionId: string | null = null;
  
  public profiles: Record<string, SpecialistProfile> = {
    "Dr. Sarah Chen": {
      name: "Dr. Sarah Chen",
      title: "Senior Clinical Psychologist",
      specialty: "Cognitive Behavioral Therapy (CBT)",
      bio: "Expert in identifying cognitive distortions and applying evidence-based CBT for anxiety. 15+ years experience.",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Sarah",
      rating: 4.9
    },
    "Mark Thompson": {
      name: "Mark Thompson",
      title: "Trauma Specialist",
      specialty: "EMDR & PTSD Recovery",
      bio: "Dedicated to trauma-informed care and somatic experiencing for post-traumatic growth.",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Mark",
      rating: 4.8
    },
    "Elena Rodriguez": {
      name: "Elena Rodriguez",
      title: "Interpersonal Dynamics Counselor",
      specialty: "Anxiety & Relationships",
      bio: "Focuses on building emotional resilience and improving communication patterns within family systems.",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Elena",
      rating: 4.7
    },
    "Dr. Julian Vane": {
      name: "Dr. Julian Vane",
      title: "Future Performance Psychologist",
      specialty: "2026 Resilience & Performance",
      bio: "Leading specialist in high-stress management and mental preparation for upcoming 2026 clinical targets.",
      avatar: "https://api.dicebear.com/7.x/avataaars/svg?seed=Julian",
      rating: 5.0
    }
  };

  private availability: Record<string, Slot[]> = {
    "Dr. Sarah Chen": [
      { id: "s1", date: "2025-05-22", time: "10:00 AM" },
      { id: "s2", date: "2025-05-22", time: "02:00 PM" },
      { id: "s3", date: "2026-01-15", time: "09:00 AM" },
    ],
    "Mark Thompson": [
      { id: "m1", date: "2025-05-23", time: "11:30 AM" },
      { id: "m2", date: "2026-02-10", time: "04:00 PM" },
    ],
    "Elena Rodriguez": [
      { id: "e1", date: "2025-05-24", time: "01:00 PM" },
      { id: "e2", date: "2026-03-05", time: "10:30 AM" },
    ],
    "Dr. Julian Vane": [
      { id: "v1", date: "2025-12-28", time: "11:00 AM" },
      { id: "v2", date: "2026-01-02", time: "09:00 AM" },
      { id: "v3", date: "2026-06-12", time: "02:00 PM" },
    ]
  };

  async startSession() {
    this.sessionId = `sess_${Date.now()}`;
    return this.sessionId;
  }

  async getAvailability() {
    return { availability: this.availability, profiles: this.profiles };
  }

  async requestAppointment(summary: any) {
    console.debug("Routing Intake to Specialist Database...", summary);
    return { status: 'success', confirmationCode: `MB-${Math.floor(1000 + Math.random() * 9000)}` };
  }
}

const backend = new MindBridgeBackend();

// --- Tool Definitions ---
const requestHumanReferralTool: FunctionDeclaration = {
  name: 'requestHumanReferral',
  parameters: {
    type: Type.OBJECT,
    description: 'Call this ONLY when a user explicitly asks for a human psychologist or referral.',
    properties: {
      userName: { type: Type.STRING },
      location: { type: Type.STRING },
      concern: { type: Type.STRING },
      specialistType: { type: Type.STRING },
      preferredPsychologist: { type: Type.STRING },
      appointmentDate: { type: Type.STRING },
      appointmentTime: { type: Type.STRING },
    },
    required: ['userName', 'location', 'concern', 'specialistType', 'preferredPsychologist', 'appointmentDate', 'appointmentTime'],
  },
};

const getAvailabilityTool: FunctionDeclaration = {
  name: 'getPsychologistAvailability',
  parameters: {
    type: Type.OBJECT,
    description: 'Check available dates and times for human psychologists.',
    properties: {},
  },
};

const showSpecialistProfileTool: FunctionDeclaration = {
  name: 'showSpecialistProfile',
  parameters: {
    type: Type.OBJECT,
    description: 'Displays a visual pop-up card for a specific specialist.',
    properties: {
      specialistName: { type: Type.STRING, description: "The full name of the psychologist to display." },
    },
    required: ['specialistName'],
  },
};

// --- Helper Functions ---
function decode(base64: string) {
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function encode(bytes: Uint8Array) {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

async function decodeAudioData(data: Uint8Array, ctx: AudioContext, sampleRate: number, numChannels: number): Promise<AudioBuffer> {
  const dataInt16 = new Int16Array(data.buffer);
  const frameCount = dataInt16.length / numChannels;
  const buffer = ctx.createBuffer(numChannels, frameCount, sampleRate);
  for (let channel = 0; channel < numChannels; channel++) {
    const channelData = buffer.getChannelData(channel);
    for (let i = 0; i < frameCount; i++) {
      channelData[i] = dataInt16[i * numChannels + channel] / 32768.0;
    }
  }
  return buffer;
}

function createBlob(data: Float32Array): { data: string; mimeType: string } {
  const int16 = new Int16Array(data.length);
  for (let i = 0; i < data.length; i++) {
    int16[i] = data[i] * 32768;
  }
  return { data: encode(new Uint8Array(int16.buffer)), mimeType: 'audio/pcm;rate=16000' };
}

// --- Draggable Hook ---
const useDraggable = () => {
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const offset = useRef({ x: 0, y: 0 });

  const onMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    offset.current = {
      x: e.clientX - position.x,
      y: e.clientY - position.y
    };
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!isDragging) return;
      setPosition({
        x: e.clientX - offset.current.x,
        y: e.clientY - offset.current.y
      });
    };
    const onMouseUp = () => setIsDragging(false);
    if (isDragging) {
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    }
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [isDragging]);

  return { position, onMouseDown };
};

// --- App Component ---
const App = () => {
  const [isActive, setIsActive] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcriptions, setTranscriptions] = useState<{ role: 'user' | 'ai'; text: string }[]>([]);
  const [currentInputText, setCurrentInputText] = useState('');
  const [currentOutputText, setCurrentOutputText] = useState('');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [referralData, setReferralData] = useState<any>(null);
  const [audioLevels, setAudioLevels] = useState<number[]>(new Array(8).fill(20));
  const [activeSpecialist, setActiveSpecialist] = useState<SpecialistProfile | null>(null);

  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  const inputAudioContextRef = useRef<AudioContext | null>(null);
  const outputAudioContextRef = useRef<AudioContext | null>(null);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const nextStartTimeRef = useRef(0);
  
  const inputRef = useRef('');
  const outputRef = useRef('');

  const { position, onMouseDown } = useDraggable();

  const stopSession = useCallback(() => {
    setIsActive(false);
    setIsConnecting(false);
    setActiveSpecialist(null);
    setCurrentInputText('');
    setCurrentOutputText('');
    inputRef.current = '';
    outputRef.current = '';
    
    if (sessionPromiseRef.current) {
      sessionPromiseRef.current.then(session => {
        if (session) session.close();
      });
      sessionPromiseRef.current = null;
    }
    
    sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
    sourcesRef.current.clear();
    nextStartTimeRef.current = 0;
    
    if (inputAudioContextRef.current) {
      inputAudioContextRef.current.close();
      inputAudioContextRef.current = null;
    }
    if (outputAudioContextRef.current) {
      outputAudioContextRef.current.close();
      outputAudioContextRef.current = null;
    }
  }, []);

  const startSession = async () => {
    if (isActive || isConnecting) return;
    
    try {
      setIsConnecting(true);
      const ai = new GoogleGenAI({ apiKey: process.env.API_KEY });
      
      inputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 16000 });
      outputAudioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)({ sampleRate: 24000 });

      if (inputAudioContextRef.current.state === 'suspended') await inputAudioContextRef.current.resume();
      if (outputAudioContextRef.current.state === 'suspended') await outputAudioContextRef.current.resume();

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await backend.startSession();

      const sessionPromise = ai.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
          onopen: () => {
            setIsActive(true);
            setIsConnecting(false);
            
            const source = inputAudioContextRef.current!.createMediaStreamSource(stream);
            const scriptProcessor = inputAudioContextRef.current!.createScriptProcessor(4096, 1, 1);
            
            scriptProcessor.onaudioprocess = (e) => {
              const inputData = e.inputBuffer.getChannelData(0);
              let sum = 0;
              for(let i=0; i<inputData.length; i++) sum += Math.abs(inputData[i]);
              const avg = (sum / inputData.length) * 100;
              setAudioLevels(prev => prev.map(() => Math.min(100, 10 + Math.random() * avg * 15)));

              const pcmBlob = createBlob(inputData);
              sessionPromise.then(session => {
                if (session) session.sendRealtimeInput({ media: pcmBlob });
              }).catch(() => {});
            };
            
            source.connect(scriptProcessor);
            scriptProcessor.connect(inputAudioContextRef.current!.destination);
          },
          onmessage: async (message: LiveServerMessage) => {
            if (message.toolCall) {
              for (const fc of message.toolCall.functionCalls) {
                if (fc.name === 'getPsychologistAvailability') {
                  const data = await backend.getAvailability();
                  sessionPromise.then(session => {
                    session.sendToolResponse({
                      functionResponses: [{ id: fc.id, name: fc.name, response: { result: data } }]
                    });
                  });
                }
                if (fc.name === 'showSpecialistProfile') {
                  const profile = backend.profiles[fc.args.specialistName as string];
                  if (profile) setActiveSpecialist(profile);
                  sessionPromise.then(session => {
                    session.sendToolResponse({
                      functionResponses: [{ id: fc.id, name: fc.name, response: { result: profile ? "Profile popup triggered near agent." : "Profile not found." } }]
                    });
                  });
                }
                if (fc.name === 'requestHumanReferral') {
                  setReferralData(fc.args);
                  setIsModalOpen(true);
                  sessionPromise.then(session => {
                    session.sendToolResponse({
                      functionResponses: [{ id: fc.id, name: fc.name, response: { result: "Intake form displayed." } }]
                    });
                  });
                }
              }
            }

            const base64Audio = message.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
            if (base64Audio && outputAudioContextRef.current) {
              const ctx = outputAudioContextRef.current;
              nextStartTimeRef.current = Math.max(nextStartTimeRef.current, ctx.currentTime);
              const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
              const source = ctx.createBufferSource();
              source.buffer = audioBuffer;
              source.connect(ctx.destination);
              source.onended = () => sourcesRef.current.delete(source);
              source.start(nextStartTimeRef.current);
              nextStartTimeRef.current += audioBuffer.duration;
              sourcesRef.current.add(source);
            }

            if (message.serverContent?.inputTranscription) {
              const text = message.serverContent.inputTranscription.text;
              inputRef.current += text;
              setCurrentInputText(inputRef.current);
            }
            if (message.serverContent?.outputTranscription) {
              const text = message.serverContent.outputTranscription.text;
              outputRef.current += text;
              setCurrentOutputText(outputRef.current);
            }

            if (message.serverContent?.turnComplete) {
              const history: { role: 'user' | 'ai'; text: string }[] = [];
              if (inputRef.current.trim()) history.push({ role: 'user', text: inputRef.current.trim() });
              if (outputRef.current.trim()) history.push({ role: 'ai', text: outputRef.current.trim() });
              
              if (history.length > 0) {
                setTranscriptions(prev => [...prev, ...history]);
              }
              
              inputRef.current = '';
              outputRef.current = '';
              setCurrentInputText('');
              setCurrentOutputText('');
            }
            
            if (message.serverContent?.interrupted) {
              sourcesRef.current.forEach(s => { try { s.stop(); } catch (e) {} });
              sourcesRef.current.clear();
              nextStartTimeRef.current = 0;
            }
          },
          onerror: (e) => {
            console.error("Live API Error:", e);
          },
          onclose: (e) => {
            if (isActive) stopSession();
          }
        },
        config: {
          responseModalities: [Modality.AUDIO],
          tools: [{ functionDeclarations: [requestHumanReferralTool, getAvailabilityTool, showSpecialistProfileTool] }],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } } },
          inputAudioTranscription: {},
          outputAudioTranscription: {},
          systemInstruction: `You are MindBridge AI, a clinical CBT specialist.
          STRICT LANGUAGE POLICY:
          1. You MUST communicate and transcribe ONLY in English or Urdu.
          2. If the user speaks in any other language, respond only with: "I can only communicate in English or Urdu at this time." (translated if necessary).
          3. Do NOT provide transcripts or responses in other languages.
          
          CORE PROTOCOL:
          - Always remain in the session. Do NOT end the call on your own.
          - Primarily provide pure CBT guidance and identify cognitive distortions.
          - ONLY offer human psychologists if the user explicitly asks.
          - When they ask, use 'getPsychologistAvailability' and 'showSpecialistProfile'.
          - Ensure the user feels heard in English or Urdu.`,
        }
      });
      sessionPromiseRef.current = sessionPromise;
      await sessionPromise;
    } catch (err) {
      setIsConnecting(false);
      setIsActive(false);
      alert("Microphone Error.");
    }
  };

  return (
    <div className="flex flex-col h-screen bg-slate-50 overflow-hidden">
      <header className="flex items-center justify-between px-8 py-4 glass border-b border-slate-200 z-20 shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center shadow-lg"><svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z" /></svg></div>
          <h1 className="text-xl font-bold text-slate-800 tracking-tight">MindBridge <span className="text-blue-600">AI</span></h1>
        </div>
        <div className="flex items-center gap-4">
          {isActive && (
            <div className="flex items-center gap-2 px-3 py-1 bg-blue-50 border border-blue-100 rounded-full">
              <span className="w-2 h-2 bg-blue-600 rounded-full animate-ping"></span>
              <span className="text-[10px] font-bold text-blue-600 uppercase tracking-widest">Urdu/English Session</span>
            </div>
          )}
          <button onClick={() => setIsModalOpen(true)} className="px-4 py-2 bg-white border border-slate-200 text-slate-600 rounded-lg text-xs font-bold hover:bg-slate-50 shadow-sm transition-all">Assessment Data</button>
        </div>
      </header>

      <main className="flex-1 flex overflow-hidden">
        {/* Center Control Area */}
        <div className="flex-1 flex flex-col items-center justify-center p-8 space-y-12 relative overflow-hidden">
          
          {/* Specialist Profile - MOVED NEAR AGENT */}
          {activeSpecialist && (
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-[260px] w-[300px] animate-in fade-in zoom-in duration-300 z-50">
               <div className="bg-white rounded-[32px] shadow-[0_40px_100px_rgba(37,99,235,0.15)] border border-blue-100 p-8 text-center relative">
                  <button onClick={() => setActiveSpecialist(null)} className="absolute top-4 right-4 text-slate-300 hover:text-blue-600 transition-colors">
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" /></svg>
                  </button>
                  <img src={activeSpecialist.avatar} alt={activeSpecialist.name} className="w-24 h-24 rounded-[2rem] mx-auto bg-blue-50 border-4 border-white shadow-xl mb-4" />
                  <h4 className="text-md font-bold text-slate-800">{activeSpecialist.name}</h4>
                  <p className="text-[10px] text-blue-600 font-extrabold uppercase tracking-widest mt-1 mb-4">{activeSpecialist.specialty}</p>
                  <p className="text-[11px] text-slate-500 leading-relaxed italic px-2">"{activeSpecialist.bio}"</p>
                  <div className="mt-6 flex items-center justify-center gap-1.5 text-amber-500 font-bold text-xs">
                     <svg className="w-4 h-4 fill-current" viewBox="0 0 20 20"><path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" /></svg>
                     {activeSpecialist.rating}
                  </div>
               </div>
            </div>
          )}

          <div className={`w-72 h-72 rounded-full border-[6px] border-white shadow-[0_30px_70px_rgba(0,0,0,0.08)] flex items-center justify-center bg-white transition-all duration-700 relative z-10 ${isActive ? 'scale-110 shadow-blue-100 ring-[12px] ring-blue-50/40' : ''}`}>
             {!isActive && !isConnecting ? (
               <button onClick={startSession} className="w-32 h-32 bg-blue-600 text-white rounded-full flex items-center justify-center shadow-2xl hover:scale-110 active:scale-95 transition-all group overflow-hidden relative">
                 <div className="absolute inset-0 bg-white/10 opacity-0 group-hover:opacity-100 transition-opacity"></div>
                 <svg className="w-16 h-16" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
               </button>
             ) : isConnecting ? (
               <div className="flex flex-col items-center gap-4">
                 <div className="w-16 h-16 border-4 border-blue-50 border-t-blue-600 rounded-full animate-spin"></div>
                 <span className="text-[10px] font-bold text-blue-400 uppercase tracking-[0.2em] animate-pulse">Syncing...</span>
               </div>
             ) : (
               <div className="flex items-center gap-3 h-20">
                 {audioLevels.map((lvl, i) => <div key={i} className="audio-wave-bar" style={{ height: `${lvl}%`, background: '#2563eb' }}></div>)}
               </div>
             )}
          </div>

          <div className="text-center max-w-sm z-10">
            <h2 className="text-3xl font-bold text-slate-800 tracking-tight">{isActive ? "Clinical Support" : "Start Session"}</h2>
            <p className="text-slate-400 text-sm mt-5 font-medium leading-relaxed px-4">
              Providing CBT-based guidance exclusively in <span className="text-blue-600">English & Urdu</span>. Specialists available on request.
            </p>
          </div>

          {isActive && (
            <button onClick={stopSession} className="px-16 py-4 bg-slate-900 text-white rounded-[2rem] font-bold hover:bg-black transition-all shadow-2xl active:scale-95 flex items-center gap-3 z-10">
              <span className="w-2.5 h-2.5 bg-red-500 rounded-full animate-pulse shadow-[0_0_10px_rgba(239,68,68,0.5)]"></span>
              Disconnect
            </button>
          )}
        </div>

        {/* Live Transcript - VIBRANT BLUE TEXT */}
        <aside className="w-[420px] glass border-l border-slate-200 p-10 flex flex-col shrink-0 bg-white/80">
          <div className="flex items-center justify-between mb-8">
            <h3 className="text-[11px] font-black text-blue-600 uppercase tracking-[0.3em] flex items-center gap-3">
              <span className="w-2 h-2 bg-blue-600 rounded-full"></span>
              Transcribe: EN / UR
            </h3>
            <div className={`px-2 py-0.5 rounded-md text-[9px] font-bold ${isActive ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-400'}`}>
              {isActive ? 'RECORDING' : 'IDLE'}
            </div>
          </div>
          
          <div className="flex-1 overflow-y-auto space-y-8 custom-scrollbar pr-4 pb-12">
            {transcriptions.map((t, i) => (
              <div key={`h-${i}`} className={`flex flex-col ${t.role === 'user' ? 'items-end' : 'items-start'}`}>
                <div className={`p-5 rounded-[2rem] text-[13px] leading-relaxed shadow-sm max-w-[95%] font-semibold ${t.role === 'user' ? 'bg-blue-600 text-white rounded-tr-none' : 'bg-blue-50/50 border border-blue-100 text-[#2563eb] rounded-tl-none'}`}>
                  {t.text}
                </div>
                <span className={`text-[9px] font-black mt-2 uppercase tracking-widest px-3 ${t.role === 'user' ? 'text-blue-400' : 'text-blue-500'}`}>
                  {t.role === 'user' ? 'CLIENT' : 'MINDBRIDGE'}
                </span>
              </div>
            ))}

            {/* Live Streaming Content */}
            {currentInputText && (
              <div className="flex flex-col items-end animate-in fade-in slide-in-from-bottom-2 duration-200">
                <div className="p-5 rounded-[2rem] text-[13px] leading-relaxed shadow-md max-w-[95%] font-bold bg-blue-100/50 text-[#2563eb] rounded-tr-none border-2 border-blue-400/30">
                  {currentInputText}
                </div>
                <span className="text-[9px] font-black text-blue-600 mt-2 uppercase tracking-widest px-3 italic animate-pulse">Detecting...</span>
              </div>
            )}
            {currentOutputText && (
              <div className="flex flex-col items-start animate-in fade-in slide-in-from-bottom-2 duration-200">
                <div className="p-5 rounded-[2rem] text-[13px] leading-relaxed shadow-md max-w-[95%] font-bold bg-white border-2 border-blue-400/30 text-[#2563eb] rounded-tl-none">
                  {currentOutputText}
                </div>
                <span className="text-[9px] font-black text-blue-600 mt-2 uppercase tracking-widest px-3 italic animate-pulse">Responding...</span>
              </div>
            )}

            {!isActive && transcriptions.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center opacity-20 text-center space-y-4">
                <svg className="w-10 h-10 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>
                <p className="text-[11px] font-bold text-blue-600 uppercase tracking-[0.2em]">English & Urdu Support Only</p>
              </div>
            )}
          </div>
        </aside>
      </main>

      {/* Referral Gateway */}
      {isModalOpen && (
        <div className="fixed inset-0 z-[100] bg-slate-900/40 backdrop-blur-xl flex items-center justify-center p-6">
          <div 
            className="bg-white rounded-[48px] shadow-[0_60px_150px_rgba(0,0,0,0.3)] border border-blue-50 w-[500px] overflow-hidden pointer-events-auto transition-transform"
            style={{ left: position.x, top: position.y }}
          >
            <div onMouseDown={onMouseDown} className="draggable-handle px-12 py-10 bg-blue-600 text-white flex justify-between items-center cursor-grab active:cursor-grabbing relative">
              <div className="absolute top-0 left-0 right-0 h-1 bg-white/20"></div>
              <div>
                <h2 className="text-2xl font-black tracking-tight">Clinical Gateway</h2>
                <p className="text-[11px] font-bold uppercase opacity-80 mt-1 tracking-widest">Intake Routing Service</p>
              </div>
              <button onClick={() => setIsModalOpen(false)} className="w-12 h-12 rounded-full bg-white/20 flex items-center justify-center hover:bg-white/40 transition-all border border-white/30"><svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M6 18L18 6M6 6l12 12" /></svg></button>
            </div>
            
            <div className="p-12 space-y-8">
               <div className="bg-blue-50/50 p-8 rounded-[2.5rem] border border-blue-100 flex items-center gap-6">
                  <div className="w-14 h-14 bg-blue-600 rounded-[1.25rem] flex items-center justify-center shadow-xl shadow-blue-200"><svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg></div>
                  <div>
                    <p className="text-[14px] font-black text-blue-900 tracking-tight">{referralData?.appointmentDate || "2025/26 Pending"}</p>
                    <p className="text-[11px] font-extrabold text-blue-500 uppercase tracking-widest">{referralData?.appointmentTime || "Requested Specialist"}</p>
                  </div>
               </div>
               
               <div className="space-y-6">
                  <div className="flex flex-col"><span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Subject Name</span><p className="text-md font-bold text-slate-800">{referralData?.userName || "Pending..."}</p></div>
                  <div className="flex flex-col"><span className="text-[10px] font-black text-slate-400 uppercase tracking-[0.2em] mb-2">Assessment Concern</span><p className="text-[13px] font-medium text-slate-600 leading-relaxed bg-slate-50 p-6 rounded-[2rem] border border-slate-100">{referralData?.concern || "Awaiting detail..."}</p></div>
               </div>

               <button onClick={() => setIsModalOpen(false)} className="w-full py-6 bg-blue-600 text-white text-md font-black rounded-[2.5rem] shadow-2xl shadow-blue-200 hover:bg-blue-700 transition-all active:scale-[0.98] tracking-widest uppercase">Confirm Specialist Intake</button>
            </div>
          </div>
        </div>
      )}

      <style>{`
        .audio-wave-bar { width: 6px; border-radius: 99px; transition: height 0.08s ease-out; }
        .custom-scrollbar::-webkit-scrollbar { width: 5px; }
        .custom-scrollbar::-webkit-scrollbar-thumb { background: #dbeafe; border-radius: 10px; }
        .glass { background: rgba(255, 255, 255, 0.85); backdrop-filter: blur(20px); }
        input, textarea { font-family: inherit; }
        [dir="rtl"] { text-align: right; }
      `}</style>
    </div>
  );
};

const root = createRoot(document.getElementById('root')!);
root.render(<App />);
