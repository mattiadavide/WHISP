import { AutoModel, Tensor, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js';

env.allowLocalModels = false;
// [OPT]: Multi-thread WASM + SIMD for VAD CPU fallback (4-8x speedup on devices without WebGPU)
env.backends.onnx.wasm.numThreads = Math.min(navigator.hardwareConcurrency || 4, 8);
env.backends.onnx.wasm.simd = true;

let vadModel = null, state = null, whisperPort = null, isSpeaking = false, silenceFrames = 0, isWhisperOnline = false;
let audioChunks = [];
let currentPrecision = 'turbo';
const preRoll = [];
const PRE_ROLL_MAX = 50; // Aumentato preroll per non perdere l'iniziale
const MIN_SPEECH_CHUNKS = 15; // ~0.5s di parlato minimo effettivo per far partire Whisper (rigetta click e tosse)
const ZERO_STATE = new Float32Array(2 * 1 * 128);
const SR_TENSOR = new Tensor('int64', new BigInt64Array([16000n]), [1]);

function flush(isPartial = false) {
    if (!isWhisperOnline || audioChunks.length === 0) return;
    
    // [APEX TUNING]: Scarta totalmente i frammenti troppo brevi (es. colpi di tosse, click del mouse, brevi ronzii musicali)
    if (!isPartial && audioChunks.length < MIN_SPEECH_CHUNKS) {
        audioChunks = []; silenceFrames = 0;
        return;
    }
    
    const totalLength = audioChunks.reduce((acc, c) => acc + c.length, 0);
    const flat = new Float32Array(totalLength);
    let offset = 0;
    for (const chunk of audioChunks) { flat.set(chunk, offset); offset += chunk.length; }
    
    whisperPort.postMessage({ type: 'transcribe', audioBuffer: flat.buffer, isPartial }, [flat.buffer]);
    if(!isPartial) { audioChunks = []; silenceFrames = 0; }
}

self.onmessage = async (e) => {
    const { type, port, precision } = e.data;
    if (type === 'load') {
        vadModel = await AutoModel.from_pretrained('onnx-community/silero-vad', { config: { model_type: 'custom' } });
        state = new Tensor('float32', ZERO_STATE.slice(), [2, 1, 128]);
        self.postMessage({ type: 'ready' });
    } else if (type === 'update_params') {
        if (precision) currentPrecision = precision;
    } else if (type === 'init_whisper_port') {
        whisperPort = port; whisperPort.onmessage = (ev) => { if (ev.data.type === 'WHISPER_ONLINE') isWhisperOnline = true; };
    } else if (type === 'force_flush') {
        if (isSpeaking || audioChunks.length > 0) { 
            isSpeaking = false; flush(false); state = new Tensor('float32', ZERO_STATE.slice(), [2, 1, 128]); 
        }
    } else if (type === 'init_worklet_port') {
        port.onmessage = async (we) => {
            if (we.data.type === 'vad' && vadModel) {
                const chunk = new Float32Array(we.data.data);
                const rawRms = we.data.rawRms || 0;

                if (isSpeaking) { 
                    audioChunks.push(chunk); 
                    // [APEX TUNING]: Flush aggressivo ogni ~700ms in 'turbo' (40 chunks invece di 100) per ritorno real-time
                    const flushInterval = (currentPrecision === 'turbo') ? 40 : 35;
                    if (audioChunks.length % flushInterval === 0) flush(true); 
                } else { 
                    preRoll.push(chunk); 
                    if (preRoll.length > PRE_ROLL_MAX) preRoll.shift(); 
                }
                
                const out = await vadModel({ input: new Tensor('float32', chunk, [1, 512]), sr: SR_TENSOR, state });
                state = out.stateN || out.staten || state;
                const prob = out.output.data[0];
                
                // [APEX TUNING]: Bilanciamento l'attesa per troncamento (0.7s) per far respirare l'utente senza tagliare.
                const maxSilenceFrames = (currentPrecision === 'turbo') ? 22 : 12; 
                // [APEX TUNING]: Ampio respiro (20s) per analizzare le frasi per intero prima che VAD dia il final flush.
                const maxContextChunks = (currentPrecision === 'turbo') ? 625 : 300;
                
                // [APEX TUNING]: Alzata severamente la soglia d'ingresso per rigettare musica e rumore di fondo.
                if (prob > (isSpeaking ? 0.45 : 0.85)) { 
                    if (!isSpeaking) { isSpeaking = true; audioChunks = [...preRoll]; }
                    silenceFrames = 0;
                } else if (isSpeaking) {
                    silenceFrames++;
                    if (silenceFrames > maxSilenceFrames) { 
                        isSpeaking = false; flush(false); state = new Tensor('float32', ZERO_STATE.slice(), [2, 1, 128]); 
                    }
                }

                if (isSpeaking && audioChunks.length > maxContextChunks) {
                    isSpeaking = false; flush(false); state = new Tensor('float32', ZERO_STATE.slice(), [2, 1, 128]);
                }

                self.postMessage({ type: 'vad_ui_update', prob, isSpeaking, rms: rawRms });
            }
        };
    }
};
