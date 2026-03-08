import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js';

// [APEX TUNING]: Setup sperimentale WebGPU e rimozione telemetrie onnx
env.allowLocalModels = false;
env.backends.onnx.wasm.proxy = true;
env.backends.onnx.logLevel = 'fatal';
let transcriber = null, queue = [], isBusy = false, currentLanguage = "italian", vadPort = null, currentPrecision = "turbo", initialPrompt = "";

async function process() {
    if (isBusy || queue.length === 0 || !transcriber) return;
    isBusy = true; 
    const item = queue.shift();
    try {
        // [APEX TUNING]: Lasciamo che WebGPU analizzi il buffer inviato fino a 20s.
        let config = { 
            language: currentLanguage, 
            task: 'transcribe', 
            temperature: 0.0, 
            prompt: initialPrompt
        };

        if (currentPrecision !== 'turbo') {
            config.return_timestamps = true; 
            config.condition_on_previous_text = false;
            // [APEX TUNING]: Greedy decoding limitando le penalità ai modelli piccoli per velocità pura
            config.repetition_penalty = 1.3; 
            config.no_repeat_ngram_size = 2;
            config.top_k = 50;
        }

        const res = await transcriber(new Float32Array(item.buffer), config);
        if (res.text && res.text.trim().length > 0) {
            const avgConf = res.chunks ? res.chunks.reduce((acc, c) => acc + (c.confidence || 1), 0) / res.chunks.length : 1;
            self.postMessage({ type: item.isPartial ? 'partial' : 'final', text: res.text, isLowConf: avgConf < 0.60 });
        } else if (!item.isPartial) {
            self.postMessage({ type: 'final', text: "", isLowConf: false });
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
