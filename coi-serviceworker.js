<!DOCTYPE html>
<html lang="it">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <script src="coi-serviceworker.js"></script>
    <title>WHISP // CORE_OS V5</title>
    <style>
        :root { 
            --bg: #000; --fg: #0f0; --dim: #050; 
            --accent: #0f0; --err: #f00; --warn: #ff0;
            --font: 'Courier New', monospace;
        }
        body { 
            background: var(--bg); color: var(--fg); font-family: var(--font);
            margin: 0; height: 100vh; display: flex; flex-direction: column;
            text-transform: uppercase; font-size: 12px; overflow: hidden;
        }
        #terminal { flex: 1; padding: 20px; display: flex; flex-direction: column; overflow: hidden; }
        
        /* HEADER & CONTROLS */
        .header { margin-bottom: 20px; border-bottom: 1px solid var(--dim); padding-bottom: 10px; }
        .controls { display: grid; grid-template-columns: repeat(auto-fit, minmax(150px, 1fr)); gap: 10px; margin-bottom: 15px; }
        
        select, button { 
            background: #000; color: var(--fg); border: 1px solid var(--fg); 
            padding: 10px; cursor: pointer; font-family: inherit; font-size: 11px;
        }
        button:hover { background: var(--fg); color: #000; }
        button:disabled { border-color: var(--dim); color: var(--dim); cursor: not-allowed; }

        /* OUTPUT AREA */
        #output { 
            flex: 1; overflow-y: auto; border: 1px solid var(--dim); 
            padding: 20px; margin-bottom: 15px; background: rgba(0,15,0,0.05);
            white-space: pre-wrap; line-height: 1.8; font-size: 14px;
            scroll-behavior: smooth; outline: none;
        }

        /* TELEMETRY */
        .telemetry { display: grid; grid-template-columns: 1fr 1fr auto; gap: 20px; font-size: 10px; color: var(--dim); }
        .meter-label { margin-bottom: 4px; display: block; }
        .meter-bar { color: var(--fg); font-weight: bold; }
        
        /* TOKEN STYLES */
        .word-node { transition: color 0.3s; padding: 0 1px; }
        .word-node.healed { color: #fff; font-weight: bold; text-shadow: 0 0 5px rgba(255,255,255,0.3); }
        .word-node.low-conf { color: var(--warn); border-bottom: 1px dotted var(--warn); }
        .interim { color: var(--dim); font-style: italic; }

        #status-led { display: inline-block; width: 8px; height: 8px; border-radius: 50%; background: #222; margin-right: 5px; }
        #status-led.active { background: var(--fg); box-shadow: 0 0 8px var(--fg); }
        
        /* SCROLLBAR */
        ::-webkit-scrollbar { width: 5px; }
        ::-webkit-scrollbar-thumb { background: var(--dim); }
    </style>
</head>
<body>

<div id="terminal">
    <div class="header">
        [ WHISP_CORE_OS_V5 ] >> STATE: <span id="state-text" style="color:#fff">IDLE</span>
    </div>

    <div class="controls">
        <select id="model-select">
            <option value="turbo">LARGE_V3_TURBO (1.6GB)</option>
            <option value="base">BASE_STABLE (150MB)</option>
            <option value="tiny">TINY_MOBILE (80MB)</option>
        </select>
        <select id="audio-source">
            <option value="mic">SRC: MICROPHONE</option>
            <option value="system">SRC: SYSTEM_AUDIO</option>
        </select>
        <select id="lang-select">
            <option value="italian">LANG: ITA</option>
            <option value="english">LANG: ENG</option>
        </select>
        <button id="boot-btn">BOOT_SYSTEM()</button>
    </div>

    <div id="output" contenteditable="false" spellcheck="false"></div>

    <div class="telemetry">
        <div>
            <span class="meter-label">VAD_PROBABILITY</span>
            <span id="vad-meter" class="meter-bar">[----------]</span>
        </div>
        <div>
            <span class="meter-label">SIGNAL_RMS</span>
            <span id="rms-meter" class="meter-bar">[----------]</span>
        </div>
        <div style="align-self: flex-end;">
            <span id="status-led"></span> <span id="source-display">OFFLINE</span>
        </div>
    </div>
</div>

<script type="module">
    /**
     * @section Data_Structures
     * Albero Trie per validazione instantanea O(L)
     */
    class Trie {
        constructor() { this.root = {}; }
        insert(word) {
            let n = this.root;
            for (let c of word.toLowerCase()) { if(!n[c]) n[c] = {}; n = n[c]; }
            n.isEnd = true;
        }
        has(word) {
            let n = this.root;
            for (let c of word.toLowerCase()) { if(!n[c]) return false; n = n[c]; }
            return n.isEnd;
        }
    }

    /**
     * @section Worker_Kernels
     */
    const VAD_CODE = `
        import { AutoModel, Tensor, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js';
        let model, state, whisperPort, isSpeaking = false, silenceFrames = 0;
        
        self.onmessage = async (e) => {
            if (e.data.type === 'init') {
                model = await AutoModel.from_pretrained('onnx-community/silero-vad', { 
                    config: { model_type: 'custom' },
                    device: 'wasm', dtype: 'fp32' 
                });
                state = new Tensor('float32', new Float32Array(2*1*128), [2, 1, 128]);
                self.postMessage({type: 'ready'});
            }
            if (e.data.type === 'port') whisperPort = e.data.port;
            if (e.data.type === 'audio') {
                const out = await model({ 
                    input: new Tensor('float32', e.data.chunk, [1, 512]), 
                    sr: new Tensor('int64', new BigInt64Array([16000n]), [1]), 
                    state 
                });
                state = out.stateN || out.staten;
                const prob = out.output.data[0];
                
                if (prob > 0.45) {
                    isSpeaking = true; silenceFrames = 0;
                    whisperPort.postMessage({type: 'stream', data: e.data.chunk});
                } else if (isSpeaking) {
                    silenceFrames++;
                    whisperPort.postMessage({type: 'stream', data: e.data.chunk});
                    if (silenceFrames > 30) { isSpeaking = false; whisperPort.postMessage({type: 'commit'}); }
                }
                self.postMessage({type: 'vad', prob});
            }
        };
    `;

    const WHISPER_CODE = `
        import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js';
        let pipe, buffer = [], isBusy = false;
        
        self.onmessage = async (e) => {
            if (e.data.type === 'init') {
                const m = { 
                    'turbo': 'onnx-community/whisper-large-v3-turbo', 
                    'base': 'onnx-community/whisper-base', 
                    'tiny': 'onnx-community/whisper-tiny' 
                };
                try {
                    pipe = await pipeline('automatic-speech-recognition', m[e.data.model], { device: 'webgpu', dtype: 'fp16' });
                } catch {
                    pipe = await pipeline('automatic-speech-recognition', m[e.data.model], { device: 'wasm', dtype: 'fp32' });
                }
                self.postMessage({type: 'ready'});
            }
            if (e.data.type === 'stream') buffer.push(...e.data.data);
            if (e.data.type === 'commit' && !isBusy && buffer.length > 4000) {
                isBusy = true;
                const res = await pipe(new Float32Array(buffer), { 
                    language: e.data.lang, task: 'transcribe', return_timestamps: 'word' 
                });
                self.postMessage({type: 'text', text: res.text, chunks: res.chunks});
                buffer = []; isBusy = false;
            }
        };
    `;

    /**
     * @section Main_Kernel
     */
    const Kernel = {
        trie: new Trie(),
        state: 'IDLE',
        activeStream: null,
        audioCtx: null,
        
        async boot() {
            if(this.state !== 'IDLE') return;
            this.updateState('BOOTING_KERNELS...');
            document.getElementById('boot-btn').disabled = true;

            await this.syncZeitgeist();

            // Init Workers
            const vBlob = new Blob([VAD_CODE], {type: 'application/javascript'});
            const wBlob = new Blob([WHISPER_CODE], {type: 'application/javascript'});
            this.vad = new Worker(URL.createObjectURL(vBlob), {type: 'module'});
            this.whisper = new Worker(URL.createObjectURL(wBlob), {type: 'module'});

            const chan = new MessageChannel();
            this.vad.postMessage({type: 'port', port: chan.port1}, [chan.port1]);
            this.whisper.postMessage({
                type: 'init', 
                model: document.getElementById('model-select').value,
                lang: document.getElementById('lang-select').value
            }, [chan.port2]);

            this.vad.postMessage({type: 'init'});
            this.vad.onmessage = (e) => this.handleVad(e.data);
            this.whisper.onmessage = (e) => this.handleWhisper(e.data);
        },

        async startAudio() {
            const src = document.getElementById('audio-source').value;
            try {
                this.activeStream = (src === 'system') 
                    ? await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
                    : await navigator.mediaDevices.getUserMedia({ audio: true });

                this.audioCtx = new AudioContext({sampleRate: 16000});
                const sourceNode = this.audioCtx.createMediaStreamSource(this.activeStream);
                
                await this.audioCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([`
                    class P extends AudioWorkletProcessor {
                        process(i) {
                            const c = i[0][0];
                            if(c) {
                                let s=0; for(let v of c) s+=v*v;
                                this.port.postMessage({type:'audio', chunk:c, rms: Math.sqrt(s/c.length)});
                            }
                            return true;
                        }
                    }
                    registerProcessor('p', P);
                `], {type:'text/javascript'})));

                const workletNode = new AudioWorkletNode(this.audioCtx, 'p');
                workletNode.port.onmessage = (e) => {
                    this.updateMeter('rms-meter', e.data.rms * 10);
                    this.vad.postMessage({type: 'audio', chunk: e.data.chunk});
                };

                sourceNode.connect(workletNode);
                document.getElementById('status-led').classList.add('active');
                document.getElementById('source-display').innerText = src.toUpperCase();
                this.updateState('ONLINE_AND_LISTENING');
            } catch (err) {
                this.updateState('ERROR: CAPTURE_DENIED');
                console.error(err);
            }
        },

        handleVad(d) {
            if(d.type === 'ready') this.startAudio();
            if(d.type === 'vad') this.updateMeter('vad-meter', d.prob);
        },

        handleWhisper(d) {
            if(d.type === 'text') {
                const words = d.text.trim().split(/\s+/);
                words.forEach(w => {
                    const span = document.createElement('span');
                    span.className = 'word-node';
                    const clean = w.toLowerCase().replace(/[^a-zà-ù]/g, '');
                    if(this.trie.has(clean)) span.classList.add('healed');
                    span.innerText = w + ' ';
                    document.getElementById('output').appendChild(span);
                });
                document.getElementById('output').scrollTop = document.getElementById('output').scrollHeight;
            }
        },

        updateState(txt) { document.getElementById('state-text').innerText = txt; },
        
        updateMeter(id, val) {
            const b = Math.min(Math.floor(val * 10), 10);
            document.getElementById(id).innerText = '[' + '#'.repeat(b) + '-'.repeat(10-b) + ']';
        },

        async syncZeitgeist() {
            this.updateState('SYNCING_ZEITGEIST...');
            try {
                const r = await fetch('https://api.allorigins.win/get?url=' + encodeURIComponent('https://news.google.com/rss?hl=it&gl=IT&ceid=IT:it'));
                const j = await r.json();
                const w = j.contents.match(/[a-zA-ZÀ-ÿ]{4,}/g) || [];
                w.forEach(word => this.trie.insert(word));
                console.log("ZEITGEIST_LOADED:", w.length);
            } catch(e) { console.warn("ZEITGEIST_OFFLINE"); }
        }
    };

    document.getElementById('boot-btn').onclick = () => Kernel.boot();
</script>
</body>
</html>
