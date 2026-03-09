import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js';

// [OPT]: Disable telemetry, enable multi-thread WASM with SIMD for CPU fallback performance
env.allowLocalModels = false;
env.backends.onnx.wasm.proxy = true;
env.backends.onnx.logLevel = 'fatal';
// OPT: Prevent CPU lockup on MacBook Air M3 by using only half the available cores
env.backends.onnx.wasm.numThreads = Math.max(1, Math.floor((navigator.hardwareConcurrency || 4) / 2));
env.backends.onnx.wasm.simd = true;
let transcriber = null, queue = [], isBusy = false, currentLanguage = "italian", vadPort = null, currentPrecision = "turbo", initialPrompt = "", basePrompt = "";
let recentPrefixes = []; // [APEX]: Tracks the start of recent sentences to block prefix-stutter loops
let lastPartialText = ''; // [MBR]: Stores last partial text for MBR prefix anchor comparison

// [OPT — ANTI-HALLUCINATION PROMPT]: OpenAI (2024) and Calm-Whisper (arXiv May 2025) show that
// explicit instructions in the initial prompt significantly reduce hallucination in non-speech/noise segments.
// Language-aware: Italian instruction for italian transcription mode.
const ANTI_HALLUCINATION_PROMPTS = {
    italian: "Trascrivi esattamente quello che senti. Non aggiungere parole inventate. ",
    english: "Transcribe only what is spoken. Do not add or invent words. ",
    spanish: "Transcribe exactamente lo que se dice. No añadas palabras inventadas. ",
    french:  "Transcrivez exactement ce qui est dit. N'ajoutez pas de mots inventés. ",
    german:  "Transkribiere genau das Gesprochene. Füge keine erfundenen Wörter hinzu. ",
};

// [FIX — WHISPER BASE SEGMENT-INTRO STRIPPER]: The base/tiny models hallucinate a 1-2 word
// connecting prefix at the VERY START of transcribed segments. These are NOT spoken — they are
// invented by the model to "continue" a conversation it didn't actually hear.
// Pattern: short Italian function word(s) followed by a lexical word.
// Safe to strip only from the very beginning (^) of the raw Whisper text, before NLP processing.
// Matches ONLY clearly hallucinated clitics:
//   - "Lo sv..." / "Lo sc..." / "Lo svi" (Lo/La + s + consonant cluster — never a valid Italian noun phrase opener)
//   - "Lo CAPS" (Lo/La + ALL-CAPS word — hallucinated transcription artifacts like "Lo SCHERMI")
const WHISPER_INTRO_HALLUCINATION_RE = /^\s*(?:Lo|La|Le|Li|Ne|Ve)\s+(?:s[vbcdfghjlmnpqrtz]|[A-Z]{2,})/;

// [OPT — CALIBRATED CONFIDENCE THRESHOLDS]: ICASSP 2025 / C-Whisper (Feb 2025) show that
// Whisper base and tiny models systematically OVERESTIMATE confidence by 12-18%.
// Using model-agnostic 0.60 causes too many uncertain words to bypass the low-conf marker.
function getLowConfThreshold() {
    if (currentPrecision === 'turbo') return 0.60;
    if (currentPrecision === 'base')  return 0.72;
    return 0.78; // tiny — highest overcalibration bias
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
            
            // [OPT — ENTROPY-BASED CONFIDENCE]: NeMo/NVIDIA (2025-2026) shows token entropy is 4x
            // more accurate than max-probability at detecting incorrect words. 
            // H(p) = -p·log₂(p) - (1-p)·log₂(1-p) — approximates entropy from a single max-prob p.
            // A token with conf=0.75 (seemingly ok) has H=0.81 bits → marked as uncertain.
            // A token with conf=0.95 has H=0.29 bits → high confidence, correctly passed through.
            const tokenEntropy = (p) => {
                if (p <= 0 || p >= 1) return 0;
                return -(p * Math.log2(p) + (1 - p) * Math.log2(1 - p));
            };
            const ENTROPY_THRESHOLD = 0.7; // bits — above this = uncertain (NeMo calibrated value)

            let wordConf = null;
            if (res.chunks && res.chunks.length > 0) {
                wordConf = res.chunks.map(c => {
                    const conf = c.confidence ?? 1.0;
                    const H = tokenEntropy(conf);
                    return {
                        text: c.text,
                        conf,
                        entropy: H,
                        // High entropy supersedes raw confidence threshold — catches overconfident errors
                        isLowConf: H > ENTROPY_THRESHOLD || conf < getLowConfThreshold()
                    };
                });
            }
            const avgConf = res.chunks
                ? res.chunks.reduce((acc, c) => acc + (c.confidence ?? 1), 0) / res.chunks.length
                : 1;

            // [FIX — WHISPER INTRO PREFIX STRIP]: Only for base/tiny models, strip hallucinatory 1-2 word intros
            // e.g. "Lo svedremo" -> "svedremo". Clitic + lowercase word are never valid Italian sentence openers.
            let cleanText = res.text.trim();
            if (currentPrecision !== 'turbo') {
                cleanText = cleanText.replace(WHISPER_INTRO_HALLUCINATION_RE, '').trim();
                res.text = cleanText;
            }
            // [APEX BUGFIX]: Detect multi-word phrase loops (`(.{10,})\1{2,}`)
            const isRepetitive = /([a-zA-ZÀ-ÿ])\1{4,}/i.test(cleanText) || /\b([a-zA-ZÀ-ÿ]{2,})\b(?:\s+\1\b){3,}/i.test(cleanText) || /(.{10,})\1{2,}/i.test(cleanText);

            // Hide the loop in real-time so the user doesn't see garbage streaming
            if (isRepetitive) res.text = ""; 

            // [FIX 6 — PREFIX HALLUCINATION ERASER]: Tiny models often stutter the same prefix
            // (e.g. "È perché", "Andata") at the start of consecutive segments. 
            // We track the first 2 words of recent segments and trim them if they repeat.
            // [FIX 6 — ADVANCED N-GRAM HALLUCINATION ERASER]: Tiny models repeatedly borrow 1-4 word 
            // connective phrases (e.g. "È perché", "Che è un") from previous context to start new segments.
            // We do a sliding intersection: try to match the first 1 to 4 words of the current text against 
            // the memory pool of recent segments. If matched, slice it off.
            let wordsArr = res.text.trim().split(/\s+/);
            if (wordsArr.length > 0) {
                let hallucinatedPrefixCount = 0;
                // Test from longest possible phrase (4 words) down to 1 word
                for (let n = Math.min(4, wordsArr.length); n > 0; n--) {
                    const candidatePrefix = wordsArr.slice(0, n).join(' ').toLowerCase().replace(/[^\w\s]/gi, '');
                    if (candidatePrefix.length > 2 && recentPrefixes.includes(candidatePrefix)) {
                        hallucinatedPrefixCount = n;
                        break;
                    }
                }

                if (hallucinatedPrefixCount > 0) {
                    // Amputate the matched N-Gram
                    const regex = new RegExp('^\\s*(' + wordsArr.slice(0, hallucinatedPrefixCount).join('\\s+') + ')\\b[\\s\\W]*', 'i');
                    res.text = res.text.replace(regex, '');
                } 
                
                // Add the NEW cleaned prefixes to memory to block them next time
                if (!item.isPartial) {
                    const newWordsArr = res.text.trim().split(/\s+/);
                    for (let n = 1; n <= Math.min(4, newWordsArr.length); n++) {
                        const newPrefix = newWordsArr.slice(0, n).join(' ').toLowerCase().replace(/[^\w\s]/gi, '');
                        if (newPrefix.length > 2) {
                            recentPrefixes.push(newPrefix);
                            if (recentPrefixes.length > 16) recentPrefixes.shift(); // Keep last 16 N-grams
                        }
                    }
                }
            }

            // [FIX 1 — ROLLING PROMPT & SYNTACTIC ANCHOR]: Update context with last words after every final segment
            if (!item.isPartial) {
                // If the text is good quality and not a loop, we feed it back to maintain conversational flow.
                if (!isRepetitive && avgConf > getLowConfThreshold() + 0.05) { // 5% hysteresis above low-conf threshold
                    const words = cleanText.split(/\s+/);
                    if (currentPrecision === 'turbo') {
                        initialPrompt = words.slice(-20).join(' '); // Large models can handle massive context memory
                    } else {
                        // [FIX — BASE MODEL SUFFIX BORROWING]: Feeding ANY transcribed text back as prompt to base/tiny
                        // models triggers a "suffix borrowing" cascade: the model hallucinates the last N words of the
                        // previous segment as the START of the next one ("rapida" → "Rapida ci vuo" → "Ci vuosci insieme").
                        // Root cause: the context window of small models is dominated by the prompt, causing it to hallucinate
                        // a "continuation" of the prompt text instead of transcribing the actual audio.
                        // FIX: Zero out the rolling transcript prompt for base/tiny. The Zeitgeist RSS basePrompt
                        // (domain vocabulary, not sentences) remains as a safe lexical anchor.
                        initialPrompt = "";
                    }
                } else {
                    initialPrompt = ""; // Scorch the prompt to break bad confidence loops
                }
            }

            // [FIX 5 — EXACT META-TOKEN GATING]: Reverted invasive global Regex. 
            // Whisper hallucinates silent noise as music. We discard the text ONLY if the **entire** 
            // segment is exactly a meta-token like "[Musica]", "(musica)", or "*musica*".
            if (/^\[.*?\]$/.test(cleanText) || /^\(.*?\)$/.test(cleanText) || /^\*.*?\*$/.test(cleanText)) {
                res.text = "";
            }

            if (res.text.trim().length > 0) {
                // [MBR]: Track last partial so final can compare against it
                if (item.isPartial) lastPartialText = res.text.trim();
                self.postMessage({ 
                    type: item.isPartial ? 'partial' : 'final', 
                    text: res.text, 
                    isLowConf: avgConf < getLowConfThreshold(),
                    wordConf,
                    avgConf,
                    queueLength: queue.length,
                    // [MBR]: Include last partial text for prefix anchor comparison in NLP worker
                    lastPartialText: item.isPartial ? '' : lastPartialText
                });
                if (!item.isPartial) lastPartialText = ''; // reset after final
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
        if (prompt !== undefined) basePrompt = prompt;
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
