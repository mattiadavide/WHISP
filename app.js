const UI = {
    status: document.getElementById('status'), progressText: document.getElementById('progress-text'),
    progressContainer: document.getElementById('progress-container'), asciiBar: document.getElementById('ascii-bar'),
    precisionSelect: document.getElementById('precisionSelect'), languageSelect: document.getElementById('languageSelect'),
    audioSource: document.getElementById('audioSource'), loadBtn: document.getElementById('loadBtn'),
    startBtn: document.getElementById('startBtn'), stopBtn: document.getElementById('stopBtn'),
    output: document.getElementById('output'), vadLed: document.getElementById('vadLed'),
    vadFill: document.getElementById('vadFill'), volFill: document.getElementById('volFill'),
    probVal: document.getElementById('probVal'), clearBtn: document.getElementById('clearBtn'),
    copyBtn: document.getElementById('copyBtn'), exportBtn: document.getElementById('exportBtn')
};

const LANGUAGES = { "italian": "ITA", "english": "ENG", "spanish": "ESP", "french": "FRA", "german": "GER", "russian": "RUS" };
for (const [c, n] of Object.entries(LANGUAGES)) {
    const o = document.createElement("option"); o.value = c; o.text = n; UI.languageSelect.appendChild(o);
}
UI.languageSelect.value = "italian";

// Registrazione Service Worker per PWA e Privacy Firewall
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('./sw.js').catch(console.error);
}

async function ensureModelIsVaulted(precision) {
    UI.status.innerText = "CHECKING_VAULT...";
    const modelName = precision === 'q8-tiny' ? 'Xenova/whisper-tiny' : 'onnx-community/whisper-large-v3-turbo';
    const cache = await caches.open('transformers-cache');
    const modelFiles = [
        `https://huggingface.co/${modelName}/resolve/main/config.json`,
        `https://huggingface.co/${modelName}/resolve/main/tokenizer.json`
    ];
    let allInVault = true;
    for (const url of modelFiles) {
        const response = await cache.match(url);
        if (!response) allInVault = false;
    }
    return allInVault;
}

const vadWorkerCode = `
    import { AutoModel, Tensor, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js';
    env.allowLocalModels = true;
    env.allowRemoteModels = true; 
    let vadModel = null, state = null, whisperPort = null, isWhisperOnline = false;
    let isSpeaking = false, silenceFrames = 0, whisperQueueSize = 0; 
    const SR_TENSOR = new Tensor('int64', new BigInt64Array([16000n]), [1]);
    const audioBuf = new Float32Array(900 * 512);
    let audioBufPtr = 0;

    self.onmessage = async (e) => {
        const { type, port } = e.data;
        if (type === 'load') {
            vadModel = await AutoModel.from_pretrained('onnx-community/silero-vad');
            state = new Tensor('float32', new Float32Array(2 * 1 * 128).fill(0), [2, 1, 128]);
            self.postMessage({ type: 'ready' });
        } else if (type === 'init_whisper_port') {
            whisperPort = port;
            whisperPort.onmessage = (ev) => { if (ev.data.type === 'WHISPER_ONLINE') isWhisperOnline = true; };
        } else if (type === 'init_worklet_port') {
            port.onmessage = async (ev) => {
                if (ev.data.type === 'vad' && vadModel) {
                    const chunk = new Float32Array(ev.data.data);
                    if (isSpeaking) {
                        audioBuf.set(chunk, audioBufPtr * 512);
                        if (++audioBufPtr >= 900) audioBufPtr = 0;
                    }
                    const out = await vadModel({ input: new Tensor('float32', chunk, [1, 512]), sr: SR_TENSOR, state });
                    state = out.stateN || out.staten || state;
                    const prob = out.output.data[0];
                    if (prob > (isSpeaking ? 0.35 : 0.55)) {
                        if (!isSpeaking) isSpeaking = true;
                        silenceFrames = 0;
                    } else if (isSpeaking && ++silenceFrames > 25) {
                        isSpeaking = false;
                        if (whisperPort && isWhisperOnline) {
                            const b = audioBuf.slice(0, audioBufPtr * 512).buffer;
                            whisperPort.postMessage({ type: 'transcribe', audioBuffer: b }, [b]);
                        }
                        audioBufPtr = 0;
                    }
                    self.postMessage({ type: 'vad_ui_update', prob, isSpeaking });
                    port.postMessage({ type: 'return_buf', data: chunk.buffer }, [chunk.buffer]);
                }
            };
        }
    };
`;

const whisperWorkerCode = `
    import { pipeline, env } from 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.3.3/dist/transformers.min.js';
    env.allowLocalModels = true;
    env.allowRemoteModels = true; 
    let transcriber = null;

    self.onmessage = async (e) => {
        const { type, port, precision } = e.data;
        if (type === 'load') {
            const model = precision === 'q8-tiny' ? 'Xenova/whisper-tiny' : 'onnx-community/whisper-large-v3-turbo';
            transcriber = await pipeline('automatic-speech-recognition', model, { 
                device: precision === 'fp16' ? 'webgpu' : 'wasm', dtype: precision === 'fp16' ? 'fp16' : 'q8',
                progress_callback: (p) => self.postMessage({ type: 'progress', p: p.progress }) 
            });
            env.allowRemoteModels = false; // PRIVACY LOCK
            self.postMessage({ type: 'READY_TO_PROCESS' });
        } else if (type === 'init_vad_port') {
            port.onmessage = async (v) => {
                if (v.data.type === 'transcribe') {
                    const res = await transcriber(new Float32Array(v.data.audioBuffer), { language: 'italian', task: 'transcribe' });
                    self.postMessage({ type: 'final', text: res.text });
                }
            };
            port.postMessage({ type: 'WHISPER_ONLINE' });
        }
    };
`;

const vadWorker = new Worker(URL.createObjectURL(new Blob([vadWorkerCode], { type: 'application/javascript' })), { type: 'module' });
const whisperWorker = new Worker(URL.createObjectURL(new Blob([whisperWorkerCode], { type: 'application/javascript' })), { type: 'module' });
const channel = new MessageChannel();
vadWorker.postMessage({ type: 'init_whisper_port', port: channel.port1 }, [channel.port1]);
whisperWorker.postMessage({ type: 'init_vad_port', port: channel.port2 }, [channel.port2]);

let audioCtx, stream;

whisperWorker.onmessage = (e) => {
    if (e.data.type === 'progress') {
        UI.progressContainer.style.display = 'block';
        const p = Math.round(e.data.p || 0);
        UI.progressText.innerText = 'SYNCING_CORE: ' + p + '%';
        const b = Math.floor(p/5); UI.asciiBar.innerText = '[' + '#'.repeat(b) + '-'.repeat(20 - b) + ']';
    } else if (e.data.type === 'READY_TO_PROCESS') {
        UI.status.innerText = "ONLINE"; UI.progressContainer.style.display = 'none';
        UI.loadBtn.style.display = 'none'; UI.startBtn.disabled = false;
    } else if (e.data.type === 'final') {
        UI.output.appendChild(document.createTextNode(" " + e.data.text.trim()));
    }
};

vadWorker.onmessage = (e) => {
    if (e.data.type === 'ready') whisperWorker.postMessage({ type: 'load', precision: UI.precisionSelect.value });
    if (e.data.type === 'vad_ui_update') {
        UI.vadFill.style.width = (e.data.prob * 100) + "%";
        UI.vadLed.classList.toggle('active', e.data.isSpeaking);
        UI.status.innerText = e.data.isSpeaking ? "RECORDING" : "LISTENING";
    }
};

UI.loadBtn.onclick = async () => {
    UI.loadBtn.disabled = true;
    await ensureModelIsVaulted(UI.precisionSelect.value);
    vadWorker.postMessage({ type: 'load' });
};

UI.startBtn.onclick = async () => {
    audioCtx = new AudioContext({ sampleRate: 16000 });
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const blob = URL.createObjectURL(new Blob([`
        class P extends AudioWorkletProcessor {
            constructor() { super(); this.port.onmessage = (e) => this.vPort = e.data.port; }
            process(inputs) {
                const input = inputs[0][0];
                if (input && this.vPort) {
                    const b = new Float32Array(input).buffer;
                    this.vPort.postMessage({type:'vad', data:b}, [b]);
                }
                return true;
            }
        }
        registerProcessor('p', P);
    `], { type: 'application/javascript' }));
    await audioCtx.audioWorklet.addModule(blob);
    const node = new AudioWorkletNode(audioCtx, 'p');
    const ch = new MessageChannel();
    vadWorker.postMessage({ type: 'init_worklet_port', port: ch.port1 }, [ch.port1]);
    node.port.postMessage({ type: 'init_port', port: ch.port2 }, [ch.port2]);
    audioCtx.createMediaStreamSource(stream).connect(node);
    UI.startBtn.style.display = 'none'; UI.stopBtn.style.display = 'inline-block';
};

UI.stopBtn.onclick = () => {
    if (audioCtx) audioCtx.close();
    if (stream) stream.getTracks().forEach(t => t.stop());
    UI.status.innerText = "ONLINE"; UI.stopBtn.style.display = 'none'; UI.startBtn.style.display = 'inline-block';
};

UI.clearBtn.onclick = () => UI.output.innerHTML = "";
