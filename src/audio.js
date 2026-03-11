export class AudioProcessor {
    constructor() {
        this.audioCtx = null;
        this.stream = null;
        this.worklet = null;
        this.isRecording = false;
    }
    async init(sourceType, vadWorker) {
        this.audioCtx = new AudioContext({ sampleRate: 16000 });
        this.stream = sourceType === 'system' 
            ? await navigator.mediaDevices.getDisplayMedia({audio: true, video: true}) 
            : await navigator.mediaDevices.getUserMedia({audio: {
                echoCancellation: false,
                noiseSuppression: false,
                autoGainControl: false,
                channelCount: 1,
                sampleRate: 16000
            }});
        try {
            await this.audioCtx.audioWorklet.addModule(URL.createObjectURL(new Blob([`
            class P extends AudioWorkletProcessor {
                    constructor() { 
                        super(); 
                        this.buf = new Float32Array(512); 
                        this.ptr = 0; 
                        this.vPort = null; 
                        this.port.onmessage = (e) => { 
                            if(e.data.port) this.vPort = e.data.port; 
                        }; 
                    }
                    process(inputs) {
                        const input = inputs[0][0]; 
                        if(!input || !this.vPort) return true;
                        for(let i=0; i<input.length; i++) {
                            this.buf[this.ptr++] = input[i];
                            if(this.ptr >= 512) {
                                // Rimuovi DC offset
                                let mean = 0;
                                for(let j=0; j<512; j++) mean += this.buf[j];
                                mean /= 512;
                                
                                // Calcola RMS
                                let rms = 0;
                                for(let j=0; j<512; j++) { const s = this.buf[j] - mean; rms += s*s; }
                                rms = Math.sqrt(rms / 512);
                                
                                // [FIX CRITICO: NOISE GATE E GAIN LIMITER]
                                // Se l'RMS è inferiore a 0.001 (silenzio di fondo), non amplificare (gain = 1.0).
                                // Se è voce, amplifica fino al target 0.2, ma con un limite massimo di 8x per evitare distorsioni.
                                const gain = rms > 0.001 ? Math.min(0.2 / rms, 8.0) : 1.0;
                                
                                const norm = new Float32Array(512);
                                for(let j=0; j<512; j++) {
                                    // Soft-clipping per proteggere l'input
                                    norm[j] = Math.max(-1, Math.min(1, (this.buf[j] - mean) * gain));
                                }
                                
                                this.vPort.postMessage({type:'vad', data:norm.buffer, rawRms: rms}); 
                                this.ptr = 0;
                            }
                        }
                        return true;
                    }
                }
                registerProcessor('p', P);
            `], {type:'application/javascript'})));
            this.worklet = new AudioWorkletNode(this.audioCtx, 'p');
        } catch(e) {
            console.error("[APEX] AudioWorklet initialization failed:", e);
            return;
        }
        const audioChannel = new MessageChannel();
        vadWorker.postMessage({ type: 'init_worklet_port', port: audioChannel.port1 }, [audioChannel.port1]);
        this.worklet.port.postMessage({ port: audioChannel.port2 }, [audioChannel.port2]);
        this.audioCtx.createMediaStreamSource(this.stream).connect(this.worklet);
        this.isRecording = true;
    }
    stop() {
        if (this.stream) this.stream.getTracks().forEach(t => t.stop()); 
        if (this.audioCtx) this.audioCtx.close();
        this.isRecording = false;
    }
}