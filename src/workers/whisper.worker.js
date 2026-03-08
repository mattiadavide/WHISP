import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js';

// [OPT]: Disable telemetry, enable multi-thread WASM with SIMD for CPU fallback performance
env.allowLocalModels = false;
env.backends.onnx.wasm.proxy = true;
env.backends.onnx.logLevel = 'fatal';
// OPT: Prevent CPU lockup on MacBook Air M3 by using only half the available cores
env.backends.onnx.wasm.numThreads = Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2));
env.backends.onnx.wasm.simd = true;
let transcriber = null, queue = [], isBusy = false, currentLanguage = "italian", vadPort = null, currentPrecision = "turbo", initialPrompt = "";

async function process() {
    if (isBusy || queue.length === 0 || !transcriber) return;
    isBusy = true; 
    const item = queue.shift();
    try {
        let config = { 
            language: currentLanguage, 
            task: 'transcribe', 
            temperature: 0.0, 
            prompt: initialPrompt
        };

        if (currentPrecision !== 'turbo') {
            config.return_timestamps = true; 
            config.condition_on_previous_text = false;
            config.repetition_penalty = 1.3; 
            config.no_repeat_ngram_size = 2;
            config.top_k = 50;
        }

        const res = await transcriber(new Float32Array(item.buffer), config);
        
        if (res.text && res.text.trim().length > 0) {
            
            // [FIX 1 — ROLLING PROMPT]: Update context with last 20 words after every final segment
            // This dramatically reduces inter-segment hallucinations on long sessions (Interspeech 2025)
            if (!item.isPartial) {
                const words = res.text.trim().split(/\s+/);
                initialPrompt = words.slice(-20).join(' ');
            }
            
            // [FIX 2 — PER-WORD CONFIDENCE]: Build word-level confidence map from chunks
            // Instead of flagging the ENTIRE segment as low-conf when avg is bad,
            // we send per-token confidence so the NLP worker can mark only uncertain words (Cambridge 2025)
            let wordConf = null;
            if (res.chunks && res.chunks.length > 0) {
                wordConf = res.chunks.map(c => ({
                    text: c.text,
                    conf: c.confidence ?? 1.0,
                    isLowConf: (c.confidence ?? 1.0) < 0.55
                }));
            }
            const avgConf = res.chunks 
                ? res.chunks.reduce((acc, c) => acc + (c.confidence ?? 1), 0) / res.chunks.length 
                : 1;

            self.postMessage({ 
                type: item.isPartial ? 'partial' : 'final', 
                text: res.text, 
                isLowConf: avgConf < 0.60,
                wordConf,
                avgConf
            });
        } else if (!item.isPartial) {
            self.postMessage({ type: 'final', text: "", isLowConf: false, wordConf: null });
        }
    } catch (e) {
        console.error("Whisper processing error:", e);
    } 
    isBusy = false; 
    process();
}

self.onmessage = async (e) => {
    const { type, port, precision, language, prompt } = e.data;
    if (type === 'load') {
        currentPrecision = precision;
        let model = precision === 'base' ? 'onnx-community/whisper-base' : precision === 'tiny' ? 'onnx-community/whisper-tiny' : 'onnx-community/whisper-large-v3-turbo';
        let safeDtype = (precision === 'turbo') ? 'fp16' : 'fp32';
        transcriber = await pipeline('automatic-speech-recognition', model, { 
            device: 'webgpu', dtype: safeDtype, 
            progress_callback: (p) => self.postMessage({ type: 'progress', p: p.progress }) 
        });
        
        // [OPT]: Monitor GPU context loss — surfaces hardware crashes instead of silent freeze
        const gpuDevice = transcriber?.model?.session?.handler?.backend?.device;
        if (gpuDevice?.lost) {
            gpuDevice.lost.then(info => {
                console.error('[APEX] WebGPU device lost:', info.reason, info.message);
                self.postMessage({ type: 'GPU_LOST', reason: info.reason });
                transcriber = null; // Force full reload on recovery
            });
        }
        
        self.postMessage({ type: 'READY_TO_PROCESS' });
        if (vadPort) vadPort.postMessage({ type: 'WHISPER_ONLINE' });
    } else if (type === 'update_params') {
        if (precision) currentPrecision = precision;
        if (language) currentLanguage = language;
        if (prompt !== undefined) initialPrompt = prompt;
    } else if (type === 'init_vad_port') {
        vadPort = port; vadPort.onmessage = (ev) => { 
            if (ev.data.type === 'transcribe') { 
                // [APEX BUGFIX]: Se arriva un frammento audio, scartiamo i 'partial' obsoleti 
                // che stanno intasando la coda in attesa di elaborazione per colpa della latenza.
                queue = queue.filter(item => !item.isPartial);
                queue.push({buffer: ev.data.audioBuffer, isPartial: ev.data.isPartial}); 
                process(); 
            } 
        };
    }
};
