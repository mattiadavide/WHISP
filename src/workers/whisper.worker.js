import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js';
env.allowLocalModels = false;
env.backends.onnx.wasm.proxy = true;
env.backends.onnx.logLevel = 'fatal';
env.backends.onnx.wasm.numThreads = Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2));
env.backends.onnx.wasm.simd = true;
let transcriber = null, queue = [], isBusy = false, currentLanguage = "italian", vadPort = null, currentPrecision = "turbo", initialPrompt = "", basePrompt = "";
let recentPrefixes = []; 
let lastPartialText = ''; 
const ANTI_HALLUCINATION_PROMPTS = {
    italian: "Trascrivi esattamente quello che senti. Non aggiungere parole inventate. ",
    english: "Transcribe only what is spoken. Do not add or invent words. ",
    spanish: "Transcribe exactamente lo que se dice. No añadas palabras inventadas. ",
    french:  "Transcrivez exactement ce qui est dit. N'ajoutez pas de mots inventés. ",
    german:  "Transkribiere genau das Gesprochene. Füge keine erfundenen Wörter hinzu. ",
};
const WHISPER_INTRO_HALLUCINATION_RE = /^\s*(?:Lo|La|Le|Li|Ne|Ve)\s+(?:s[vbcdfghjlmnpqrtz]|[A-Z]{2,})/;
function getLowConfThreshold() {
    if (currentPrecision === 'turbo') return 0.60;
    if (currentPrecision === 'base')  return 0.72;
    return 0.78; 
}
function getCompressionRatio(text) {
    if (!text || text.length < 5) return 0;
    const encoded = new TextEncoder().encode(text);
    let last = -1, count = 0, compressedSize = 0;
    for (let b of encoded) {
        if (b === last) count++;
        else {
            compressedSize += (count > 0 ? 2 : 1);
            last = b; count = 1;
        }
    }
    compressedSize += (count > 0 ? 2 : 1);
    return encoded.length / compressedSize;
}

async function process() {
    if (isBusy || queue.length === 0 || !transcriber) return;
    isBusy = true; 
    const item = queue.shift();
    try {
        let config = { 
            language: currentLanguage, 
            task: 'transcribe', 
            temperature: 0.0, 
            prompt: (ANTI_HALLUCINATION_PROMPTS[currentLanguage] || ANTI_HALLUCINATION_PROMPTS.italian) + basePrompt + (initialPrompt ? " " + initialPrompt : "")
        };
        if (currentPrecision !== 'turbo') {
            config.return_timestamps = true; 
            config.condition_on_previous_text = false;
        }
        const res = await transcriber(new Float32Array(item.buffer), config);
        if (res.text && res.text.trim().length > 0) {
            const tokenEntropy = (p) => {
                if (p <= 0 || p >= 1) return 0;
                return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
            };
            const ENTROPY_THRESHOLD = 0.7; 
            let wordConf = null;
            if (res.chunks && res.chunks.length > 0) {
                wordConf = res.chunks.map(c => {
                    const conf = c.confidence ?? 1.0;
                    const H = tokenEntropy(conf);
                    return {
                        text: c.text,
                        conf,
                        entropy: H,
                        isLowConf: H > ENTROPY_THRESHOLD || conf < getLowConfThreshold()
                    };
                });
            }
            const avgConf = res.chunks
                ? res.chunks.reduce((acc, c) => acc + (c.confidence ?? 1), 0) / res.chunks.length
                : 1;
            
            // Hallucination Check (Compression Ratio)
            const ratio = getCompressionRatio(res.text);
            if (currentPrecision === 'base' && ratio > 2.4 && avgConf < 0.70) {
                res.text = ""; 
            }

            let cleanText = res.text.trim();
            if (currentPrecision !== 'turbo') {
                cleanText = cleanText.replace(WHISPER_INTRO_HALLUCINATION_RE, '').trim();
                res.text = cleanText;
            }
            const isRepetitive = /([a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff])\1{4,}/i.test(cleanText) || /\b([a-zA-Z\u00c0-\u00d6\u00d8-\u00f6\u00f8-\u00ff]{2,})\b(?:\s+\1\b){3,}/i.test(cleanText) || /(.{10,})\1{2,}/i.test(cleanText);
            if (isRepetitive) res.text = ""; 
            let wordsArr = res.text.trim().split(/\s+/);
            if (wordsArr.length > 0) {
                let hallucinatedPrefixCount = 0;
                if (currentPrecision !== 'turbo') {
                    for (let n = Math.min(4, wordsArr.length); n > 0; n--) {
                        const candidatePrefix = wordsArr.slice(0, n).join(' ').toLowerCase().replace(/[^\w\s]/gi, '');
                        if (candidatePrefix.length > 2 && recentPrefixes.includes(candidatePrefix)) {
                            hallucinatedPrefixCount = n;
                            break;
                        }
                    }
                    if (hallucinatedPrefixCount > 0) {
                        const regex = new RegExp('^\\s*(' + wordsArr.slice(0, hallucinatedPrefixCount).join('\\s+') + ')\\b[\\s\\W]*', 'i');
                        res.text = res.text.replace(regex, '');
                    } 
                }
                if (!item.isPartial) {
                    const newWordsArr = res.text.trim().split(/\s+/);
                    for (let n = 1; n <= Math.min(4, newWordsArr.length); n++) {
                        const newPrefix = newWordsArr.slice(0, n).join(' ').toLowerCase().replace(/[^\w\s]/gi, '');
                        if (newPrefix.length > 2) {
                            recentPrefixes.push(newPrefix);
                            if (recentPrefixes.length > 16) recentPrefixes.shift(); 
                        }
                    }
                }
            }
            if (!item.isPartial) {
                if (!isRepetitive && avgConf > getLowConfThreshold() + 0.05) { 
                    const words = cleanText.split(/\s+/);
                    if (currentPrecision === 'turbo') {
                        initialPrompt = words.slice(-20).join(' '); 
                    } else {
                        initialPrompt = "";
                    }
                } else {
                    initialPrompt = ""; 
                }
            }
            if (/^\[.*?\]$/.test(cleanText) || /^\(.*?\)$/.test(cleanText) || /^\*.*?\*$/.test(cleanText)) {
                res.text = "";
            }
            if (res.text.trim().length > 0) {
                if (item.isPartial) lastPartialText = res.text.trim();
                self.postMessage({ 
                    type: item.isPartial ? 'partial' : 'final', 
                    text: res.text, 
                    isLowConf: avgConf < getLowConfThreshold(),
                    wordConf,
                    avgConf,
                    queueLength: queue.length,
                    lastPartialText: item.isPartial ? '' : lastPartialText
                });
                if (!item.isPartial) lastPartialText = ''; 
            } else if (!item.isPartial) {
                self.postMessage({ type: 'final', text: "", isLowConf: false, wordConf: null, queueLength: queue.length, lastPartialText });
                lastPartialText = '';
            }
        } else if (!item.isPartial) {
            self.postMessage({ type: 'final', text: "", isLowConf: false, wordConf: null, queueLength: queue.length });
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
        let lastProgressTime = 0;
        transcriber = await pipeline('automatic-speech-recognition', model, { 
            device: 'webgpu', dtype: safeDtype, 
            progress_callback: (prog) => { 
                let fileName = prog.file;
                if (!fileName && typeof prog.url === 'string') {
                    // Split by ?, #, or % to strip query params/hashes, then get the last path segment
                    fileName = prog.url.split(/[?#]/)[0].split('/').pop();
                }
                if (!fileName && typeof prog.name === 'string') {
                    // If it's a repo path like "author/model", grabbing just "model" is better
                    fileName = prog.name.split('/').pop();
                }
                if (!fileName) fileName = 'chunk';
                
                // Do not track meaningless unnamed chunks that spam the callback
                if (!fileName || fileName === 'chunk') return;
                
                const now = Date.now();
                // Throttle updates to ~20FPS to prevent main thread GUI freezing, 
                // except for critical status changes
                if (prog.status === 'progress' && (now - lastProgressTime < 50)) {
                    return;
                }
                lastProgressTime = now;
                
                self.postMessage({ 
                    type: 'progress', 
                    status: prog.status, 
                    file: fileName, 
                    loaded: prog.loaded, 
                    total: prog.total, 
                    p: prog.progress 
                }); 
            }
        });
        const gpuDevice = transcriber?.model?.session?.handler?.backend?.device;
        if (gpuDevice?.lost) {
            gpuDevice.lost.then(info => {
                console.error('[APEX] WebGPU device lost:', info.reason, info.message);
                self.postMessage({ type: 'GPU_LOST', reason: info.reason });
                transcriber = null; 
            });
        }
        self.postMessage({ type: 'READY_TO_PROCESS' });
        if (vadPort) vadPort.postMessage({ type: 'WHISPER_ONLINE' });
    } else if (type === 'update_params') {
        if (precision) currentPrecision = precision;
        if (language) currentLanguage = language;
        if (prompt !== undefined) basePrompt = prompt;
    } else if (type === 'init_vad_port') {
        vadPort = port; vadPort.onmessage = (ev) => { 
            if (ev.data.type === 'transcribe') { 
                queue = queue.filter(item => !item.isPartial);
                queue.push({buffer: ev.data.audioBuffer, isPartial: ev.data.isPartial}); 
                // [BASE MODEL UX] — If a partial arrives while we're busy transcribing,
                // post a lightweight 'transcribing' signal so the UI can show an
                // animated indicator instead of a blank interim span.
                if (isBusy && ev.data.isPartial) {
                    self.postMessage({ type: 'transcribing' });
                }
                process(); 
            } 
        };
    }
};